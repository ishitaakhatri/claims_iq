from .state import ClaimsState
from ..tools.tools import call_azure_layout, call_openai_extraction

# ─── Business Rules Engine ────────────────────────────────────────────────────
BUSINESS_RULES = [
    {"id": "BR001", "name": "Claim Amount Threshold", "description": "Claims ≤ $5,000 auto-approved", "field": "claimAmount", "operator": "lte", "value": 5000, "weight": 30},
    {"id": "BR002", "name": "High-Value Escalation", "description": "Claims > $25,000 require senior review", "field": "claimAmount", "operator": "lte", "value": 25000, "weight": 40},
    {"id": "BR003", "name": "Document Completeness", "description": "All required fields must be present", "field": "completeness", "operator": "gte", "value": 80, "weight": 25},
    {"id": "BR004", "name": "Fraud Indicators", "description": "No fraud flags detected", "field": "fraudScore", "operator": "lte", "value": 30, "weight": 50},
    {"id": "BR005", "name": "Policy Active Status", "description": "Policy must be active at time of claim", "field": "policyStatus", "operator": "eq", "value": "active", "weight": 35},
    {"id": "BR006", "name": "Duplicate Claim Check", "description": "No duplicate claim reference found", "field": "isDuplicate", "operator": "eq", "value": False, "weight": 45},
]

# Global variable to store the last processed claim data for duplicate check
LAST_CLAIM_DATA = None

def verify_single_rule(rule: dict, extracted_data: dict) -> dict:
    """
    Evaluates a single business rule against extracted data.
    """
    field = rule["field"]
    raw_val = extracted_data.get(field)
    passed = False
    actual = raw_val

    if raw_val is None:
        passed = False
        actual = "N/A"
    else:
        op = rule["operator"]
        val = rule["value"]
        
        try:
            if op == "lte": passed = float(raw_val) <= float(val)
            elif op == "lt": passed = float(raw_val) < float(val)
            elif op == "gte": passed = float(raw_val) >= float(val)
            elif op == "gt": passed = float(raw_val) > float(val)
            elif op == "eq": 
                if isinstance(val, bool):
                    passed = bool(raw_val) == val
                else:
                    passed = str(raw_val).lower() == str(val).lower()
            else: passed = False
        except (ValueError, TypeError):
            # Fallback for non-numeric comparisons if float() fails
            if op == "eq":
                passed = str(raw_val).lower() == str(val).lower()
            else:
                passed = False

    return {**rule, "passed": passed, "actual": actual}

# ─── Graph Nodes ──────────────────────────────────────────────────────────────

def ocr_node(state: ClaimsState):
    """OCR step using Azure"""
    print("---OCR NODE---")
    content = call_azure_layout(state["file_data"], state["file_type"])
    if not content:
        return {"error": "OCR failed (Azure)"}
    return {"ocr_content": content}

def extraction_node(state: ClaimsState):
    """Extraction step using OpenAI"""
    print("---EXTRACTION NODE---")
    if state.get("error"): return state
    
    extracted = call_openai_extraction(state["ocr_content"], state["file_name"])
    if not extracted:
        return {"error": "Extraction failed (OpenAI)"}
    return {"extracted_data": extracted, "rule_results": []} # Initialize rule_results

# Individual Rule Nodes
def rule_br001_node(state: ClaimsState):
    print("---RULE NODE BR001---")
    rule = BUSINESS_RULES[0]
    result = verify_single_rule(rule, state["extracted_data"])
    return {"rule_results": [result]}

def rule_br002_node(state: ClaimsState):
    print("---RULE NODE BR002---")
    rule = BUSINESS_RULES[1]
    result = verify_single_rule(rule, state["extracted_data"])
    return {"rule_results": [result]}

def rule_br003_node(state: ClaimsState):
    print("---RULE NODE BR003---")
    rule = BUSINESS_RULES[2]
    result = verify_single_rule(rule, state["extracted_data"])
    return {"rule_results": [result]}

def rule_br004_node(state: ClaimsState):
    print("---RULE NODE BR004---")
    rule = BUSINESS_RULES[3]
    result = verify_single_rule(rule, state["extracted_data"])
    return {"rule_results": [result]}

def rule_br005_node(state: ClaimsState):
    print("---RULE NODE BR005---")
    rule = BUSINESS_RULES[4]
    result = verify_single_rule(rule, state["extracted_data"])
    return {"rule_results": [result]}

def rule_br006_node(state: ClaimsState):
    print("---RULE NODE BR006---")
    rule = BUSINESS_RULES[5]
    
    # Simple duplicate check logic
    current_claim_num = state["extracted_data"].get("claimNumber")
    is_duplicate = False
    
    print(f"DEBUG BR006: Current Claim Num: {current_claim_num}")
    if LAST_CLAIM_DATA:
        last_claim_num = LAST_CLAIM_DATA.get("claimNumber")
        print(f"DEBUG BR006: Last Claim Num: {last_claim_num}")
        if current_claim_num and current_claim_num == last_claim_num:
            is_duplicate = True
    else:
        print("DEBUG BR006: No LAST_CLAIM_DATA found")
        
    print(f"DEBUG BR006: Is Duplicate: {is_duplicate}")
    
    # Merge the result into the extracted data for rule verification
    data_for_rule = {**state["extracted_data"], "isDuplicate": is_duplicate}

    result = verify_single_rule(rule, data_for_rule)
    return {"rule_results": [result]}


def evaluation_node(state: ClaimsState):
    """Business rules evaluation step - Aggregates results from parallel nodes"""
    print("---EVALUATION NODE---")
    if state.get("error"): return state
    
    results = state.get("rule_results", [])
    
    # Sort results by rule ID to maintain consistency
    results = sorted(results, key=lambda x: x["id"])
    
    stp = all(r["passed"] for r in results)
    escalation_reasons = [r["name"] for r in results if not r["passed"]]
    
    pass_count = len([r for r in results if r["passed"]])
    confidence = round((pass_count / len(BUSINESS_RULES)) * 100) if BUSINESS_RULES else 0
    routing = "STP" if stp else "ESCALATE"
    
    # Simple escalation mapping
    escalate_to = "Senior Claims Manager" if any(r["id"] in ["BR002", "BR004"] and not r["passed"] for r in results) else "Claims Specialist"
    if not stp and not escalate_to:
        escalate_to = "Claims Reviewer"

    evaluation = {
        "results": results,
        "routing": routing,
        "confidence": confidence,
        "escalationReasons": escalation_reasons,
        "escalateTo": escalate_to
    }
    
    # Store the current claim data for the next duplicate check
    global LAST_CLAIM_DATA
    LAST_CLAIM_DATA = state["extracted_data"]
    print(f"DEBUG EVAL: Saved LAST_CLAIM_DATA with claimNumber: {LAST_CLAIM_DATA.get('claimNumber')}")

    
    return {
        "evaluation": evaluation,
        "routing": evaluation["routing"]
    }


from .state import ClaimsState
from ..tools.tools import call_azure_layout, call_openai_extraction
import asyncio
# ─── Business Rules Engine ────────────────────────────────────────────────────
BUSINESS_RULES = [
    {
      "id": "BR001",
      "name": "Claim Amount Threshold",
      "description": "Claims ≤ $5,000 auto-approved",
      "rule_type": "threshold",
      "weight": 30,
      "priority": 1,
      "version": 1,
      "is_active": True,
      "config": {
        "field_name": "claimAmount",
        "operator": "lte",
        "value": 5000
      }
    },
    {
      "id": "BR002",
      "name": "High-Value Escalation",
      "description": "Claims > $25,000 require senior review",
      "rule_type": "threshold",
      "weight": 40,
      "priority": 2,
      "version": 1,
      "is_active": True,
      "config": {
        "field_name": "claimAmount",
        "operator": "lte", # Using LTE 25000 for "Passed" status (No Escalation)
        "value": 25000
      }
    },
    {
      "id": "BR003",
      "name": "Document Completeness",
      "description": "All required fields must be present (Min 80%)",
      "rule_type": "threshold",
      "weight": 25,
      "priority": 3,
      "version": 1,
      "is_active": True,
      "config": {
        "field_name": "completeness",
        "operator": "gte",
        "value": 80
      }
    },
    {
      "id": "BR004",
      "name": "Fraud Indicators",
      "description": "No fraud flags detected (Threshold ≤ 30)",
      "rule_type": "threshold",
      "weight": 50,
      "priority": 4,
      "version": 1,
      "is_active": True,
      "config": {
        "field_name": "fraudScore",
        "operator": "lte",
        "value": 30
      }
    },
    {
      "id": "BR005",
      "name": "Policy Active Status",
      "description": "Policy must be active at time of claim",
      "rule_type": "comparison",
      "weight": 35,
      "priority": 5,
      "version": 1,
      "is_active": True,
      "config": {
        "field_name": "policyStatus",
        "operator": "eq",
        "value": "active"
      }
    },
    {
      "id": "BR006",
      "name": "Duplicate Claim Check",
      "description": "No duplicate claim reference found",
      "rule_type": "cross_field",
      "weight": 45,
      "priority": 6,
      "version": 1,
      "is_active": True,
      "config": {
        "field_name": "claimNumber",
        "operator": "not_duplicate"
      }
    }
]

# Global variable to store the last processed claim data for duplicate check
LAST_CLAIM_DATA = None

def update_rule_description(rule: dict) -> str:
    """
    Dynamically generates description based on current rule value/threshold.
    """
    config = rule.get("config", {})
    val = config.get("value")
    
    if rule["id"] == "BR001":
        formatted_val = f"${val:,}" if isinstance(val, (int, float)) else val
        return f"Claims ≤ {formatted_val} auto-approved"
    elif rule["id"] == "BR002":
        formatted_val = f"${val:,}" if isinstance(val, (int, float)) else val
        return f"Claims > {formatted_val} require senior review"
    elif rule["id"] == "BR003":
        return f"All required fields must be present (Min {val}%)"
    elif rule["id"] == "BR004":
        return f"No fraud flags detected (Threshold ≤ {val})"
    
    return rule.get("description", "")

def verify_single_rule(rule: dict, extracted_data: dict) -> dict:
    """
    Evaluates a single business rule against extracted data.
    """
    config = rule.get("config", {})
    field = config.get("field_name")
    raw_val = extracted_data.get(field)
    passed = False
    actual = raw_val

    if raw_val is None and config.get("operator") != "not_duplicate":
        passed = False
        actual = "N/A"
    else:
        op = config.get("operator")
        val = config.get("value")
        
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
            elif op == "not_duplicate":
                # Special logic for duplicate check
                is_duplicate = extracted_data.get("isDuplicate", False)
                passed = not is_duplicate
                actual = "Duplicate Found" if is_duplicate else "Unique"
            else: passed = False
        except (ValueError, TypeError):
            if op == "eq":
                passed = str(raw_val).lower() == str(val).lower()
            else:
                passed = False

    return {**rule, "passed": passed, "actual": actual}

# ─── Graph Nodes ──────────────────────────────────────────────────────────────

def ocr_node(state: ClaimsState):
    """OCR step using Azure"""
    print("---OCR NODE---")
    # No artificial delay needed for OCR as it's naturally slow
    content = call_azure_layout(state["file_data"], state["file_type"])
    if not content:
        return {"error": "OCR failed (Azure)"}
    return {"ocr_content": content}

def extraction_node(state: ClaimsState):
    """Extraction step using OpenAI"""
    print("---EXTRACTION NODE---")
    # No artificial delay needed for extraction as it's naturally slow
    if state.get("error"): return state
    
    extracted = call_openai_extraction(state["ocr_content"], state["file_name"])
    if not extracted:
        return {"error": "Extraction failed (OpenAI)"}
    return {"extracted_data": extracted, "rule_results": []} # Initialize rule_results

async def rule_engine_node(state: ClaimsState):
    """
    Consolidated Rule Engine Node.
    Iterates through all business rules and evaluates them.
    """
    print("---RULE ENGINE NODE---")
    if state.get("error"): return state
    
    results = []
    extracted_data = state["extracted_data"].copy()
    
    # Pre-process Duplicate Check
    current_claim_num = extracted_data.get("claimNumber")
    is_duplicate = False
    if LAST_CLAIM_DATA:
        if current_claim_num and current_claim_num == LAST_CLAIM_DATA.get("claimNumber"):
            is_duplicate = True
    extracted_data["isDuplicate"] = is_duplicate

    for base_rule in BUSINESS_RULES:
        if not base_rule.get("is_active", True):
            continue
            
        rule = base_rule.copy()
        rule_id = rule["id"]
        
        # Merge runtime configuration if present
        config_override = (state.get("rule_config") or {}).get(rule_id, {})
        if not config_override.get("enabled", True):
            results.append({**rule, "status": "SKIPPED", "passed": True})
            continue
            
        if "threshold" in config_override:
            rule["config"]["value"] = config_override["threshold"]
            rule["description"] = update_rule_description(rule)

        # Artificial delay for UI visibility
        await asyncio.sleep(0.1)
        
        result = verify_single_rule(rule, extracted_data)
        results.append(result)
        
    return {"rule_results": results}


async def evaluation_node(state: ClaimsState):
    """Business rules evaluation step - Aggregates results from parallel nodes"""
    print("---EVALUATION NODE---")
    await asyncio.sleep(0.25) # Final summarizing delay
    if state.get("error"): return state
    
    results = state.get("rule_results", [])
    
    # Sort results by rule ID to maintain consistency
    results = sorted(results, key=lambda x: x["id"])
    
    # Filter out active results (exclude skipped for calculations)
    active_results = [r for r in results if r.get("status") != "SKIPPED"]
    
    stp = all(r["passed"] for r in active_results) if active_results else True
    escalation_reasons = [r["name"] for r in active_results if not r["passed"]]
    
    pass_count = len([r for r in active_results if r["passed"]])
    confidence = round((pass_count / len(active_results)) * 100) if active_results else 100
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


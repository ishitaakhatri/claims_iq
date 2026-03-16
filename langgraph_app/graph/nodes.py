from .state import ClaimsState
from ..tools.tools import call_azure_layout, call_openai_extraction
from ..services.database import async_check_duplicate_claim
import asyncio
# ─── Business Rules Engine ────────────────────────────────────────────────────
# Duplicate check is now handled via database (async)

def update_rule_description(rule: dict) -> str:
    """
    Dynamically generates description based on current rule config values.
    Works for ALL rule types — threshold, comparison, and cross-field.
    """
    config = rule.get("config", {})
    val = config.get("value")
    op = config.get("operator", "")
    field = config.get("field_name", "")
    
    OP_LABELS = {
        "lte": "≤", "lt": "<", "gte": "≥", "gt": ">", "eq": "=",
        "not_duplicate": "NOT DUPLICATE"
    }
    
    rule_type = rule.get("rule_type", "threshold")
    
    if rule_type == "cross_field" or op == "not_duplicate":
        return rule.get("description", "Cross-field validation")
    
    if val is not None and field and op:
        op_label = OP_LABELS.get(op, op)
        if field == "claimAmount" and isinstance(val, (int, float)):
            formatted_val = f"${val:,.0f}"
        elif isinstance(val, (int, float)) and field in ("completeness", "fraudScore"):
            formatted_val = f"{val}%"
        else:
            formatted_val = str(val)
        return f"{field} {op_label} {formatted_val}"
    
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
    return {"extracted_data": extracted} # Don't reset rule_results - the operator.add reducer handles it

def create_rule_node(base_rule: dict):
    """
    Factory function to create a node for a specific business rule.
    """
    async def rule_node(state: ClaimsState):
        rule_id = base_rule["id"]
        print(f"---RULE NODE: {rule_id}---")
        if state.get("error"): return state
        
        rule = base_rule.copy()
        extracted_data = state["extracted_data"].copy()
        
        # Merge runtime configuration if present (threshold overrides only)
        # Note: enabled/disabled is handled at graph construction time in main.py
        config_override = (state.get("rule_config") or {}).get(rule_id, {})
        if "threshold" in config_override:
            rule["config"]["value"] = config_override["threshold"]
        
        # Always dynamically generate description from current config
        rule["description"] = update_rule_description(rule)

        # Handle Duplicate Check (BR006) specifically with Database
        if rule_id == "BR006":
            policy_number = extracted_data.get("policyNumber")
            claimant_id = extracted_data.get("claimantId")
            incident_date = extracted_data.get("incidentDate")
            provider = extracted_data.get("providerName")
            
            is_duplicate = await async_check_duplicate_claim(policy_number, claimant_id, incident_date, provider)
            extracted_data["isDuplicate"] = is_duplicate

        # Artificial delay for UI visibility
        await asyncio.sleep(0.5)
        
        result = verify_single_rule(rule, extracted_data)
        
        # Return only the single result - operator.add reducer handles concatenation
        return {"rule_results": [result]}

    return rule_node


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
    
    return {
        "evaluation": evaluation,
        "routing": evaluation["routing"]
    }


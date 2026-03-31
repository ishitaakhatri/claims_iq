from .state import ClaimsState
from ..tools.tools import call_azure_layout, call_openai_extraction
from ..services.database import async_check_duplicate_claim
import asyncio

# ─── Bias Handling: Decision Feature Whitelist ─────────────────────────────────
# Only these fields are allowed to feed into automated decision logic (rules engine).
# All other fields (claimantName, claimantAddress, etc.) are stored but EXCLUDED
# from decisioning to prevent bias from non-policy-relevant attributes.

DECISION_FEATURE_WHITELIST = {
    "claimAmount", "policyStatus", "claimType", "completeness",
    "fraudScore", "incidentDate", "filingDate", "isDuplicate",
    "claimNumber", "policyNumber", "claimantId", "providerName",
    "supportingDocuments", "missingFields",
    "currency",
}

# Fields that are present in extracted data but deliberately NOT used for decisioning
# Displayed in the "Decision DNA" panel on the frontend
EXCLUDED_FROM_DECISIONING = [
    "Claimant name",
    "Claimant address / region",
    "Language of submission",
    "Handwriting style",
    "Document formatting style",
    "Contact number",
    "Provider location",
    "Claimant demographics",
]

CONFIDENCE_THRESHOLD = 80  # Fields below this trigger "Needs Review"


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
    
    # Operator labels for readable descriptions
    OP_LABELS = {
        "lte": "≤", "lt": "<", "gte": "≥", "gt": ">", "eq": "=",
        "not_duplicate": "NOT DUPLICATE"
    }
    
    rule_type = rule.get("rule_type", "threshold")
    
    if rule_type == "cross_field" or op == "not_duplicate":
        return rule.get("description", "Cross-field validation")
    
    if val is not None and field and op:
        op_label = OP_LABELS.get(op, op)
        # Format value nicely
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


def _filter_for_decisioning(extracted_data: dict) -> dict:
    """
    Returns a copy of extracted_data containing ONLY whitelisted fields.
    This enforces bias guardrails — non-policy-relevant attributes are excluded
    from the business rules engine.
    """
    return {k: v for k, v in extracted_data.items() if k in DECISION_FEATURE_WHITELIST}


def _compute_low_confidence_fields(extracted_data: dict) -> list:
    """
    Scans fieldConfidence from AI extraction and identifies fields
    below the CONFIDENCE_THRESHOLD.
    """
    field_confidence = extracted_data.get("fieldConfidence", {})
    low_conf = []
    for field_name, conf_data in field_confidence.items():
        if field_name == "INSTRUCTION":
            continue
        if isinstance(conf_data, dict):
            confidence = conf_data.get("confidence", 100)
            if confidence < CONFIDENCE_THRESHOLD:
                low_conf.append(field_name)
    return low_conf


# ─── Graph Nodes ──────────────────────────────────────────────────────────────

def ocr_node(state: ClaimsState):
    """OCR step using Azure"""
    print("---OCR NODE---")
    # No artificial delay needed for OCR as it's naturally slow
    content = call_azure_layout(state["file_data"], state["file_type"])
    if not content:
        return {"error": "OCR failed (Azure)"}
    # Clear file_data — no longer needed downstream (saves memory + tracing payload)
    return {"ocr_content": content, "file_data": ""}

def extraction_node(state: ClaimsState):
    """Extraction step using OpenAI — now also computes low-confidence fields"""
    print("---EXTRACTION NODE---")
    if state.get("error"): return {}  # Error already in state, nothing to add
    
    extracted = call_openai_extraction(state["ocr_content"], state["file_name"])
    if not extracted:
        return {"error": "Extraction failed (OpenAI)"}
    
    # Compute low-confidence fields from AI's self-assessed fieldConfidence
    low_conf_fields = _compute_low_confidence_fields(extracted)
    if low_conf_fields:
        print(f"[Extraction] Low-confidence fields detected: {low_conf_fields}")
    
    # Clear ocr_content — no longer needed downstream (saves memory + tracing payload)
    return {
        "extracted_data": extracted,
        "ocr_content": "",
        "low_confidence_fields": low_conf_fields,
    }

def create_rule_node(base_rule: dict):
    """
    Factory function to create a node for a specific business rule.
    Now applies Decision Feature Whitelist for bias handling.
    """
    async def rule_node(state: ClaimsState):
        rule_id = base_rule["id"]
        print(f"---RULE NODE: {rule_id}---")
        if state.get("error"): return {"rule_results": []}  # Don't return full state — causes concurrent write conflicts
        
        rule = base_rule.copy()
        
        # BIAS HANDLING: Filter extracted data through the whitelist
        # Only policy-relevant fields are used for automated decisioning
        full_data = state["extracted_data"].copy()
        extracted_data = _filter_for_decisioning(full_data)
        
        # Merge runtime configuration if present (threshold overrides only)
        # Note: enabled/disabled is handled at graph construction time in main.py
        config_override = (state.get("rule_config") or {}).get(rule_id, {})
        if "threshold" in config_override:
            rule["config"]["value"] = config_override["threshold"]
        
        # Always dynamically generate description from current config
        rule["description"] = update_rule_description(rule)

        # Handle Duplicate Check (BR006) specifically with Database
        if rule_id == "BR006":
            user_id = state.get("user_id")
            policy_number = full_data.get("policyNumber")
            claimant_id = full_data.get("claimantId")
            incident_date = full_data.get("incidentDate")
            provider = full_data.get("providerName")
            
            is_duplicate = await async_check_duplicate_claim(policy_number, claimant_id, incident_date, provider, user_id)
            extracted_data["isDuplicate"] = is_duplicate

        # Artificial delay for UI visibility
        await asyncio.sleep(0.5)
        
        result = verify_single_rule(rule, extracted_data)
        
        # Return only the single result - operator.add reducer handles concatenation
        return {"rule_results": [result]}

    return rule_node


async def evaluation_node(state: ClaimsState):
    """
    Business rules evaluation step — Aggregates results from parallel nodes.
    Now produces rich decision intelligence: reasoning, trigger groups, risk tier.
    """
    print("---EVALUATION NODE---")
    await asyncio.sleep(0.25)  # Final summarizing delay
    if state.get("error"):
        return {
            "evaluation": {"results": [], "routing": "ESCALATE", "confidence": 0, "escalationReasons": ["Processing error"], "escalateTo": "Claims Specialist"},
            "routing": "ESCALATE",
        }
    
    results = state.get("rule_results", [])
    extracted_data = state.get("extracted_data", {})
    low_conf_fields = state.get("low_confidence_fields", [])
    
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

    # ── HITL Trigger Groups ──────────────────────────────────────────────────
    trigger_groups = {
        "A_extraction_uncertainty": [],
        "B_business_exceptions": [],
        "C_decision_uncertainty": [],
        "D_sensitive_claims": [],
    }
    
    # Group A: Extraction Uncertainty
    field_confidence = extracted_data.get("fieldConfidence", {})
    for field_name in low_conf_fields:
        conf_data = field_confidence.get(field_name, {})
        conf_val = conf_data.get("confidence", 0) if isinstance(conf_data, dict) else 0
        trigger_groups["A_extraction_uncertainty"].append(
            f"{field_name} confidence {conf_val}%"
        )
    missing_fields = extracted_data.get("missingFields", [])
    for mf in missing_fields:
        trigger_groups["A_extraction_uncertainty"].append(f"Missing field: {mf}")
    
    # Group B: Business Rule Exceptions
    for r in active_results:
        if not r["passed"]:
            rule_name = r.get("name", r.get("id", "Unknown"))
            config = r.get("config", {})
            field_name = config.get("field_name", "")
            if field_name == "claimAmount":
                amount = extracted_data.get("claimAmount")
                trigger_groups["B_business_exceptions"].append(
                    f"Claim amount ${amount:,.0f} failed {rule_name}" if amount else f"{rule_name} triggered"
                )
            elif r.get("id") == "BR006":
                trigger_groups["B_business_exceptions"].append("Duplicate claim detected")
            else:
                trigger_groups["B_business_exceptions"].append(f"{rule_name} triggered")
    
    # Group C: Decision Uncertainty
    if confidence < 70:
        trigger_groups["C_decision_uncertainty"].append(
            f"Overall decision confidence {confidence}% (below 70% threshold)"
        )
    fraud_score = extracted_data.get("fraudScore", 0)
    if 31 <= fraud_score <= 60:
        trigger_groups["C_decision_uncertainty"].append(
            f"Moderate fraud risk score: {fraud_score}/100"
        )
    
    # Group D: Sensitive / High-Impact Claims
    if fraud_score > 60:
        trigger_groups["D_sensitive_claims"].append(
            f"High fraud risk score: {fraud_score}/100"
        )
    claim_amount = extracted_data.get("claimAmount", 0) or 0
    if claim_amount > 50000:
        trigger_groups["D_sensitive_claims"].append(
            f"High-value claim: ${claim_amount:,.0f}"
        )
    claim_type = str(extracted_data.get("claimType", "")).lower()
    if any(kw in claim_type for kw in ["bodily", "injury", "death", "liability"]):
        trigger_groups["D_sensitive_claims"].append(
            f"Sensitive claim type: {extracted_data.get('claimType', 'Unknown')}"
        )

    # ── Risk Tier & Processing Mode ──────────────────────────────────────────
    has_group_cd = bool(trigger_groups["C_decision_uncertainty"] or trigger_groups["D_sensitive_claims"])
    has_group_ab = bool(trigger_groups["A_extraction_uncertainty"] or trigger_groups["B_business_exceptions"])
    
    # Use AI's assessment first, then override based on rule results
    ai_risk_tier = extracted_data.get("riskTier", "")
    ai_processing_mode = extracted_data.get("processingMode", "")
    
    if has_group_cd or fraud_score > 60:
        risk_tier = "high"
        processing_mode = "escalated"
    elif has_group_ab or not stp:
        risk_tier = "medium"
        processing_mode = "review_required"
    elif ai_risk_tier in ("medium", "high"):
        risk_tier = ai_risk_tier
        processing_mode = ai_processing_mode if ai_processing_mode else "review_required"
    else:
        risk_tier = "low"
        processing_mode = "auto_eligible"

    # ── Flatten all review triggers ──────────────────────────────────────────
    all_review_triggers = []
    for group_triggers in trigger_groups.values():
        all_review_triggers.extend(group_triggers)
    # Also include AI-generated review triggers if present
    ai_triggers = extracted_data.get("reviewTriggers", [])
    for t in ai_triggers:
        if t not in all_review_triggers:
            all_review_triggers.append(t)

    # ── Decision Reasoning (Explainability Object) ───────────────────────────
    reasons = []
    rules_fired = []
    
    for r in active_results:
        rule_name = r.get("name", r.get("id"))
        status = "passed" if r["passed"] else "triggered"
        rules_fired.append({
            "rule_id": r["id"],
            "name": rule_name,
            "status": status,
            "description": r.get("description", ""),
        })
        
        # Generate human-readable reason
        config = r.get("config", {})
        field_name = config.get("field_name", "")
        if r["passed"]:
            reasons.append(f"{rule_name} ✓")
        else:
            actual_val = r.get("actual", "N/A")
            reasons.append(f"{rule_name}: {field_name} = {actual_val} (threshold breached)")
    
    # Add extraction-level reasons
    if missing_fields:
        reasons.append(f"Missing documents/fields: {', '.join(missing_fields[:3])}")
    if low_conf_fields:
        reasons.append(f"Low-confidence extractions: {', '.join(low_conf_fields[:3])}")
    
    # Determine recommended action
    human_review_required = processing_mode != "auto_eligible"
    if processing_mode == "escalated":
        recommended_action = "escalate_to_investigator" if fraud_score > 60 else "escalate_to_specialist"
    elif processing_mode == "review_required":
        recommended_action = "manual_review"
    else:
        recommended_action = "auto_approve"

    decision_reasoning = {
        "recommended_action": recommended_action,
        "confidence": confidence,
        "reasons": reasons,
        "rules_fired": rules_fired,
        "human_review_required": human_review_required,
    }

    # ── Build final evaluation object ────────────────────────────────────────
    evaluation = {
        "results": results,
        "routing": routing,
        "confidence": confidence,
        "escalationReasons": escalation_reasons,
        "escalateTo": escalate_to,
        # New HITL + Explainability fields
        "decisionReasoning": decision_reasoning,
        "triggerGroups": trigger_groups,
        "riskTier": risk_tier,
        "processingMode": processing_mode,
        "reviewTriggers": all_review_triggers,
        "humanReviewRequired": human_review_required,
        "excludedFromDecisioning": EXCLUDED_FROM_DECISIONING,
    }
    
    return {
        "evaluation": evaluation,
        "routing": evaluation["routing"],
        "decision_reasoning": decision_reasoning,
        "risk_tier": risk_tier,
        "processing_mode": processing_mode,
        "review_triggers": all_review_triggers,
        "trigger_groups": trigger_groups,
    }

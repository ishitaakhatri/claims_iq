"""
LangGraph-based Rule Assistant — Conversational field-by-field flow.

Graph:
  START → route_step → ask_type / ask_field / confirm_deploy / greet
  Each node returns a response to the user.

The frontend sends: { message, context: { step, collected, current_field_index, ... } }
The backend returns: { response, next_step, collected, current_field_index, ... }
"""
import os
import json
from typing import TypedDict, Optional, Dict, Any, List
from langgraph.graph import StateGraph, START, END
from openai import OpenAI

# ─── All 12 main extractable fields with descriptions ─────────────────────────
ALL_FIELDS = {
    "claimAmount": {"label": "Claim Amount", "type": "number", "hint": "The monetary value of the claim (e.g. 5000, 25000)."},
    "completeness": {"label": "Document Completeness", "type": "number", "hint": "A percentage score from 0-100 indicating how complete the claim document is."},
    "fraudScore": {"label": "Fraud Score", "type": "number", "hint": "A score from 0-100 representing the fraud risk level (0=safe, 100=high risk)."},
    "claimNumber": {"label": "Claim Number", "type": "string", "hint": "The unique identifier for the claim (e.g. CLM-2024-001)."},
    "policyNumber": {"label": "Policy Number", "type": "string", "hint": "The insurance policy reference number."},
    "claimantName": {"label": "Claimant Name", "type": "string", "hint": "Full name of the person filing the claim."},
    "claimantId": {"label": "Claimant ID", "type": "string", "hint": "A unique ID for the claimant."},
    "claimType": {"label": "Claim Type", "type": "string", "hint": "The category of claim (e.g. Medical, Auto, Property, Life, Liability)."},
    "policyStatus": {"label": "Policy Status", "type": "string", "hint": "Current status of the policy: active, inactive, suspended, or unknown."},
    "incidentDate": {"label": "Incident Date", "type": "string", "hint": "Date the incident occurred (YYYY-MM-DD format)."},
    "filingDate": {"label": "Filing Date", "type": "string", "hint": "Date the claim was filed (YYYY-MM-DD format)."},
    "providerName": {"label": "Provider Name", "type": "string", "hint": "Name of the service provider (e.g. hospital, repair shop)."},
    "contactNumber": {"label": "Contact Number", "type": "string", "hint": "Phone number for the claimant."},
}

RULE_TYPES = {
    "threshold": {
        "label": "Threshold Rule",
        "description": "Compares a numeric field against a value. Example: claims ≤ $5,000 are auto-approved.",
        "fields_needed": ["name", "description", "field_name", "operator", "value", "weight"],
        "operators": ["lte", "lt", "gte", "gt", "eq"],
    },
    "comparison": {
        "label": "Comparison Rule",
        "description": "Matches a field value exactly. Example: policy status must equal 'active'.",
        "fields_needed": ["name", "description", "field_name", "operator", "value", "weight"],
        "operators": ["eq"],
    },
    "cross_field": {
        "label": "Cross-Field Analysis",
        "description": "Validates relationships between data points. Example: duplicate claim detection.",
        "fields_needed": ["name", "description", "field_name", "operator", "weight"],
        "operators": ["not_duplicate"],
    },
}

OP_LABELS = {"lte": "≤ (less than or equal)", "lt": "< (less than)", "gte": "≥ (greater than or equal)", "gt": "> (greater than)", "eq": "= (equals)", "not_duplicate": "NOT DUPLICATE"}


class RuleAssistantState(TypedDict):
    message: str
    context: dict
    response: str
    next_step: str
    collected: dict
    current_field_index: int
    rule_data: Optional[Dict[str, Any]]


# ─── Nodes ────────────────────────────────────────────────────────────────────

def greet_node(state: RuleAssistantState):
    """Initial greeting — ask what kind of rule they want."""
    message = state["message"].lower().strip()

    # Try LLM classification
    suggested = _classify_intent(message)

    if suggested and suggested in RULE_TYPES:
        info = RULE_TYPES[suggested]
        response = (
            f"Great choice! I'll help you create a **{info['label']}**.\n"
            f"_{info['description']}_\n\n"
            f"Let's start building your rule step by step.\n\n"
            f"**Step 1 of {len(info['fields_needed'])}**: What would you like to **name** this rule?\n"
            f"_Example: \"High-Value Claim Escalation\" or \"Document Completeness Check\"_"
        )
        return {
            "response": response,
            "next_step": "ask_field",
            "collected": {"rule_type": suggested},
            "current_field_index": 0,
        }
    else:
        response = (
            "I'd love to help you create a new business rule! 🎯\n\n"
            "First, what **type of rule** would you like to create?\n\n"
            "1️⃣ **Threshold** — Compare a numeric field against a value\n"
            "   _e.g. \"Auto-approve claims under $5,000\"_\n\n"
            "2️⃣ **Comparison** — Match a field to an exact value\n"
            "   _e.g. \"Policy must be active\"_\n\n"
            "3️⃣ **Cross-Field** — Detect relationships/duplicates\n"
            "   _e.g. \"Flag duplicate claim numbers\"_\n\n"
            "Just type the number (1, 2, or 3) or describe what you want!"
        )
        return {
            "response": response,
            "next_step": "ask_type",
            "collected": {},
            "current_field_index": 0,
        }


def ask_type_node(state: RuleAssistantState):
    """Parse user's type selection."""
    message = state["message"].lower().strip()
    collected = state.get("collected", {})

    selected = None
    if message in ["1", "threshold"]:
        selected = "threshold"
    elif message in ["2", "comparison"]:
        selected = "comparison"
    elif message in ["3", "cross_field", "cross field", "cross-field", "duplicate"]:
        selected = "cross_field"
    else:
        selected = _classify_intent(message)

    if selected and selected in RULE_TYPES:
        info = RULE_TYPES[selected]
        collected["rule_type"] = selected
        response = (
            f"Perfect! Setting up a **{info['label']}**.\n"
            f"_{info['description']}_\n\n"
            f"**Step 1 of {len(info['fields_needed'])}**: What would you like to **name** this rule?\n"
            f"_Example: \"High-Value Claim Escalation\" or \"Fraud Score Threshold\"_"
        )
        return {
            "response": response,
            "next_step": "ask_field",
            "collected": collected,
            "current_field_index": 0,
        }
    else:
        return {
            "response": "I didn't quite catch that. Please type **1** (Threshold), **2** (Comparison), or **3** (Cross-Field).",
            "next_step": "ask_type",
            "collected": collected,
            "current_field_index": 0,
        }


def ask_field_node(state: RuleAssistantState):
    """Collect rule fields one by one."""
    message = state["message"].strip()
    collected = state.get("collected", {})
    idx = state.get("current_field_index", 0)
    rule_type = collected.get("rule_type", "threshold")
    fields_needed = RULE_TYPES[rule_type]["fields_needed"]

    # Save the current field's answer
    if idx < len(fields_needed):
        current_field = fields_needed[idx]
        value = _parse_field_value(current_field, message, rule_type)
        collected[current_field] = value
        idx += 1

    # Check if all fields collected
    if idx >= len(fields_needed):
        # Build the preview
        config = {}
        if "field_name" in collected:
            config["field_name"] = collected["field_name"]
        if "operator" in collected:
            config["operator"] = collected["operator"]
        if "value" in collected:
            config["value"] = collected["value"]

        op_label = OP_LABELS.get(collected.get("operator", ""), collected.get("operator", ""))
        preview_lines = [
            f"📋 **Rule Preview**\n",
            f"• **Name:** {collected.get('name', 'Unnamed')}",
            f"• **Description:** {collected.get('description', 'N/A')}",
            f"• **Type:** {RULE_TYPES[rule_type]['label']}",
            f"• **Field:** {collected.get('field_name', 'N/A')}",
            f"• **Operator:** {op_label}",
        ]
        if "value" in collected:
            preview_lines.append(f"• **Value:** {collected['value']}")
        preview_lines.append(f"• **Weight:** {collected.get('weight', 30)}")
        preview_lines.append(f"\nDoes this look correct? Type **yes** to deploy or **no** to start over.")

        return {
            "response": "\n".join(preview_lines),
            "next_step": "confirm_deploy",
            "collected": collected,
            "current_field_index": idx,
        }

    # Ask for the next field
    next_field = fields_needed[idx]
    total = len(fields_needed)
    step_num = idx + 1
    prompt = _build_field_prompt(next_field, step_num, total, rule_type)

    return {
        "response": prompt,
        "next_step": "ask_field",
        "collected": collected,
        "current_field_index": idx,
    }


def confirm_deploy_node(state: RuleAssistantState):
    """User confirms deployment."""
    message = state["message"].lower().strip()
    collected = state.get("collected", {})

    if message in ["yes", "y", "deploy", "confirm", "ok", "sure", "yeah"]:
        # Build the rule data for DB insertion
        rule_type = collected.get("rule_type", "threshold")
        config = {}
        if "field_name" in collected:
            config["field_name"] = collected["field_name"]
        if "operator" in collected:
            config["operator"] = collected["operator"]
        if "value" in collected:
            val = collected["value"]
            try:
                val = float(val)
                if val == int(val):
                    val = int(val)
            except (ValueError, TypeError):
                pass
            config["value"] = val

        rule_data = {
            "name": collected.get("name", "Unnamed Rule"),
            "description": collected.get("description", ""),
            "rule_type": rule_type,
            "weight": int(collected.get("weight", 30)),
            "is_active": True,
            "config": config,
        }

        return {
            "response": "__DEPLOY__",
            "next_step": "deploy",
            "collected": collected,
            "rule_data": rule_data,
            "current_field_index": 0,
        }
    elif message in ["no", "n", "cancel", "restart"]:
        return {
            "response": "No problem! Let's start over.\n\nWhat **type of rule** would you like to create?\n\n1️⃣ **Threshold**\n2️⃣ **Comparison**\n3️⃣ **Cross-Field**",
            "next_step": "ask_type",
            "collected": {},
            "current_field_index": 0,
        }
    else:
        return {
            "response": "Please type **yes** to deploy the rule, or **no** to start over.",
            "next_step": "confirm_deploy",
            "collected": collected,
            "current_field_index": state.get("current_field_index", 0),
        }


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _classify_intent(message: str) -> Optional[str]:
    """Use keyword matching + optional LLM to determine rule type."""
    msg = message.lower()
    if any(w in msg for w in ["amount", "threshold", "limit", "$", "dollar", "over", "under", "exceed", "less than", "more than", "greater", "above", "below"]):
        return "threshold"
    if any(w in msg for w in ["status", "match", "equal", "active", "type", "compare", "equals"]):
        return "comparison"
    if any(w in msg for w in ["duplicate", "cross", "unique", "reference", "already exists"]):
        return "cross_field"

    # Try LLM if available
    api_key = os.getenv("VITE_OPENAI_API_KEY")
    if api_key:
        try:
            client = OpenAI(api_key=api_key)
            res = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": f'Classify this rule request into one of: threshold, comparison, cross_field, unknown. Reply JSON: {{"type":"..."}}. Message: "{message}"'}],
                response_format={"type": "json_object"},
                max_tokens=30
            )
            t = json.loads(res.choices[0].message.content).get("type")
            if t in ["threshold", "comparison", "cross_field"]:
                return t
        except Exception:
            pass
    return None


def _build_field_prompt(field: str, step: int, total: int, rule_type: str) -> str:
    """Generate a helpful prompt for each field."""
    if field == "name":
        return (
            f"**Step {step} of {total}**: What would you like to **name** this rule?\n"
            f"_Example: \"High-Value Claim Escalation\" or \"Fraud Score Threshold\"_"
        )
    elif field == "description":
        return (
            f"**Step {step} of {total}**: Give a short **description** of what this rule does.\n"
            f"_Example: \"Claims over $25,000 require senior review\"_"
        )
    elif field == "field_name":
        field_list = "\n".join([f"  • `{k}` — {v['label']} ({v['hint']})" for k, v in ALL_FIELDS.items()])
        return (
            f"**Step {step} of {total}**: Which **field** should this rule check?\n\n"
            f"Available fields:\n{field_list}\n\n"
            f"_Type the field name (e.g. `claimAmount` or `policyStatus`)_"
        )
    elif field == "operator":
        ops = RULE_TYPES[rule_type]["operators"]
        op_list = "\n".join([f"  • `{op}` — {OP_LABELS.get(op, op)}" for op in ops])
        return (
            f"**Step {step} of {total}**: What **operator** should be used?\n\n"
            f"Available operators:\n{op_list}\n\n"
            f"_Type the operator (e.g. `lte` for ≤)_"
        )
    elif field == "value":
        return (
            f"**Step {step} of {total}**: What **value** should this rule compare against?\n"
            f"_For numeric fields: enter a number (e.g. `5000`, `80`). For text fields: enter the exact match value (e.g. `active`)._"
        )
    elif field == "weight":
        return (
            f"**Step {step} of {total}**: What **weight** (priority score) should this rule have? (1-100)\n"
            f"_Higher weight = more impact on the final decision. Default is 30. Suggested: 25-50 for most rules._"
        )
    return f"**Step {step} of {total}**: Please provide a value for **{field}**."


def _parse_field_value(field: str, message: str, rule_type: str) -> Any:
    """Parse & validate user input for a field."""
    msg = message.strip()
    if field == "weight":
        try:
            return max(1, min(100, int(msg)))
        except ValueError:
            return 30
    if field == "value":
        try:
            v = float(msg)
            return int(v) if v == int(v) else v
        except ValueError:
            return msg
    if field == "field_name":
        # Fuzzy match
        lower = msg.lower().replace(" ", "")
        for k in ALL_FIELDS:
            if lower == k.lower() or lower == ALL_FIELDS[k]["label"].lower().replace(" ", ""):
                return k
        return msg
    if field == "operator":
        lower = msg.lower().strip('`')
        for op in RULE_TYPES[rule_type]["operators"]:
            if lower == op or lower == OP_LABELS.get(op, "").split("(")[0].strip().lower():
                return op
        return lower
    return msg


# ─── Graph ────────────────────────────────────────────────────────────────────

def _route(state: RuleAssistantState):
    step = state["context"].get("step", "initial")
    if step == "ask_type":
        return "ask_type"
    elif step == "ask_field":
        return "ask_field"
    elif step == "confirm_deploy":
        return "confirm_deploy"
    else:
        return "greet"


def build_rule_assistant_graph():
    workflow = StateGraph(RuleAssistantState)

    workflow.add_node("greet", greet_node)
    workflow.add_node("ask_type", ask_type_node)
    workflow.add_node("ask_field", ask_field_node)
    workflow.add_node("confirm_deploy", confirm_deploy_node)

    workflow.add_conditional_edges(START, _route, {
        "greet": "greet",
        "ask_type": "ask_type",
        "ask_field": "ask_field",
        "confirm_deploy": "confirm_deploy",
    })

    workflow.add_edge("greet", END)
    workflow.add_edge("ask_type", END)
    workflow.add_edge("ask_field", END)
    workflow.add_edge("confirm_deploy", END)

    return workflow.compile()


rule_assistant_app = build_rule_assistant_graph()

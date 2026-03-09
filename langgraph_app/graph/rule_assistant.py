"""
LangGraph-based Rule Assistant — Conversational field-by-field flow.
"""

import os
import json
import re
from typing import TypedDict, Optional, Dict, Any
from langgraph.graph import StateGraph, START, END
from openai import OpenAI

client = OpenAI(api_key=os.getenv("VITE_OPENAI_API_KEY"))

# ─────────────────────────────────────────────────────────
# Fields
# ─────────────────────────────────────────────────────────

ALL_FIELDS = {
    "claimAmount": {"label": "Claim Amount", "type": "number"},
    "completeness": {"label": "Document Completeness", "type": "number"},
    "fraudScore": {"label": "Fraud Score", "type": "number"},
    "claimNumber": {"label": "Claim Number", "type": "string"},
    "policyNumber": {"label": "Policy Number", "type": "string"},
    "claimantName": {"label": "Claimant Name", "type": "string"},
    "claimantId": {"label": "Claimant ID", "type": "string"},
    "claimType": {"label": "Claim Type", "type": "string"},
    "policyStatus": {"label": "Policy Status", "type": "string"},
    "incidentDate": {"label": "Incident Date", "type": "string"},
    "filingDate": {"label": "Filing Date", "type": "string"},
    "providerName": {"label": "Provider Name", "type": "string"},
    "contactNumber": {"label": "Contact Number", "type": "string"},
}

RULE_TYPES = {
    "threshold": {
        "label": "Threshold Rule",
        "fields_needed": ["name","description","field_name","operator","value","weight"],
        "operators": ["lte","lt","gte","gt"],
    },
    "comparison": {
        "label": "Comparison Rule",
        "fields_needed": ["name","description","field_name","operator","value","weight"],
        "operators": ["eq"],
    },
    "cross_field": {
        "label": "Cross Field Rule",
        "fields_needed": ["name","description","field_name","operator","weight"],
        "operators": ["not_duplicate"],
    }
}

OP_LABELS = {
    "lte":"≤",
    "lt":"<",
    "gte":"≥",
    "gt":">",
    "eq":"=",
    "not_duplicate":"NOT DUPLICATE"
}

# ─────────────────────────────────────────────────────────
# Field Helpers
# ─────────────────────────────────────────────────────────

def get_numeric_fields():
    return [k for k, v in ALL_FIELDS.items() if v["type"] == "number"]

def get_string_fields():
    return [k for k, v in ALL_FIELDS.items() if v["type"] == "string"]

def format_available_fields():
    numeric = get_numeric_fields()
    string = get_string_fields()
    return (
        f"  📊 Numeric: {', '.join(numeric)}\n"
        f"  📝 Text: {', '.join(string)}"
    )

def format_available_operators(rule_type):
    ops = RULE_TYPES[rule_type]["operators"]
    labels = [f"{OP_LABELS.get(op, op)} ({op})" for op in ops]
    return ", ".join(labels)


# ─────────────────────────────────────────────────────────
# State
# ─────────────────────────────────────────────────────────

class RuleAssistantState(TypedDict):
    message: str
    context: dict
    response: str
    next_step: str
    collected: dict
    current_field_index: int
    rule_data: Optional[Dict[str, Any]]

# ─────────────────────────────────────────────────────────
# LLM Helpers
# ─────────────────────────────────────────────────────────

def classify_intent(message: str):

    prompt = f"""
Classify the rule request.

Allowed types:
threshold
comparison
cross_field

Return JSON:
{{"type":"threshold"}}

Message:
{message}
"""

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"user","content":prompt}],
        response_format={"type":"json_object"},
        temperature=0
    )

    return json.loads(res.choices[0].message.content).get("type")


def extract_rule_name(text):

    prompt = f"""
Extract a short rule name.

Return JSON:
{{"name":"..." }}

Message:
{text}
"""

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"user","content":prompt}],
        response_format={"type":"json_object"},
        temperature=0
    )

    return json.loads(res.choices[0].message.content)["name"]


def extract_rule_from_text(message):

    field_descriptions = "\n".join(
        f"  - {k}: {v['label']} ({v['type']})" for k, v in ALL_FIELDS.items()
    )

    prompt = f"""
Extract as many rule fields as possible from the user's message.

Return a JSON object with these keys (omit any that cannot be determined):
- rule_type: one of "threshold", "comparison", "cross_field"
- field_name: the data field this rule checks (must be one of the allowed fields below)
- operator: the comparison operator (must be one of the allowed operators below)
- value: the threshold or comparison value
- name: a short, descriptive name for this rule (e.g. "Auto Approve Small Claims")
- description: a one-line description of what the rule does
- weight: importance weight 1-100 (default 30 if not mentioned)

Allowed rule types:
- "threshold": compares a numeric field against a value (uses lte, lt, gte, gt, eq)
- "comparison": matches a field value exactly (uses eq only)
- "cross_field": validates relationships between fields (uses not_duplicate)

Allowed fields:
{field_descriptions}

Allowed operators: lte, lt, gte, gt, eq, not_duplicate

User message:
{message}
"""

    try:
        res = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role":"user","content":prompt}],
            response_format={"type":"json_object"},
            temperature=0
        )
        return json.loads(res.choices[0].message.content)
    except:
        return None


def extract_edit_intent_from_text(message, fields_needed):
    prompt = f"""
    The user is at the confirmation step of creating a business rule, and they want to edit a field.
    Given the user's message, identify which field they want to edit, and if they provided a new value for it.

    Available fields they can edit: {fields_needed}

    Return a JSON object with:
    - field: the exact name of the field to edit (must be one of the available fields above). Return null if unclear.
    - value: the new value they want to set it to. Return null if they just said they want to edit, but didn't provide a value.

    User message: {message}
    """
    try:
        res = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role":"user","content":prompt}],
            response_format={"type":"json_object"},
            temperature=0
        )
        return json.loads(res.choices[0].message.content)
    except:
        return None


# ─────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────

def normalize_string(s: str) -> str:
    """Normalize string by removing spaces, non-alphanumeric chars, forcing lowercase, and stripping trailing 's'."""
    val = re.sub(r'[^a-zA-Z0-9]', '', str(s)).lower()
    if val.endswith('s') and len(val) > 1 and not val.endswith('ss'):
        val = val[:-1]
    return val


def validate_field_name(value):

    if value in ALL_FIELDS:
        return value

    normalized_input = normalize_string(value)
    
    for valid_field, field_data in ALL_FIELDS.items():
        if normalized_input == normalize_string(valid_field):
            return valid_field
            
        label = field_data["label"]
        if normalized_input == normalize_string(label):
            return valid_field

    raise ValueError(
        f"Invalid field '{value}'. Choose one of: {', '.join(ALL_FIELDS.keys())}"
    )


def validate_operator(op, rule_type):

    allowed = RULE_TYPES[rule_type]["operators"]

    if op not in allowed:
        raise ValueError(
            f"Invalid operator. Allowed: {', '.join(allowed)}"
        )

    return op


def validate_weight(value):

    try:
        w = int(value)
    except:
        raise ValueError("Weight must be a number.")

    if not 1 <= w <= 100:
        raise ValueError("Weight must be between 1 and 100.")

    return w


def validate_value(field_name,value):

    field_type = ALL_FIELDS[field_name]["type"]

    if field_type == "number":
        try:
            return float(value)
        except:
            raise ValueError(f"{field_name} must be numeric")

    return value


# ─────────────────────────────────────────────────────────
# Nodes
# ─────────────────────────────────────────────────────────

def greet_node(state: RuleAssistantState):

    message = state["message"]

    extracted = extract_rule_from_text(message)

    if extracted:

        rule_type = extracted.get("rule_type")
        field = extracted.get("field_name")
        if field not in ALL_FIELDS:
            field = None
        operator = extracted.get("operator")
        value = extracted.get("value")
        name = extracted.get("name")

        # If no meaningful fields were extracted (just a default rule_type),
        # fall through to ask the user to pick a rule type
        has_meaningful_fields = any([field, operator, value, name])
        if not has_meaningful_fields:
            # No useful info extracted — ask user to choose rule type
            return {
                "response": "What type of rule would you like?\n\n1️⃣ Threshold Rule — compares a numeric field against a value\n2️⃣ Comparison Rule — matches a field value exactly\n3️⃣ Cross-Field Rule — validates relationships between fields",
                "next_step": "ask_type",
                "collected": {},
                "current_field_index": 0
            }

        if rule_type not in RULE_TYPES:
            rule_type = "threshold"

        description = extracted.get("description")
        weight = extracted.get("weight")

        # Build collected dict with everything we got
        collected = {"rule_type": rule_type}

        if name:
            collected["name"] = name
        if description:
            collected["description"] = description
        if field:
            collected["field_name"] = field
        if operator:
            collected["operator"] = operator
        if value is not None:
            collected["value"] = value
        if weight is not None:
            try:
                collected["weight"] = int(weight)
            except (ValueError, TypeError):
                pass

        fields_needed = RULE_TYPES[rule_type]["fields_needed"]

        # Build rich preview of what was detected
        lines = ["🔍 I detected the following from your description:\n"]
        lines.append("📋 Auto-Detected Fields:")
        lines.append(f"  • Rule Type: {RULE_TYPES[rule_type]['label']}")

        for fn in fields_needed:
            if fn in collected:
                val = collected[fn]
                if fn == "field_name" and val in ALL_FIELDS:
                    val = f"{val} ({ALL_FIELDS[val]['label']})"
                elif fn == "operator":
                    val = f"{OP_LABELS.get(val, val)} ({val})"
                lines.append(f"  • {fn}: {val}")
            else:
                lines.append(f"  • {fn}: ⚠️ Not detected")

        # Show available fields for this rule type
        lines.append(f"\n📝 Available fields for {RULE_TYPES[rule_type]['label']}:")
        lines.append(format_available_fields())

        # Check what's still missing
        missing = [f for f in fields_needed if f not in collected]

        if not missing:
            # All fields detected — go straight to deploy confirmation
            op_label = OP_LABELS.get(collected.get("operator", ""), "")
            lines.append("\n✅ All required fields detected! Here's your rule preview:\n")
            lines.append(f"  Name: {collected.get('name')}")
            lines.append(f"  Description: {collected.get('description', 'N/A')}")
            lines.append(f"  Type: {RULE_TYPES[rule_type]['label']}")
            lines.append(f"  Field: {collected.get('field_name')}")
            lines.append(f"  Operator: {op_label}")
            lines.append(f"  Value: {collected.get('value')}")
            lines.append(f"  Weight: {collected.get('weight', 30)}")
            lines.append("\nType **deploy** to create the rule")
            lines.append("or **edit <field_name>** to change any value.")

            # Set default weight if not provided
            if "weight" not in collected:
                collected["weight"] = 30

            return {
                "response": "\n".join(lines),
                "next_step": "confirm_deploy",
                "collected": collected,
                "current_field_index": len(fields_needed)
            }
        else:
            # Some fields missing — ask for the first missing one
            lines.append(f"\n⚠️ Missing fields: {', '.join(missing)}")
            lines.append(f"\nLet's fill in the remaining details.")

            # Find the index of the first missing field
            idx = 0
            while idx < len(fields_needed) and fields_needed[idx] in collected:
                idx += 1

            next_field = fields_needed[idx]
            lines.append(f"\nStep {idx + 1}: Please provide **{next_field}**")

            # Add relevant suggestions for the next field
            if next_field == "field_name":
                lines.append(f"\nAvailable fields:")
                lines.append(format_available_fields())
            elif next_field == "operator":
                lines.append(f"\nAvailable operators: {format_available_operators(rule_type)}")

            return {
                "response": "\n".join(lines),
                "next_step": "ask_field",
                "collected": collected,
                "current_field_index": idx
            }

    # No fields extracted — try to at least classify the intent
    suggested = classify_intent(message)

    if suggested and suggested in RULE_TYPES:
        lines = [
            f"Great! We'll create a **{RULE_TYPES[suggested]['label']}**.\n",
            f"📝 Available fields for this rule type:",
            format_available_fields(),
            f"\nStep 1: What should we name this rule?"
        ]
        return {
            "response": "\n".join(lines),
            "next_step": "ask_field",
            "collected": {"rule_type": suggested},
            "current_field_index": 0
        }

    return {
        "response": "What type of rule would you like?\n\n1️⃣ Threshold Rule — compares a numeric field against a value\n2️⃣ Comparison Rule — matches a field value exactly\n3️⃣ Cross-Field Rule — validates relationships between fields",
        "next_step": "ask_type",
        "collected": {},
        "current_field_index": 0
    }


def ask_type_node(state: RuleAssistantState):

    message = state["message"].lower().strip()

    if message == "1":
        selected = "threshold"
    elif message == "2":
        selected = "comparison"
    elif message == "3":
        selected = "cross_field"
    else:
        selected = classify_intent(message)

    if selected not in RULE_TYPES:
        return {
            "response": "Please type 1, 2 or 3:\n\n1️⃣ Threshold Rule\n2️⃣ Comparison Rule\n3️⃣ Cross-Field Rule",
            "next_step": "ask_type"
        }

    lines = [
        f"Great choice! Creating a **{RULE_TYPES[selected]['label']}**.\n",
        f"📝 Available fields for this rule type:",
        format_available_fields(),
        f"\nStep 1: What should we name this rule?"
    ]

    return {
        "response": "\n".join(lines),
        "next_step": "ask_field",
        "collected": {"rule_type": selected},
        "current_field_index": 0
    }


def ask_field_node(state: RuleAssistantState):

    message = state["message"].strip()

    collected = state.get("collected", {})
    idx = state.get("current_field_index", 0)

    rule_type = collected["rule_type"]
    fields_needed = RULE_TYPES[rule_type]["fields_needed"]

    if idx < len(fields_needed):

        field = fields_needed[idx]

        try:
            if field == "name":
                value = extract_rule_name(message)
            elif field == "field_name":
                value = validate_field_name(message)
            elif field == "operator":
                value = validate_operator(message, rule_type)
            elif field == "weight":
                value = validate_weight(message)
            elif field == "value":
                value = validate_value(collected["field_name"], message)
            else:
                value = message

            collected[field] = value

        except Exception as e:
            # Show the error along with available options for relevant fields
            error_msg = str(e)
            if field == "field_name":
                error_msg += f"\n\nAvailable fields:\n{format_available_fields()}"
            elif field == "operator":
                error_msg += f"\n\nAvailable operators: {format_available_operators(rule_type)}"

            return {
                "response": error_msg,
                "next_step": "ask_field",
                "collected": collected,
                "current_field_index": idx
            }

        idx += 1

    # Skip fields that are already collected (from auto-detection)
    while idx < len(fields_needed) and fields_needed[idx] in collected:
        idx += 1

    if idx >= len(fields_needed):

        op_label = OP_LABELS.get(collected.get("operator"), "")
        field_name = collected.get("field_name", "")
        field_label = ALL_FIELDS.get(field_name, {}).get("label", field_name)

        preview = f"""
📋 Rule Preview

  Name: {collected.get("name")}
  Description: {collected.get("description", "N/A")}
  Type: {RULE_TYPES[rule_type]["label"]}
  Field: {field_name} ({field_label})
  Operator: {op_label}
  Value: {collected.get("value")}
  Weight: {collected.get("weight")}

Type **deploy** to create the rule
or **edit <field_name>** to change any value."""

        return {
            "response": preview,
            "next_step": "confirm_deploy",
            "collected": collected,
            "current_field_index": idx
        }

    # Ask for the next missing field with helpful suggestions
    next_field = fields_needed[idx]
    prompt_lines = [f"Step {idx + 1}: Please provide **{next_field}**"]

    if next_field == "field_name":
        prompt_lines.append(f"\nAvailable fields:\n{format_available_fields()}")
    elif next_field == "operator":
        prompt_lines.append(f"\nAvailable operators: {format_available_operators(rule_type)}")
    elif next_field == "weight":
        prompt_lines.append("\n(A number from 1 to 100 — higher = more important)")

    return {
        "response": "\n".join(prompt_lines),
        "next_step": "ask_field",
        "collected": collected,
        "current_field_index": idx
    }


def confirm_deploy_node(state: RuleAssistantState):

    message = state["message"].lower().strip()
    collected = state["collected"]

    rule_type = collected["rule_type"]
    fields_needed = RULE_TYPES[rule_type]["fields_needed"]

    # Handle general edit intent — "i want to edit", "change", "modify", etc.
    edit_words = ["change", "modify", "update", "want to edit", "i want to edit", "edit this", "want to change", "set ", "instead of", "make it"]
    if any(w in message for w in edit_words) or message.startswith("edit"):

        # Try to use LLM to parse natural language edit request
        edit_intent = extract_edit_intent_from_text(message, fields_needed)
        
        if edit_intent and edit_intent.get("field") in fields_needed:
            field = edit_intent["field"]
            new_val = edit_intent.get("value")
            
            if new_val is not None:
                # User provided a value (e.g., "set value to 6000")
                try:
                    if field == "name":
                        validated_val = extract_rule_name(str(new_val))
                    elif field == "field_name":
                        validated_val = validate_field_name(str(new_val))
                    elif field == "operator":
                        validated_val = validate_operator(str(new_val), rule_type)
                    elif field == "weight":
                        validated_val = validate_weight(str(new_val))
                    elif field == "value":
                        validated_val = validate_value(collected.get("field_name"), str(new_val))
                    else:
                        validated_val = str(new_val)
                    
                    collected[field] = validated_val
                    
                    # Generate updated preview
                    op_label = OP_LABELS.get(collected.get("operator", ""), "")
                    field_name = collected.get("field_name", "")
                    field_label = ALL_FIELDS.get(field_name, {}).get("label", field_name)
                    
                    preview = f"""✅ Updated **{field}** to {validated_val}.

📋 Updated Rule Preview

  Name: {collected.get("name")}
  Description: {collected.get("description", "N/A")}
  Type: {RULE_TYPES[rule_type]["label"]}
  Field: {field_name} ({field_label})
  Operator: {op_label}
  Value: {collected.get("value")}
  Weight: {collected.get("weight")}

Type **deploy** to create the rule
or **edit <field_name>** to change any value."""

                    return {
                        "response": preview,
                        "next_step": "confirm_deploy",
                        "collected": collected,
                        "current_field_index": len(fields_needed)
                    }
                    
                except Exception as e:
                    # Show error and ask for the value again properly
                    hint = ""
                    if field == "field_name":
                        hint = f"\n\nAvailable fields:\n{format_available_fields()}"
                    elif field == "operator":
                        hint = f"\n\nAvailable operators: {format_available_operators(rule_type)}"
                    
                    idx = fields_needed.index(field)
                    return {
                        "response": f"I tried to set **{field}** to {new_val}, but got an error: {str(e)}\n\nPlease enter a valid value for **{field}**{hint}",
                        "next_step": "ask_field",
                        "collected": collected,
                        "current_field_index": idx
                    }

            else:
                # User just said to edit a specific field but didn't provide new value
                hint = ""
                if field == "field_name":
                    hint = f"\n\nAvailable fields:\n{format_available_fields()}"
                elif field == "operator":
                    hint = f"\n\nAvailable operators: {format_available_operators(rule_type)}"
                elif field == "weight":
                    hint = "\n\n(A number from 1 to 100)"
                
                idx = fields_needed.index(field)
                return {
                    "response": f"Enter new value for **{field}**{hint}",
                    "next_step": "ask_field",
                    "collected": collected,
                    "current_field_index": idx
                }

        # Generic "edit" or could not determine field — show all editable fields
        lines = ["Which field would you like to edit?\n"]
        for i, fn in enumerate(fields_needed):
            val = collected.get(fn, "—")
            if fn == "field_name" and val in ALL_FIELDS:
                val = f"{val} ({ALL_FIELDS[val]['label']})"
            elif fn == "operator" and val in OP_LABELS:
                val = f"{OP_LABELS[val]} ({val})"
            lines.append(f"  {i + 1}. **{fn}** → {val}")
        lines.append("\nType **edit <field>** (e.g. edit value)")

        return {
            "response": "\n".join(lines),
            "next_step": "confirm_deploy",
            "collected": collected
        }

    # Handle deploy intent
    deploy_words = ["deploy", "yes", "confirm", "looks good", "go ahead", "create", "save", "ok", "done", "ship it", "lgtm"]
    if any(message == w or message.startswith(w) for w in deploy_words):

        config = {}

        if "field_name" in collected:
            config["field_name"] = collected["field_name"]
        if "operator" in collected:
            config["operator"] = collected["operator"]
        if "value" in collected:
            config["value"] = collected["value"]

        rule_data = {
            "name": collected["name"],
            "description": collected.get("description"),
            "rule_type": rule_type,
            "weight": collected["weight"],
            "is_active": True,
            "config": config
        }

        return {
            "response": "__DEPLOY__",
            "next_step": "deploy",
            "rule_data": rule_data,
            "collected": collected,
            "current_field_index": 0
        }

    return {
        "response": "Type **deploy** to create the rule, or **edit <field>** to change a value.\n\nEditable fields: " + ", ".join(fields_needed),
        "next_step": "confirm_deploy",
        "collected": collected
    }


# ─────────────────────────────────────────────────────────
# Graph
# ─────────────────────────────────────────────────────────

def route(state:RuleAssistantState):

    step = state["context"].get("step","initial")

    if step=="ask_type":
        return "ask_type"

    if step=="ask_field":
        return "ask_field"

    if step=="confirm_deploy":
        return "confirm_deploy"

    return "greet"


def build_rule_assistant_graph():

    workflow = StateGraph(RuleAssistantState)

    workflow.add_node("greet",greet_node)
    workflow.add_node("ask_type",ask_type_node)
    workflow.add_node("ask_field",ask_field_node)
    workflow.add_node("confirm_deploy",confirm_deploy_node)

    workflow.add_conditional_edges(
        START,
        route,
        {
            "greet":"greet",
            "ask_type":"ask_type",
            "ask_field":"ask_field",
            "confirm_deploy":"confirm_deploy"
        }
    )

    workflow.add_edge("greet",END)
    workflow.add_edge("ask_type",END)
    workflow.add_edge("ask_field",END)
    workflow.add_edge("confirm_deploy",END)

    return workflow.compile()


rule_assistant_app = build_rule_assistant_graph()
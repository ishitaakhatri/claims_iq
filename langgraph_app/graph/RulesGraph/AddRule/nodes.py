"""
AddRule — Nodes for the add-rule conversational flow.

LLM helpers for rule extraction and field-by-field collection,
plus the four graph nodes: greet, ask_type, ask_field, confirm_deploy.

All next_step values are prefixed with "add_" for orchestrator routing.
"""

import os
import json
from openai import OpenAI

from ..state import (
    RuleAssistantState,
    ALL_FIELDS, RULE_TYPES, OP_LABELS,
    format_available_fields, format_available_operators,
    validate_field_name, validate_operator, validate_weight, validate_value,
)

client = OpenAI(api_key=os.getenv("VITE_OPENAI_API_KEY"))

# ─────────────────────────────────────────────────────────
# LLM Helpers (add-flow specific)
# ─────────────────────────────────────────────────────────

def classify_rule_type(message: str):
    """Classify which rule type the user wants (threshold/comparison/cross_field)."""
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
    """Extract a short rule name from user text."""
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
    """Extract as many rule fields as possible from a natural-language message."""
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
    """At the confirm step, parse which field the user wants to edit and its new value."""
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
# Nodes
# ─────────────────────────────────────────────────────────

def add_greet_node(state: RuleAssistantState):
    """Entry point for the add flow — extract rule fields or ask for type."""

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

        has_meaningful_fields = any([field, operator, value, name])
        if not has_meaningful_fields:
            return {
                "response": "What type of rule would you like?\n\n1️⃣ Threshold Rule — compares a numeric field against a value\n2️⃣ Comparison Rule — matches a field value exactly\n3️⃣ Cross-Field Rule — validates relationships between fields",
                "next_step": "add_ask_type",
                "collected": {},
                "current_field_index": 0,
                "intent": "add",
            }

        if rule_type not in RULE_TYPES:
            rule_type = "threshold"

        description = extracted.get("description")
        weight = extracted.get("weight")

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

        lines.append(f"\n📝 Available fields for {RULE_TYPES[rule_type]['label']}:")
        lines.append(format_available_fields())

        missing = [f for f in fields_needed if f not in collected]

        if not missing:
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

            if "weight" not in collected:
                collected["weight"] = 30

            return {
                "response": "\n".join(lines),
                "next_step": "add_confirm_deploy",
                "collected": collected,
                "current_field_index": len(fields_needed),
                "intent": "add",
            }
        else:
            lines.append(f"\n⚠️ Missing fields: {', '.join(missing)}")
            lines.append(f"\nLet's fill in the remaining details.")

            idx = 0
            while idx < len(fields_needed) and fields_needed[idx] in collected:
                idx += 1

            next_field = fields_needed[idx]
            lines.append(f"\nStep {idx + 1}: Please provide **{next_field}**")

            if next_field == "field_name":
                lines.append(f"\nAvailable fields:")
                lines.append(format_available_fields())
            elif next_field == "operator":
                lines.append(f"\nAvailable operators: {format_available_operators(rule_type)}")

            return {
                "response": "\n".join(lines),
                "next_step": "add_ask_field",
                "collected": collected,
                "current_field_index": idx,
                "intent": "add",
            }

    # No fields extracted — try to classify the rule type
    suggested = classify_rule_type(message)

    if suggested and suggested in RULE_TYPES:
        lines = [
            f"Great! We'll create a **{RULE_TYPES[suggested]['label']}**.\n",
            f"📝 Available fields for this rule type:",
            format_available_fields(),
            f"\nStep 1: What should we name this rule?"
        ]
        return {
            "response": "\n".join(lines),
            "next_step": "add_ask_field",
            "collected": {"rule_type": suggested},
            "current_field_index": 0,
            "intent": "add",
        }

    return {
        "response": "What type of rule would you like?\n\n1️⃣ Threshold Rule — compares a numeric field against a value\n2️⃣ Comparison Rule — matches a field value exactly\n3️⃣ Cross-Field Rule — validates relationships between fields",
        "next_step": "add_ask_type",
        "collected": {},
        "current_field_index": 0,
        "intent": "add",
    }


def add_ask_type_node(state: RuleAssistantState):
    """User selects a rule type (1/2/3 or natural language)."""

    message = state["message"].lower().strip()

    if message == "1":
        selected = "threshold"
    elif message == "2":
        selected = "comparison"
    elif message == "3":
        selected = "cross_field"
    else:
        selected = classify_rule_type(message)

    if selected not in RULE_TYPES:
        return {
            "response": "Please type 1, 2 or 3:\n\n1️⃣ Threshold Rule\n2️⃣ Comparison Rule\n3️⃣ Cross-Field Rule",
            "next_step": "add_ask_type",
            "intent": "add",
        }

    lines = [
        f"Great choice! Creating a **{RULE_TYPES[selected]['label']}**.\n",
        f"📝 Available fields for this rule type:",
        format_available_fields(),
        f"\nStep 1: What should we name this rule?"
    ]

    return {
        "response": "\n".join(lines),
        "next_step": "add_ask_field",
        "collected": {"rule_type": selected},
        "current_field_index": 0,
        "intent": "add",
    }


def add_ask_field_node(state: RuleAssistantState):
    """Collect one field at a time until all required fields are filled."""

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
            error_msg = str(e)
            if field == "field_name":
                error_msg += f"\n\nAvailable fields:\n{format_available_fields()}"
            elif field == "operator":
                error_msg += f"\n\nAvailable operators: {format_available_operators(rule_type)}"

            return {
                "response": error_msg,
                "next_step": "add_ask_field",
                "collected": collected,
                "current_field_index": idx,
                "intent": "add",
            }

        idx += 1

    # Skip already-collected fields
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
            "next_step": "add_confirm_deploy",
            "collected": collected,
            "current_field_index": idx,
            "intent": "add",
        }

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
        "next_step": "add_ask_field",
        "collected": collected,
        "current_field_index": idx,
        "intent": "add",
    }


def add_confirm_deploy_node(state: RuleAssistantState):
    """Confirm deploy, allow edits, or cancel."""

    message = state["message"].lower().strip()
    collected = state["collected"]

    rule_type = collected["rule_type"]
    fields_needed = RULE_TYPES[rule_type]["fields_needed"]

    # ── Cancel / restart ──
    cancel_words = ["cancel", "nevermind", "never mind", "abort", "stop", "restart"]
    if any(message == w or message.startswith(w) for w in cancel_words):
        return {
            "response": "❌ Rule creation cancelled.\n\nWhat would you like to do?\n\n➕ **Add** a new rule\n🗑️ **Delete** an existing rule\n✏️ **Edit** a rule",
            "next_step": "initial",
            "collected": {},
            "current_field_index": 0,
            "intent": None,
        }

    # ── Handle edit intent ──
    edit_words = ["change", "modify", "update", "want to edit", "i want to edit", "edit this", "want to change", "set ", "instead of", "make it"]
    if any(w in message for w in edit_words) or message.startswith("edit"):

        edit_intent = extract_edit_intent_from_text(message, fields_needed)
        
        if edit_intent and edit_intent.get("field") in fields_needed:
            field = edit_intent["field"]
            new_val = edit_intent.get("value")
            
            if new_val is not None:
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
                        "next_step": "add_confirm_deploy",
                        "collected": collected,
                        "current_field_index": len(fields_needed),
                        "intent": "add",
                    }
                    
                except Exception as e:
                    hint = ""
                    if field == "field_name":
                        hint = f"\n\nAvailable fields:\n{format_available_fields()}"
                    elif field == "operator":
                        hint = f"\n\nAvailable operators: {format_available_operators(rule_type)}"
                    
                    idx = fields_needed.index(field)
                    return {
                        "response": f"I tried to set **{field}** to {new_val}, but got an error: {str(e)}\n\nPlease enter a valid value for **{field}**{hint}",
                        "next_step": "add_ask_field",
                        "collected": collected,
                        "current_field_index": idx,
                        "intent": "add",
                    }

            else:
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
                    "next_step": "add_ask_field",
                    "collected": collected,
                    "current_field_index": idx,
                    "intent": "add",
                }

        # Generic edit — show all fields
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
            "next_step": "add_confirm_deploy",
            "collected": collected,
            "intent": "add",
        }

    # ── Deploy ──
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
            "current_field_index": 0,
            "intent": "add",
        }

    return {
        "response": "Type **deploy** to create the rule, or **edit <field>** to change a value.\n\nEditable fields: " + ", ".join(fields_needed),
        "next_step": "add_confirm_deploy",
        "collected": collected,
        "intent": "add",
    }

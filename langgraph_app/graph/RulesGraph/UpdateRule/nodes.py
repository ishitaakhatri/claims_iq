"""
UpdateRule — 8-node conversational flow for editing existing rules.

Flow: edit_entry → extract_update_intent → check_rule_reference
     → retrieve_candidates → disambiguate → apply_update → confirm_update
     (+ edit_ask_rule for missing rule ref, edit_select for multiple matches)
"""

import os
import json
from openai import OpenAI

from ..state import RuleAssistantState, RULE_TYPES, OP_LABELS, ALL_FIELDS

client = OpenAI(api_key=os.getenv("VITE_OPENAI_API_KEY"))


# ─────────────────────────────────────────────────────────
# LLM Helper
# ─────────────────────────────────────────────────────────

def _extract_update_intent_llm(message: str):
    """Use LLM to extract what the user wants to update and in which rule."""
    field_descriptions = "\n".join(
        f"  - {k}: {v['label']} ({v['type']})" for k, v in ALL_FIELDS.items()
    )
    prompt = f"""
The user wants to update/edit a business rule.
Extract the update intent from their message.

Return a JSON object with:
- field: the rule property to change (one of: name, description, field_name, operator, value, weight, is_active). Return null if unclear.
- old_value: the current value they want to change FROM. Return null if not mentioned.
- new_value: the new value they want to change TO. Return null if not mentioned.
- rule_id: the rule ID if mentioned (e.g. "BR001"). Return null if not found.
- rule_hint: any descriptive reference to the rule (e.g. "claim amount rule", "threshold rule"). Return null if not found.

Available data fields that rules can target:
{field_descriptions}

Available operators: lte, lt, gte, gt, eq, not_duplicate

User message: {message}
"""
    try:
        res = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        return json.loads(res.choices[0].message.content)
    except:
        return None


# ─────────────────────────────────────────────────────────
# Helper: format rule for display
# ─────────────────────────────────────────────────────────

def _format_rule_preview(rule: dict) -> str:
    rule_type_info = RULE_TYPES.get(rule.get("rule_type", ""), {})
    config = rule.get("config", {})
    op = config.get("operator", "")
    op_label = OP_LABELS.get(op, op)
    lines = [
        f"  🆔 ID: **{rule.get('id', 'N/A')}**",
        f"  📛 Name: {rule.get('name', 'N/A')}",
        f"  📝 Description: {rule.get('description', 'N/A')}",
        f"  📂 Type: {rule_type_info.get('label', rule.get('rule_type', 'N/A'))}",
        f"  🔧 Field: {config.get('field_name', 'N/A')}",
        f"  ⚖️ Operator: {op_label}",
        f"  📊 Value: {config.get('value', 'N/A')}",
        f"  🏋️ Weight: {rule.get('weight', 'N/A')}",
        f"  {'🟢' if rule.get('is_active') else '🔴'} Status: {'Active' if rule.get('is_active') else 'Inactive'}",
    ]
    return "\n".join(lines)


def _format_rules_list(rules: list) -> str:
    if not rules:
        return "📭 No rules found."
    lines = ["📋 **Existing Rules:**\n"]
    for i, r in enumerate(rules, 1):
        status = "🟢" if r.get("is_active") else "🔴"
        lines.append(f"  {i}. {status} **{r.get('id', '?')}** — {r.get('name', 'Unnamed')}")
    lines.append("\n💡 Provide the **Rule ID** (e.g. `BR001`) of the rule to update.")
    return "\n".join(lines)


def _find_rule_by_id(rules: list, rule_id: str):
    if not rules or not rule_id:
        return None
    for r in rules:
        if r.get("id", "").upper() == rule_id.upper():
            return r
    return None


# ─────────────────────────────────────────────────────────
# Node 1: edit_entry
# ─────────────────────────────────────────────────────────

def edit_entry_node(state: RuleAssistantState):
    """Entry point — just pass message to extraction."""
    return {
        "context": {"step": "edit_extract"},
        "intent": "edit",
        "error_count": 0,
    }


# ─────────────────────────────────────────────────────────
# Node 2: extract_update_intent (LLM)
# ─────────────────────────────────────────────────────────

def edit_extract_node(state: RuleAssistantState):
    """LLM extracts {field, old_value, new_value, rule_hint} from message."""
    message = state["message"]
    extracted = _extract_update_intent_llm(message)

    if not extracted:
        return {
            "response": "I couldn't understand what you'd like to update. Could you rephrase?\n\nExample: \"Change the threshold from 5000 to 6000 in the claim amount rule\"",
            "context": {"step": "edit_extract"},
            "intent": "edit",
            "error_count": state.get("error_count", 0) + 1,
        }

    return {
        "update_payload": extracted,
        "context": {"step": "edit_check_ref"},
        "intent": "edit",
    }


# ─────────────────────────────────────────────────────────
# Node 3: check_rule_reference
# ─────────────────────────────────────────────────────────

def edit_check_ref_node(state: RuleAssistantState):
    """Check if update_payload has rule_id or rule_hint. Route accordingly."""
    payload = state.get("update_payload") or {}

    rule_id = payload.get("rule_id")
    rule_hint = payload.get("rule_hint")

    if rule_id or rule_hint:
        # Has a reference → retrieve candidates
        return {
            "context": {"step": "edit_retrieve"},
            "intent": "edit",
        }

    # No reference → ask user which rule
    return {
        "context": {"step": "edit_ask_rule"},
        "intent": "edit",
    }


# ─────────────────────────────────────────────────────────
# Node 4: retrieve_candidates (NO LLM — pure matching)
# ─────────────────────────────────────────────────────────

def edit_retrieve_node(state: RuleAssistantState):
    """Search available_rules by ID, name, or field match. No LLM."""
    payload = state.get("update_payload") or {}
    available_rules = state.get("available_rules") or []

    rule_id = payload.get("rule_id")
    rule_hint = payload.get("rule_hint", "")
    field = payload.get("field")

    candidates = []

    # 1. Exact ID match
    if rule_id:
        for r in available_rules:
            if r.get("id", "").upper() == rule_id.upper():
                candidates = [r]
                break

    # 2. Name match (case-insensitive partial or keyword)
    if not candidates and rule_hint:
        hint_lower = rule_hint.lower()
        ignore_words = {"rule", "edit", "update", "change", "delete", "remove", "the", "a", "an"}
        hint_words = [w for w in hint_lower.replace("-", " ").split() if len(w) > 2 and w not in ignore_words]
        
        for r in available_rules:
            name = r.get("name", "").lower()
            desc = r.get("description", "").lower()
            
            # Exact substring match
            if hint_lower in name or hint_lower in desc:
                candidates.append(r)
                continue
                
            # Fuzzy Keyword match
            # Match if at least one meaningful keyword is found in the name or description
            for w in hint_words:
                if w in name or w in desc:
                    candidates.append(r)
                    break

    # 3. Field match — if payload says "update value" and field mentioned
    if not candidates and field:
        field_lower = field.lower()
        for r in available_rules:
            config = r.get("config", {})
            # Match config keys
            if field_lower in str(config.get("field_name", "")).lower():
                candidates.append(r)
            # Match rule-level properties
            if field_lower in ["name", "description", "weight", "is_active"]:
                candidates = available_rules  # All rules have these
                break

    return {
        "update_candidates": candidates,
        "context": {"step": "edit_disambiguate"},
        "intent": "edit",
    }


# ─────────────────────────────────────────────────────────
# Node 5: disambiguate
# ─────────────────────────────────────────────────────────

def edit_disambiguate_node(state: RuleAssistantState):
    """Route based on number of candidates: 1→apply, multiple→select, 0→ask."""
    candidates = state.get("update_candidates") or []
    payload = state.get("update_payload") or {}

    if len(candidates) == 1:
        # Single match → confirm and apply
        rule = candidates[0]
        preview = _format_rule_preview(rule)
        field = payload.get("field", "?")
        new_val = payload.get("new_value")

        if new_val is not None:
            return {
                "response": f"🔍 Found this rule:\n\n{preview}\n\n✏️ I'll update **{field}** to **{new_val}**.\n\nType **confirm** to apply or **cancel** to abort.",
                "update_rule_id": rule["id"],
                "context": {"step": "edit_apply"},
                "intent": "edit",
            }
        else:
            return {
                "response": f"🔍 Found this rule:\n\n{preview}\n\nWhat would you like to change? Tell me the field and new value.\n\nExample: \"set value to 6000\" or \"change name to High Claim Alert\"",
                "update_rule_id": rule["id"],
                "context": {"step": "edit_extract"},
                "intent": "edit",
            }

    if len(candidates) > 1:
        # Multiple matches → ask user to pick
        lines = ["🔍 Multiple rules match your description:\n"]
        for i, r in enumerate(candidates, 1):
            status = "🟢" if r.get("is_active") else "🔴"
            lines.append(f"  {i}. {status} **{r.get('id', '?')}** — {r.get('name', 'Unnamed')}")
        lines.append("\n💡 Which one? Provide the **Rule ID** (e.g. `BR001`).")

        return {
            "response": "\n".join(lines),
            "context": {"step": "edit_select"},
            "intent": "edit",
        }

    # No matches
    available_rules = state.get("available_rules") or []
    if not available_rules:
        return {
            "response": "📭 No rules exist in the system. Would you like to **add** a new rule instead?",
            "context": {"step": "initial"},
            "intent": None,
        }

    rules_list = _format_rules_list(available_rules)
    return {
        "response": f"❌ No rules matched your description.\n\n{rules_list}",
        "context": {"step": "edit_ask_rule"},
        "intent": "edit",
    }


# ─────────────────────────────────────────────────────────
# Node 6: edit_select (user picks from list)
# ─────────────────────────────────────────────────────────

def edit_select_node(state: RuleAssistantState):
    """User picks a rule by ID or number from the candidates list."""
    message = state["message"].strip()
    candidates = state.get("update_candidates") or []
    available_rules = state.get("available_rules") or []
    error_count = state.get("error_count", 0)

    # Try ID match across all rules
    matched = _find_rule_by_id(available_rules, message)

    # Try list number
    if not matched:
        try:
            idx = int(message) - 1
            if 0 <= idx < len(candidates):
                matched = candidates[idx]
        except (ValueError, IndexError):
            pass

    if matched:
        payload = state.get("update_payload") or {}
        preview = _format_rule_preview(matched)
        field = payload.get("field")
        new_val = payload.get("new_value")

        if field and new_val is not None:
            return {
                "response": f"🔍 Selected:\n\n{preview}\n\n✏️ I'll update **{field}** to **{new_val}**.\n\nType **confirm** to apply or **cancel** to abort.",
                "update_rule_id": matched["id"],
                "context": {"step": "edit_apply"},
                "intent": "edit",
            }
        else:
            return {
                "response": f"🔍 Selected:\n\n{preview}\n\nWhat would you like to change?\n\nExample: \"set value to 6000\" or \"change weight to 50\"",
                "update_rule_id": matched["id"],
                "context": {"step": "edit_extract"},
                "intent": "edit",
            }

    # Not found
    error_count += 1
    if error_count >= 3:
        return {
            "response": "❌ Too many attempts. Let's start over.\n\n➕ Add\n🗑️ Delete\n✏️ Edit",
            "context": {"step": "initial"},
            "intent": None,
            "error_count": 0,
        }

    return {
        "response": f"❌ Couldn't find \"{message}\". Please provide a valid **Rule ID** (e.g. `BR001`).",
        "context": {"step": "edit_select"},
        "intent": "edit",
        "error_count": error_count,
    }


# ─────────────────────────────────────────────────────────
# Node 7: apply_update
# ─────────────────────────────────────────────────────────

def edit_apply_node(state: RuleAssistantState):
    """On confirm → return __UPDATE__ signal. On cancel → back to initial."""
    message = state["message"].lower().strip()
    update_rule_id = state.get("update_rule_id")
    payload = state.get("update_payload") or {}

    confirm_words = ["confirm", "yes", "y", "apply", "do it", "go ahead", "sure", "ok", "update"]
    if any(message == w or message.startswith(w) for w in confirm_words):
        return {
            "response": "__UPDATE__",
            "update_rule_id": update_rule_id,
            "update_payload": payload,
            "context": {"step": "edit_confirm"},
            "intent": "edit",
        }

    cancel_words = ["cancel", "no", "n", "abort", "stop", "nevermind", "never mind"]
    if any(message == w or message.startswith(w) for w in cancel_words):
        return {
            "response": "👍 Update cancelled. No changes made.\n\n➕ Add\n🗑️ Delete\n✏️ Edit",
            "context": {"step": "initial"},
            "intent": None,
            "update_payload": None,
            "update_rule_id": None,
            "update_candidates": None,
        }

    return {
        "response": f"Please type **confirm** to apply the update or **cancel** to abort.",
        "context": {"step": "edit_apply"},
        "intent": "edit",
    }


# ─────────────────────────────────────────────────────────
# Node 8: confirm_update (loop or done)
# ─────────────────────────────────────────────────────────

def edit_confirm_node(state: RuleAssistantState):
    """After update succeeds — ask if more changes needed."""
    message = state["message"].lower().strip()

    yes_words = ["yes", "y", "more", "another", "again", "continue"]
    if any(message == w or message.startswith(w) for w in yes_words):
        return {
            "response": "What would you like to change next?\n\nExample: \"set weight to 50\" or \"change the threshold to 8000\"",
            "context": {"step": "edit_extract"},
            "intent": "edit",
            "update_payload": None,
            "update_candidates": None,
        }

    no_words = ["no", "n", "done", "that's all", "nothing", "nope", "exit"]
    if any(message == w or message.startswith(w) for w in no_words):
        return {
            "response": "✅ All done! What would you like to do next?\n\n➕ Add\n🗑️ Delete\n✏️ Edit",
            "context": {"step": "initial"},
            "intent": None,
            "update_payload": None,
            "update_rule_id": None,
            "update_candidates": None,
            "error_count": 0,
        }

    return {
        "response": "Would you like to make more changes? Type **yes** or **no**.",
        "context": {"step": "edit_confirm"},
        "intent": "edit",
    }


# ─────────────────────────────────────────────────────────
# Node 9: edit_ask_rule (no reference given)
# ─────────────────────────────────────────────────────────

def edit_ask_rule_node(state: RuleAssistantState):
    """User didn't specify a rule — list all and ask them to pick."""
    message = state["message"].strip()
    available_rules = state.get("available_rules") or []
    error_count = state.get("error_count", 0)

    if not available_rules:
        return {
            "response": "📭 No rules exist in the system. Would you like to **add** one?",
            "context": {"step": "initial"},
            "intent": None,
        }

    # Try to match user's reply as a rule ID
    matched = _find_rule_by_id(available_rules, message)

    # Try list number
    if not matched:
        try:
            idx = int(message) - 1
            if 0 <= idx < len(available_rules):
                matched = available_rules[idx]
        except (ValueError, IndexError):
            pass

    if matched:
        # Found it — now we have the rule, check if we know what to change
        payload = state.get("update_payload") or {}
        preview = _format_rule_preview(matched)

        if payload.get("field") and payload.get("new_value") is not None:
            return {
                "response": f"🔍 Selected:\n\n{preview}\n\n✏️ I'll update **{payload['field']}** to **{payload['new_value']}**.\n\nType **confirm** to apply or **cancel** to abort.",
                "update_rule_id": matched["id"],
                "context": {"step": "edit_apply"},
                "intent": "edit",
            }
        else:
            return {
                "response": f"🔍 Selected:\n\n{preview}\n\nWhat would you like to change?\n\nExample: \"set value to 6000\" or \"change name to High Claim Alert\"",
                "update_rule_id": matched["id"],
                "context": {"step": "edit_extract"},
                "intent": "edit",
            }

    # First time or retry — show list
    error_count += 1 if error_count > 0 else 0  # Don't increment on first display
    rules_list = _format_rules_list(available_rules)

    if error_count > 0:
        return {
            "response": f"❌ Couldn't find \"{message}\".\n\n{rules_list}",
            "context": {"step": "edit_ask_rule"},
            "intent": "edit",
            "error_count": error_count,
        }

    return {
        "response": f"Which rule would you like to update?\n\n{rules_list}",
        "context": {"step": "edit_ask_rule"},
        "intent": "edit",
        "error_count": 1,  # Mark that we've shown the list once
    }

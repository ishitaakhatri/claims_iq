"""
DeleteRule — Nodes for the delete-rule conversational flow.

Three-step flow:
  1. delete_identify — extract rule ID/name from message, or list all rules
  2. delete_select   — user picks a rule from the list
  3. delete_confirm  — yes → __DELETE__ signal, no → back to intent level
"""

import os
import json
from openai import OpenAI

from ..state import RuleAssistantState, RULE_TYPES, OP_LABELS

client = OpenAI(api_key=os.getenv("VITE_OPENAI_API_KEY"))


# ─────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────

def _extract_rule_id_from_text(message: str):
    """Use LLM to extract a rule ID or rule name from the user's message."""
    prompt = f"""
The user wants to delete a business rule. Extract the rule identifier from their message.

Return a JSON object with:
- rule_id: the rule ID if mentioned (e.g. "BR001", "BR012"). Return null if not found.
- rule_name: the rule name if mentioned (e.g. "High Claim Amount"). Return null if not found.

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


def _find_rule(available_rules: list, rule_id: str = None, rule_name: str = None):
    """Search available rules by ID (exact) or name (case-insensitive partial)."""
    if not available_rules:
        return None

    if rule_id:
        for r in available_rules:
            if r.get("id", "").upper() == rule_id.upper():
                return r

    if rule_name:
        name_lower = rule_name.lower()
        for r in available_rules:
            if name_lower in r.get("name", "").lower():
                return r

    return None


def _format_rule_preview(rule: dict) -> str:
    """Format a single rule for display."""
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
    """Format all rules as a numbered list for selection."""
    if not rules:
        return "📭 No rules found in the system."

    lines = ["📋 **Existing Rules:**\n"]
    for i, r in enumerate(rules, 1):
        status = "🟢" if r.get("is_active") else "🔴"
        lines.append(f"  {i}. {status} **{r.get('id', '?')}** — {r.get('name', 'Unnamed')}")

    lines.append("\n💡 Please provide the **Rule ID** (e.g. `BR001`) of the rule you want to delete.")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────
# Nodes
# ─────────────────────────────────────────────────────────

def delete_identify_node(state: RuleAssistantState):
    """Entry point for delete flow — extract rule ID or list all rules."""

    message = state["message"]
    available_rules = state.get("available_rules") or []

    # Check if there are any rules at all
    if not available_rules:
        return {
            "response": "📭 There are no rules in the system to delete.\n\nWould you like to **add** a new rule instead?",
            "next_step": "initial",
            "intent": "delete",
            "error_count": 0,
        }

    # Try to extract rule ID/name from the message
    extracted = _extract_rule_id_from_text(message)

    if extracted:
        rule_id = extracted.get("rule_id")
        rule_name = extracted.get("rule_name")

        matched_rule = _find_rule(available_rules, rule_id, rule_name)

        if matched_rule:
            # Found the rule — ask for confirmation
            preview = _format_rule_preview(matched_rule)
            return {
                "response": f"🔍 Found the following rule:\n\n{preview}\n\n⚠️ Are you sure you want to **delete** this rule? This action cannot be undone.\n\nType **yes** to confirm or **no** to cancel.",
                "next_step": "delete_confirm",
                "delete_rule_id": matched_rule["id"],
                "intent": "delete",
                "error_count": 0,
            }

    # No specific rule identified — list all rules
    rules_list = _format_rules_list(available_rules)
    return {
        "response": f"Which rule would you like to delete?\n\n{rules_list}",
        "next_step": "delete_select",
        "intent": "delete",
        "error_count": 0,
    }


def delete_select_node(state: RuleAssistantState):
    """User picks a rule by ID from the list."""

    message = state["message"].strip()
    available_rules = state.get("available_rules") or []
    error_count = state.get("error_count", 0)

    # Try to match by ID directly (e.g. "BR001")
    matched_rule = _find_rule(available_rules, rule_id=message)

    # If not matched, try LLM extraction
    if not matched_rule:
        extracted = _extract_rule_id_from_text(message)
        if extracted:
            matched_rule = _find_rule(
                available_rules,
                rule_id=extracted.get("rule_id"),
                rule_name=extracted.get("rule_name"),
            )

    # If still not matched, try interpreting as a list number
    if not matched_rule:
        try:
            idx = int(message) - 1
            if 0 <= idx < len(available_rules):
                matched_rule = available_rules[idx]
        except (ValueError, IndexError):
            pass

    if matched_rule:
        preview = _format_rule_preview(matched_rule)
        return {
            "response": f"🔍 You selected:\n\n{preview}\n\n⚠️ Are you sure you want to **delete** this rule? This action cannot be undone.\n\nType **yes** to confirm or **no** to cancel.",
            "next_step": "delete_confirm",
            "delete_rule_id": matched_rule["id"],
            "intent": "delete",
            "error_count": 0,
        }

    # Not found — show error + re-list
    error_count += 1
    if error_count >= 3:
        return {
            "response": "❌ I'm having trouble identifying the rule. Let's start over.\n\nWhat would you like to do?\n\n➕ **Add** a new rule\n🗑️ **Delete** an existing rule\n✏️ **Edit** a rule",
            "next_step": "initial",
            "intent": None,
            "error_count": 0,
        }

    rules_list = _format_rules_list(available_rules)
    return {
        "response": f"❌ I couldn't find a rule matching \"{message}\".\n\n{rules_list}",
        "next_step": "delete_select",
        "intent": "delete",
        "error_count": error_count,
    }


def delete_confirm_node(state: RuleAssistantState):
    """Confirm or cancel the deletion."""

    message = state["message"].lower().strip()
    delete_rule_id = state.get("delete_rule_id")

    # ── Confirm ──
    confirm_words = ["yes", "y", "confirm", "do it", "go ahead", "sure", "ok", "delete", "remove"]
    if any(message == w or message.startswith(w) for w in confirm_words):
        return {
            "response": "__DELETE__",
            "next_step": "delete_done",
            "delete_rule_id": delete_rule_id,
            "intent": "delete",
        }

    # ── Cancel ──
    cancel_words = ["no", "n", "cancel", "nevermind", "never mind", "abort", "stop", "don't", "nope"]
    if any(message == w or message.startswith(w) for w in cancel_words):
        return {
            "response": "👍 Deletion cancelled. No changes were made.\n\nWhat would you like to do?\n\n➕ **Add** a new rule\n🗑️ **Delete** a different rule\n✏️ **Edit** a rule",
            "next_step": "initial",
            "delete_rule_id": None,
            "intent": None,
            "error_count": 0,
        }

    # ── Unclear ──
    return {
        "response": f"Please confirm: do you want to delete rule **{delete_rule_id}**?\n\nType **yes** to confirm or **no** to cancel.",
        "next_step": "delete_confirm",
        "delete_rule_id": delete_rule_id,
        "intent": "delete",
    }

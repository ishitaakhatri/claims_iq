"""
RulesGraph — Orchestrator graph with intent classification and routing.

Architecture:
START → controller → (intent_classifier OR step node)
      → node executes → updates state.context.step
      → controller (loop continues)
"""

import os
import json
from openai import OpenAI
from langgraph.graph import StateGraph, START, END

from .state import RuleAssistantState
from .AddRule import (
    add_greet_node, add_ask_type_node,
    add_ask_field_node, add_confirm_deploy_node,
)
from .DeleteRule import (
    delete_identify_node, delete_select_node, delete_confirm_node,
)
from .UpdateRule import (
    edit_entry_node, edit_extract_node, edit_check_ref_node,
    edit_retrieve_node, edit_disambiguate_node, edit_select_node,
    edit_apply_node, edit_confirm_node, edit_ask_rule_node,
)

client = OpenAI(api_key=os.getenv("VITE_OPENAI_API_KEY"))


# ─────────────────────────────────────────────────────────
# Intent Classification
# ─────────────────────────────────────────────────────────

def _classify_action_intent(message: str):
    prompt = f"""
Classify the user's intent.

Allowed:
- add
- delete
- edit

Return JSON:
{{"intent": "add", "confidence": 0.95}}

User message:
{message}
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
        return {"intent": None, "confidence": 0}


# ─────────────────────────────────────────────────────────
# Nodes
# ─────────────────────────────────────────────────────────

def intent_classifier_node(state: RuleAssistantState):
    message = state["message"]
    result = _classify_action_intent(message)

    intent = result.get("intent")
    confidence = result.get("confidence", 0)

    if not intent or confidence < 0.6:
        return {
            "context": {"step": "fallback"},
            "intent": None,
        }

    if intent == "add":
        return {"context": {"step": "add_greet"}, "intent": intent}

    if intent == "delete":
        return {"context": {"step": "delete_identify"}, "intent": intent}

    if intent == "edit":
        return {"context": {"step": "edit_entry"}, "intent": intent}

    return {"context": {"step": "fallback"}}


def fallback_node(state: RuleAssistantState):
    error_count = state.get("error_count", 0)

    if error_count >= 3:
        return {
            "response": (
                "Let's start fresh.\n\n"
                "Type:\n➕ add\n🗑️ delete\n✏️ edit"
            ),
            "context": {"step": "initial"},
            "error_count": 0,
            "collected": {},
            "current_field_index": 0,
            "delete_rule_id": None,
        }

    return {
        "response": (
            "I didn't understand that.\n\n"
            "➕ Add\n🗑️ Delete\n✏️ Edit"
        ),
        "context": {"step": "initial"},
        "error_count": error_count + 1,
    }


# ─────────────────────────────────────────────────────────
# Controller (Brain)
# ─────────────────────────────────────────────────────────

def controller_route(state: RuleAssistantState):
    step = state.get("context", {}).get("step", "initial")
    response_len = len(state.get("response") or "")
    
    print(f"[Graph Debug] controller_route evaluating -> current step: '{step}', response set? {'Yes' if response_len > 0 else 'No'}")

    # Loop Breaker: If a node has generated a response for the user, 
    # we pause the graph execution by going to END.
    if state.get("response"):
        print("[Graph Debug] -> Pausing execution (going to END) because a response was generated.")
        return END

    routes = {
        # Add
        "add_greet": "add_greet",
        "add_ask_type": "add_ask_type",
        "add_ask_field": "add_ask_field",
        "add_confirm_deploy": "add_confirm_deploy",

        # Delete
        "delete_identify": "delete_identify",
        "delete_select": "delete_select",
        "delete_confirm": "delete_confirm",

        # Edit (9 nodes)
        "edit_entry": "edit_entry",
        "edit_extract": "edit_extract",
        "edit_check_ref": "edit_check_ref",
        "edit_retrieve": "edit_retrieve",
        "edit_disambiguate": "edit_disambiguate",
        "edit_select": "edit_select",
        "edit_apply": "edit_apply",
        "edit_confirm": "edit_confirm",
        "edit_ask_rule": "edit_ask_rule",

        # Fallback
        "fallback": "fallback",
    }

    target = routes.get(step, "intent_classifier")
    print(f"[Graph Debug] -> Routing execution to node: '{target}'")
    return target


# ─────────────────────────────────────────────────────────
# Graph Builder
# ─────────────────────────────────────────────────────────

def build_rule_assistant_graph():
    workflow = StateGraph(RuleAssistantState)

    # Nodes
    workflow.add_node("intent_classifier", intent_classifier_node)
    workflow.add_node("fallback", fallback_node)

    workflow.add_node("add_greet", add_greet_node)
    workflow.add_node("add_ask_type", add_ask_type_node)
    workflow.add_node("add_ask_field", add_ask_field_node)
    workflow.add_node("add_confirm_deploy", add_confirm_deploy_node)

    workflow.add_node("delete_identify", delete_identify_node)
    workflow.add_node("delete_select", delete_select_node)
    workflow.add_node("delete_confirm", delete_confirm_node)

    workflow.add_node("edit_entry", edit_entry_node)
    workflow.add_node("edit_extract", edit_extract_node)
    workflow.add_node("edit_check_ref", edit_check_ref_node)
    workflow.add_node("edit_retrieve", edit_retrieve_node)
    workflow.add_node("edit_disambiguate", edit_disambiguate_node)
    workflow.add_node("edit_select", edit_select_node)
    workflow.add_node("edit_apply", edit_apply_node)
    workflow.add_node("edit_confirm", edit_confirm_node)
    workflow.add_node("edit_ask_rule", edit_ask_rule_node)

    # START → controller
    workflow.add_conditional_edges(
        START,
        controller_route,
        {
            "intent_classifier": "intent_classifier",
            "add_greet": "add_greet",
            "add_ask_type": "add_ask_type",
            "add_ask_field": "add_ask_field",
            "add_confirm_deploy": "add_confirm_deploy",
            "delete_identify": "delete_identify",
            "delete_select": "delete_select",
            "delete_confirm": "delete_confirm",
            "edit_entry": "edit_entry",
            "edit_extract": "edit_extract",
            "edit_check_ref": "edit_check_ref",
            "edit_retrieve": "edit_retrieve",
            "edit_disambiguate": "edit_disambiguate",
            "edit_select": "edit_select",
            "edit_apply": "edit_apply",
            "edit_confirm": "edit_confirm",
            "edit_ask_rule": "edit_ask_rule",
            "fallback": "fallback",
            END: END,
        },
    )

    # 🔥 LOOP: every node → controller (NOT END)
    all_nodes = [
        "intent_classifier",
        "fallback",
        "add_greet",
        "add_ask_type",
        "add_ask_field",
        "add_confirm_deploy",
        "delete_identify",
        "delete_select",
        "delete_confirm",
        "edit_entry",
        "edit_extract",
        "edit_check_ref",
        "edit_retrieve",
        "edit_disambiguate",
        "edit_select",
        "edit_apply",
        "edit_confirm",
        "edit_ask_rule",
    ]

    for node in all_nodes:
        workflow.add_conditional_edges(
            node,
            controller_route,
            {
                "intent_classifier": "intent_classifier",
                "add_greet": "add_greet",
                "add_ask_type": "add_ask_type",
                "add_ask_field": "add_ask_field",
                "add_confirm_deploy": "add_confirm_deploy",
                "delete_identify": "delete_identify",
                "delete_select": "delete_select",
                "delete_confirm": "delete_confirm",
                "edit_entry": "edit_entry",
                "edit_extract": "edit_extract",
                "edit_check_ref": "edit_check_ref",
                "edit_retrieve": "edit_retrieve",
                "edit_disambiguate": "edit_disambiguate",
                "edit_select": "edit_select",
                "edit_apply": "edit_apply",
                "edit_confirm": "edit_confirm",
                "edit_ask_rule": "edit_ask_rule",
                "fallback": "fallback",
                END: END,
            },
        )

    return workflow.compile()


rule_assistant_app = build_rule_assistant_graph()
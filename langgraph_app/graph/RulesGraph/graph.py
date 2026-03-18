"""
RulesGraph — Graph builder and compiled rule assistant app.
"""

from langgraph.graph import StateGraph, START, END

from .state import RuleAssistantState
from .nodes import greet_node, ask_type_node, ask_field_node, confirm_deploy_node


# ─────────────────────────────────────────────────────────
# Routing
# ─────────────────────────────────────────────────────────

def route(state: RuleAssistantState):

    step = state["context"].get("step","initial")

    if step=="ask_type":
        return "ask_type"

    if step=="ask_field":
        return "ask_field"

    if step=="confirm_deploy":
        return "confirm_deploy"

    return "greet"


# ─────────────────────────────────────────────────────────
# Graph
# ─────────────────────────────────────────────────────────

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

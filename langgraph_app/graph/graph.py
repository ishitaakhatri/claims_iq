from langgraph.graph import StateGraph, START, END
from .state import ClaimsState
from .nodes import (
    ocr_node, 
    extraction_node, 
    create_rule_node,
    evaluation_node
)

def create_graph(active_rules: list):
    """
    Creates the claims processing state graph dynamically based on active rules.
    """
    workflow = StateGraph(ClaimsState)

    # Adding nodes
    workflow.add_node("ocr", ocr_node)
    workflow.add_node("extraction", extraction_node)
    
    # Adding rule nodes
    for rule in active_rules:
        node_id = rule["id"].lower()
        workflow.add_node(node_id, create_rule_node(rule))
    
    workflow.add_node("evaluation", evaluation_node)

    # Adding edges
    workflow.add_edge(START, "ocr")
    workflow.add_edge("ocr", "extraction")
    
    # Parallel Rule Engine — all rules fan out from extraction, fan in to evaluation
    for rule in active_rules:
        node_id = rule["id"].lower()
        workflow.add_edge("extraction", node_id)
        workflow.add_edge(node_id, "evaluation")
    workflow.add_edge("evaluation", END)

    return workflow.compile()

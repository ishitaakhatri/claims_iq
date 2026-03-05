from langgraph.graph import StateGraph, START, END
from .state import ClaimsState
from .nodes import (
    ocr_node, 
    extraction_node, 
    create_rule_node,
    evaluation_node,
    BUSINESS_RULES
)

def create_graph():
    """
    Creates the claims processing state graph.
    """
    workflow = StateGraph(ClaimsState)

    # Adding nodes
    workflow.add_node("ocr", ocr_node)
    workflow.add_node("extraction", extraction_node)
    
    # Adding rule nodes
    for rule in BUSINESS_RULES:
        node_id = rule["id"].lower()
        workflow.add_node(node_id, create_rule_node(rule))
    
    workflow.add_node("evaluation", evaluation_node)

    # Adding edges
    workflow.add_edge(START, "ocr")
    workflow.add_edge("ocr", "extraction")
    
    # Sequential Rule Engine
    last_node = "extraction"
    for rule in BUSINESS_RULES:
        node_id = rule["id"].lower()
        workflow.add_edge(last_node, node_id)
        last_node = node_id
        
    workflow.add_edge(last_node, "evaluation")
    workflow.add_edge("evaluation", END)

    return workflow.compile()

# Creating a shared graph instance
app_graph = create_graph()

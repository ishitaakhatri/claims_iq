from langgraph.graph import StateGraph, START, END
from .state import ClaimsState
from .nodes import (
    ocr_node, 
    extraction_node, 
    rule_engine_node,
    evaluation_node
)

def create_graph():
    """
    Creates the claims processing state graph.
    """
    workflow = StateGraph(ClaimsState)

    # Adding nodes
    workflow.add_node("ocr", ocr_node)
    workflow.add_node("extraction", extraction_node)
    
    # Adding rule engine node
    workflow.add_node("rule_engine", rule_engine_node)
    
    workflow.add_node("evaluation", evaluation_node)

    # Adding edges
    workflow.add_edge(START, "ocr")
    workflow.add_edge("ocr", "extraction")
    
    # Sequential Rule Engine
    workflow.add_edge("extraction", "rule_engine")
    workflow.add_edge("rule_engine", "evaluation")
    
    workflow.add_edge("evaluation", END)

    return workflow.compile()

# Creating a shared graph instance
app_graph = create_graph()

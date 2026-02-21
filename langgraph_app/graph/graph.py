from langgraph.graph import StateGraph, START, END
from .state import ClaimsState
from .nodes import (
    ocr_node, 
    extraction_node, 
    rule_br001_node, 
    rule_br002_node, 
    rule_br003_node, 
    rule_br004_node, 
    rule_br005_node, 
    rule_br006_node, 
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
    
    # Adding rule nodes
    workflow.add_node("br001", rule_br001_node)
    workflow.add_node("br002", rule_br002_node)
    workflow.add_node("br003", rule_br003_node)
    workflow.add_node("br004", rule_br004_node)
    workflow.add_node("br005", rule_br005_node)
    workflow.add_node("br006", rule_br006_node)
    
    workflow.add_node("evaluation", evaluation_node)

    # Adding edges
    workflow.add_edge(START, "ocr")
    workflow.add_edge("ocr", "extraction")
    
    # Fan-out: Parallel rule processing
    workflow.add_edge("extraction", "br001")
    workflow.add_edge("extraction", "br002")
    workflow.add_edge("extraction", "br003")
    workflow.add_edge("extraction", "br004")
    workflow.add_edge("extraction", "br005")
    workflow.add_edge("extraction", "br006")
    
    # Fan-in: Wait for all rules to complete
    workflow.add_edge("br001", "evaluation")
    workflow.add_edge("br002", "evaluation")
    workflow.add_edge("br003", "evaluation")
    workflow.add_edge("br004", "evaluation")
    workflow.add_edge("br005", "evaluation")
    workflow.add_edge("br006", "evaluation")
    
    workflow.add_edge("evaluation", END)

    return workflow.compile()

# Creating a shared graph instance
app_graph = create_graph()

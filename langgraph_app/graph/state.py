import operator
from typing import TypedDict, Optional, List, Any, Annotated

class ClaimsState(TypedDict):
    """
    Represents the state of our claims processing graph.
    """
    # Inputs
    file_data: str  # Base64
    file_type: str
    file_name: str
    
    # intermediate steps
    ocr_content: Optional[str]
    extracted_data: Optional[dict]
    
    # Rule evaluation results (aggregated from parallel nodes)
    rule_results: Annotated[List[dict], operator.add]
    
    # Configuration
    rule_config: Optional[dict]
    
    # Outputs
    evaluation: Optional[dict]
    routing: Optional[str]
    error: Optional[str]

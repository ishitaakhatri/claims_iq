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
    user_id: Optional[str]
    
    # intermediate steps
    ocr_content: Optional[str]
    extracted_data: Optional[dict]
    
    # Rule evaluation results (aggregated from parallel nodes)
    rule_results: Annotated[List[dict], operator.add]
    
    # Configuration
    rule_config: Optional[dict]
    
    # HITL + Explainability
    decision_reasoning: Optional[dict]
    risk_tier: Optional[str]
    processing_mode: Optional[str]
    review_triggers: Optional[List[str]]
    trigger_groups: Optional[dict]
    low_confidence_fields: Optional[List[str]]
    
    # Outputs
    evaluation: Optional[dict]
    routing: Optional[str]
    error: Optional[str]

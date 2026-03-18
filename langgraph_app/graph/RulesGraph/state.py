"""
RulesGraph — State, constants, field helpers, and validation.
"""

import re
from typing import TypedDict, Optional, Dict, Any

# ─────────────────────────────────────────────────────────
# Fields
# ─────────────────────────────────────────────────────────

ALL_FIELDS = {
    "claimAmount": {"label": "Claim Amount", "type": "number"},
    "completeness": {"label": "Document Completeness", "type": "number"},
    "fraudScore": {"label": "Fraud Score", "type": "number"},
    "claimNumber": {"label": "Claim Number", "type": "string"},
    "policyNumber": {"label": "Policy Number", "type": "string"},
    "claimantName": {"label": "Claimant Name", "type": "string"},
    "claimantId": {"label": "Claimant ID", "type": "string"},
    "claimType": {"label": "Claim Type", "type": "string"},
    "policyStatus": {"label": "Policy Status", "type": "string"},
    "incidentDate": {"label": "Incident Date", "type": "string"},
    "filingDate": {"label": "Filing Date", "type": "string"},
    "providerName": {"label": "Provider Name", "type": "string"},
    "contactNumber": {"label": "Contact Number", "type": "string"},
}

RULE_TYPES = {
    "threshold": {
        "label": "Threshold Rule",
        "fields_needed": ["name","description","field_name","operator","value","weight"],
        "operators": ["lte","lt","gte","gt"],
    },
    "comparison": {
        "label": "Comparison Rule",
        "fields_needed": ["name","description","field_name","operator","value","weight"],
        "operators": ["eq"],
    },
    "cross_field": {
        "label": "Cross Field Rule",
        "fields_needed": ["name","description","field_name","operator","weight"],
        "operators": ["not_duplicate"],
    }
}

OP_LABELS = {
    "lte":"≤",
    "lt":"<",
    "gte":"≥",
    "gt":">",
    "eq":"=",
    "not_duplicate":"NOT DUPLICATE"
}

# ─────────────────────────────────────────────────────────
# State
# ─────────────────────────────────────────────────────────

class RuleAssistantState(TypedDict):
    message: str
    context: dict
    response: str
    next_step: str
    collected: dict
    current_field_index: int
    rule_data: Optional[Dict[str, Any]]

# ─────────────────────────────────────────────────────────
# Field Helpers
# ─────────────────────────────────────────────────────────

def get_numeric_fields():
    return [k for k, v in ALL_FIELDS.items() if v["type"] == "number"]

def get_string_fields():
    return [k for k, v in ALL_FIELDS.items() if v["type"] == "string"]

def format_available_fields():
    numeric = get_numeric_fields()
    string = get_string_fields()
    return (
        f"  📊 Numeric: {', '.join(numeric)}\n"
        f"  📝 Text: {', '.join(string)}"
    )

def format_available_operators(rule_type):
    ops = RULE_TYPES[rule_type]["operators"]
    labels = [f"{OP_LABELS.get(op, op)} ({op})" for op in ops]
    return ", ".join(labels)

# ─────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────

def normalize_string(s: str) -> str:
    """Normalize string by removing spaces, non-alphanumeric chars, forcing lowercase, and stripping trailing 's'."""
    val = re.sub(r'[^a-zA-Z0-9]', '', str(s)).lower()
    if val.endswith('s') and len(val) > 1 and not val.endswith('ss'):
        val = val[:-1]
    return val


def validate_field_name(value):

    if value in ALL_FIELDS:
        return value

    normalized_input = normalize_string(value)
    
    for valid_field, field_data in ALL_FIELDS.items():
        if normalized_input == normalize_string(valid_field):
            return valid_field
            
        label = field_data["label"]
        if normalized_input == normalize_string(label):
            return valid_field

    raise ValueError(
        f"Invalid field '{value}'. Choose one of: {', '.join(ALL_FIELDS.keys())}"
    )


def validate_operator(op, rule_type):

    allowed = RULE_TYPES[rule_type]["operators"]

    if op not in allowed:
        raise ValueError(
            f"Invalid operator. Allowed: {', '.join(allowed)}"
        )

    return op


def validate_weight(value):

    try:
        w = int(value)
    except:
        raise ValueError("Weight must be a number.")

    if not 1 <= w <= 100:
        raise ValueError("Weight must be between 1 and 100.")

    return w


def validate_value(field_name,value):

    field_type = ALL_FIELDS[field_name]["type"]

    if field_type == "number":
        try:
            return float(value)
        except:
            raise ValueError(f"{field_name} must be numeric")

    return value

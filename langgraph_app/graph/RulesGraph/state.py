"""
RulesGraph — State, constants, field helpers, and validation.
"""

import re
from typing import TypedDict, Optional, Dict, Any

# ─────────────────────────────────────────────────────────
# Fields
# ─────────────────────────────────────────────────────────

ALL_FIELDS = {
    "claimAmount":   {"label": "Claim Amount",            "type": "number"},
    "completeness":  {"label": "Document Completeness",   "type": "number"},
    "fraudScore":    {"label": "Fraud Score",             "type": "number"},
    "claimNumber":   {"label": "Claim Number",            "type": "string"},
    "policyNumber":  {"label": "Policy Number",           "type": "string"},
    "claimantName":  {"label": "Claimant Name",           "type": "string"},
    "claimantId":    {"label": "Claimant ID",             "type": "string"},
    "claimType":     {"label": "Claim Type",              "type": "string"},
    "policyStatus":  {"label": "Policy Status",           "type": "string"},
    "incidentDate":  {"label": "Incident Date",           "type": "date"},
    "filingDate":    {"label": "Filing Date",             "type": "date"},
    "providerName":  {"label": "Provider Name",           "type": "string"},
    "contactNumber": {"label": "Contact Number",          "type": "string"},
}

# Fields available per rule type — only relevant choices shown to the user
RULE_TYPE_FIELDS = {
    "threshold": ["claimAmount", "completeness", "fraudScore"],
    "comparison": ["policyStatus", "claimType", "claimantId", "policyNumber",
                   "providerName", "incidentDate", "filingDate"],
    "cross_field": ["claimNumber", "policyNumber", "claimantId",
                    "incidentDate", "providerName"],
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
    # ── Multi-agent workflow fields ──
    intent: Optional[str]               # Classified intent: "add", "delete", "edit"
    available_rules: Optional[list]     # Rules list injected from main.py
    delete_rule_id: Optional[str]       # Target rule ID for deletion
    error_count: int                    # Consecutive error count for fallback
    # ── Update flow fields ──
    update_payload: Optional[Dict[str, Any]]  # {field, old_value, new_value, rule_hint}
    update_candidates: Optional[list]         # Matched rules from candidate search
    update_rule_id: Optional[str]             # Confirmed target rule ID for update

# ─────────────────────────────────────────────────────────
# Field Helpers
# ─────────────────────────────────────────────────────────

def get_numeric_fields():
    return [k for k, v in ALL_FIELDS.items() if v["type"] == "number"]

def get_string_fields():
    return [k for k, v in ALL_FIELDS.items() if v["type"] == "string"]

def get_date_fields():
    return [k for k, v in ALL_FIELDS.items() if v["type"] == "date"]

def format_available_fields(rule_type: str = None):
    """Return formatted field list, restricted to relevant fields for the given rule type."""
    if rule_type and rule_type in RULE_TYPE_FIELDS:
        allowed = RULE_TYPE_FIELDS[rule_type]
    else:
        allowed = list(ALL_FIELDS.keys())

    numeric = [k for k in allowed if ALL_FIELDS[k]["type"] == "number"]
    string  = [k for k in allowed if ALL_FIELDS[k]["type"] == "string"]
    date    = [k for k in allowed if ALL_FIELDS[k]["type"] == "date"]

    parts = []
    if numeric:
        parts.append(f"  📊 Numeric: {', '.join(numeric)}")
    if string:
        parts.append(f"  📝 Text: {', '.join(string)}")
    if date:
        parts.append(f"  📅 Date (YYYY-MM-DD): {', '.join(date)}")
    return "\n".join(parts)

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


def validate_field_name(value, rule_type: str = None):
    # Resolve the canonical field name first
    if value in ALL_FIELDS:
        canonical = value
    else:
        normalized_input = normalize_string(value)
        canonical = None
        for valid_field, field_data in ALL_FIELDS.items():
            if normalized_input == normalize_string(valid_field):
                canonical = valid_field
                break
            if normalized_input == normalize_string(field_data["label"]):
                canonical = valid_field
                break

    if not canonical:
        allowed = RULE_TYPE_FIELDS.get(rule_type, list(ALL_FIELDS.keys())) if rule_type else list(ALL_FIELDS.keys())
        raise ValueError(f"Invalid field '{value}'. Choose one of: {', '.join(allowed)}")

    # Enforce rule-type restriction
    if rule_type and rule_type in RULE_TYPE_FIELDS:
        if canonical not in RULE_TYPE_FIELDS[rule_type]:
            allowed = RULE_TYPE_FIELDS[rule_type]
            raise ValueError(
                f"Field '{canonical}' is not valid for a {RULE_TYPES[rule_type]['label']}. "
                f"Allowed fields: {', '.join(allowed)}"
            )

    return canonical


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


def validate_value(field_name, value):
    import re as _re
    field_type = ALL_FIELDS[field_name]["type"]

    if field_type == "number":
        try:
            return float(value)
        except (ValueError, TypeError):
            raise ValueError(f"{field_name} must be numeric")

    if field_type == "date":
        s = str(value).strip()
        if not _re.match(r'^\d{4}-\d{2}-\d{2}$', s):
            raise ValueError(f"{field_name} must be in YYYY-MM-DD format (e.g. 2024-03-15)")
        return s

    return value

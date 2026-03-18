"""
UpdateRule — Placeholder node for rule editing (coming soon).
"""

from ..state import RuleAssistantState


def edit_stub_node(state: RuleAssistantState):
    """Placeholder — rule editing is not yet implemented."""
    return {
        "response": (
            "🚧 **Rule editing is coming soon!**\n\n"
            "For now, you can:\n"
            "  🗑️ **Delete** the rule and recreate it with updated values\n"
            "  ➕ **Add** a new rule\n\n"
            "What would you like to do?"
        ),
        "next_step": "initial",
        "intent": None,
        "error_count": 0,
    }

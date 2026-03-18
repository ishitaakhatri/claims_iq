import os
import sys

# Add the current directory to sys.path so we can import the langgraph module
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from langgraph_app.services.database import get_all_rules
from langgraph_app.graph.graph import create_graph
from langgraph_app.graph.RulesGraph import rule_assistant_app

def generate_claims_graph():
    print("Generating Claims Process Graph...")
    # Fetch active rules to build the actual dynamic graph
    all_rules = get_all_rules()
    active_rules = [rule for rule in all_rules if rule.get("is_active", True)]
    
    app = create_graph(active_rules)
    graph = app.get_graph()
    
    # Save the Mermaid diagram text
    mermaid_str = graph.draw_mermaid()
    with open("claims_process_graph.mmd", "w", encoding="utf-8") as f:
        f.write(mermaid_str)
    print(" -> Saved claims_process_graph.mmd")
        
    # Attempt to save it as a PNG (uses the mermaid.ink web API by default in LangGraph)
    try:
        png_data = graph.draw_mermaid_png()
        with open("claims_process_graph.png", "wb") as f:
            f.write(png_data)
        print(" -> Saved claims_process_graph.png")
    except Exception as e:
        print(f" -> Could not save claims_process_graph.png: {e}")

def generate_rule_assistant_graph():
    print("\nGenerating Rule Assistant Graph...")
    graph = rule_assistant_app.get_graph()
    
    # Save the Mermaid diagram text
    mermaid_str = graph.draw_mermaid()
    with open("rule_assistant_graph.mmd", "w", encoding="utf-8") as f:
        f.write(mermaid_str)
    print(" -> Saved rule_assistant_graph.mmd")
        
    # Attempt to save it as a PNG
    try:
        png_data = graph.draw_mermaid_png()
        with open("rule_assistant_graph.png", "wb") as f:
            f.write(png_data)
        print(" -> Saved rule_assistant_graph.png")
    except Exception as e:
        print(f" -> Could not save rule_assistant_graph.png: {e}")

if __name__ == "__main__":
    generate_claims_graph()
    generate_rule_assistant_graph()
    print("\nDone! Check the current directory for the generated files.")

import os
from dotenv import load_dotenv
load_dotenv(override=True)

from typing import Optional, List
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from .graph.graph import create_graph
from .services.blob_storage import upload_to_blob
from .services.database import (
    save_claim_to_db, get_claims_history, backfill_orphaned_claims,
    get_all_rules, upsert_rule, delete_rule
)
from .auth import get_current_user
from .graph.rule_assistant import rule_assistant_app
import json

app = FastAPI(title="ClaimsIQ LangGraph API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify the frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ClaimRequest(BaseModel):
    file_data: str  # Base64
    file_type: str
    file_name: str
    rule_config: Optional[dict] = None

class RuleRequest(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    rule_type: str = "threshold"
    weight: int = 30
    priority: int = 99
    is_active: bool = True
    config: dict = {}

class ChatMessage(BaseModel):
    message: str
    context: Optional[dict] = None

@app.get("/claims-history")
async def claims_history(user_info: dict = Depends(get_current_user)):
    """
    Fetch claims history for the authenticated user securely.
    Admins can see all history.
    """
    try:
        is_admin = (user_info.get("role") == "admin")
        
        history = get_claims_history(user_info.get("id"), is_admin)
        return {"status": "success", "history": history}
    except Exception as e:
        print(f"[API] History Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Rules CRUD Endpoints ─────────────────────────────────────────────────────

@app.get("/rules")
async def list_rules(user_info: dict = Depends(get_current_user)):
    """Fetch all business rules from the database."""
    try:
        rules = get_all_rules()
        return {"status": "success", "rules": rules}
    except Exception as e:
        print(f"[API] Rules Fetch Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/rules")
async def create_rule(request: RuleRequest, user_info: dict = Depends(get_current_user)):
    """Create a new business rule."""
    try:
        rule = upsert_rule(request.dict())
        return {"status": "success", "rule": rule}
    except Exception as e:
        print(f"[API] Rule Create Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/rules/{rule_id}")
async def update_rule(rule_id: str, request: RuleRequest, user_info: dict = Depends(get_current_user)):
    """Update an existing business rule."""
    try:
        data = request.dict()
        data["id"] = rule_id
        rule = upsert_rule(data)
        return {"status": "success", "rule": rule}
    except Exception as e:
        print(f"[API] Rule Update Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/rules/{rule_id}")
async def remove_rule(rule_id: str, user_info: dict = Depends(get_current_user)):
    """Delete a business rule by ID."""
    try:
        deleted = delete_rule(rule_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Rule not found")
        return {"status": "success", "deleted": rule_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[API] Rule Delete Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── AI Rules Assistant ───────────────────────────────────────────────────────

RULE_TYPE_FIELDS = {
    "threshold": {
        "label": "Threshold Rule",
        "description": "Compares a numeric field against a specific value (e.g., Amount ≤ $5000).",
        "required_fields": ["field_name", "operator", "value"],
        "operators": ["lte", "lt", "gte", "gt", "eq"],
        "example_fields": ["claimAmount", "completeness", "fraudScore", "claimNumber", "policyNumber", "claimantName", "claimantId", "claimType", "policyStatus", "incidentDate", "filingDate", "providerName", "contactNumber"]
    },
    "comparison": {
        "label": "Comparison Rule",
        "description": "Matches a field value exactly (e.g., Policy Status = \"Active\").",
        "required_fields": ["field_name", "operator", "value"],
        "operators": ["eq"],
        "example_fields": ["policyStatus", "claimType", "providerName", "claimAmount", "completeness", "fraudScore", "claimNumber", "policyNumber", "claimantName", "claimantId", "incidentDate", "filingDate", "contactNumber"]
    },
    "cross_field": {
        "label": "Cross-Field Analysis",
        "description": "Validates relationships between fields (e.g., duplicate checks).",
        "required_fields": ["field_name", "operator"],
        "operators": ["not_duplicate"],
        "example_fields": ["claimNumber", "policyNumber", "claimantId"]
    },
}


@app.post("/rules/ai-assist")
async def ai_assist_rules(request: ChatMessage, user_info: dict = Depends(get_current_user)):
    """
    AI assistant for rule creation using LangGraph — conversational flow.
    """
    try:
        ctx = request.context or {}
        
        initial_state = {
            "message": request.message,
            "context": ctx,
            "response": "",
            "next_step": "initial",
            "collected": ctx.get("collected", {}),
            "current_field_index": ctx.get("current_field_index", 0),
            "rule_data": None,
        }
        
        result = rule_assistant_app.invoke(initial_state)
        
        # If graph says deploy, do the DB insert here
        if result.get("response") == "__DEPLOY__" and result.get("rule_data"):
            saved = upsert_rule(result["rule_data"])
            return {
                "status": "success",
                "response": f"✅ Rule **{saved['name']}** ({saved['id']}) has been deployed successfully!\n\nYou can view and edit it in the **Rule Registry** tab.",
                "next_step": "done",
                "collected": {},
                "current_field_index": 0,
                "rule": saved,
            }
        
        return {
            "status": "success",
            "response": result.get("response", "I'm not sure what you need. Try describing the rule you'd like to create!"),
            "next_step": result.get("next_step", "initial"),
            "collected": result.get("collected", {}),
            "current_field_index": result.get("current_field_index", 0),
        }

    except Exception as e:
        print(f"[API] AI Assist Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process-claim")
async def process_claim(request: ClaimRequest, user_info: dict = Depends(get_current_user)):
    """
    Endpoint to process a claim document using LangGraph with real-time streaming updates.
    """
    # Using internal UUID resolved securely by token threadpool
    internal_user_id = user_info.get("id")
    initial_state = {
        "file_data": request.file_data,
        "file_type": request.file_type,
        "file_name": request.name if hasattr(request, 'name') else request.file_name,
        "ocr_content": None,
        "extracted_data": None,
        "rule_results": [],
        "rule_config": request.rule_config,
        "evaluation": None,
        "routing": None,
        "error": None
    }
    
    # Fetch active rules dynamically
    all_rules = get_all_rules()
    active_rules = [rule for rule in all_rules if rule.get("is_active", True)]
    app_graph = create_graph(active_rules)
    expected_nodes = ["ocr", "extraction", "evaluation"] + [r["id"].lower() for r in active_rules]
    
    async def event_generator():
        state = initial_state.copy()
        try:
            # Yield initial starting message
            yield f"data: {json.dumps({'node': 'start', 'status': 'started', 'message': 'Initializing engine...'})}\n\n"
            yield f"data: {json.dumps({'node': 'start', 'status': 'completed'})}\n\n"
            
            # Running the graph in granular streaming mode
            async for event in app_graph.astream_events(initial_state, version="v2"):
                kind = event.get("event")
                name = event.get("name")
                
                # We identify nodes by 'on_chain_start' / 'on_chain_end' with names matching graph nodes
                # or 'on_chat_model_start' etc. if we wanted deeper info.
                # For basic node tracking:
                if kind == "on_chain_start" and name in expected_nodes:
                    yield f"data: {json.dumps({'node': name, 'status': 'started'})}\n\n"
                
                elif kind == "on_chain_end":
                    if name in expected_nodes:
                        # When a node ends, we update our local state from its output
                        output = event.get("data", {}).get("output")
                        if isinstance(output, dict):
                            state.update(output)
                        yield f"data: {json.dumps({'node': name, 'status': 'completed'})}\n\n"
            
            # Send final state
            if state.get("error"):
                yield f"data: {json.dumps({'error': state['error']})}\n\n"
            else:
                extracted_data = state.get("extracted_data")
                evaluation = state.get("evaluation")
                blob_uri = None
                claim_id = None

                # Upload document to Azure Blob Storage
                try:
                    print(f"[Integration] Attempting blob upload for {request.file_name}...")
                    blob_uri = upload_to_blob(request.file_data, request.file_name)
                    print(f"[Integration] Blob upload successful: {blob_uri}")
                    yield f"data: {json.dumps({'node': 'blob_upload', 'status': 'completed'})}\n\n"
                except Exception as e:
                    print(f"[Integration] Blob upload failed (non-fatal): {e}")

                # Save claim record to PostgreSQL
                try:
                    print(f"[Integration] Attempting to save claim record to DB...")
                    status = evaluation.get("routing", "PROCESSED") if evaluation else "PROCESSED"
                    form_category = (extracted_data or {}).get("claimType", "Medical Claim")
                    claim_id = save_claim_to_db(
                        user_id=internal_user_id,
                        form_category=form_category,
                        blob_uri=blob_uri or "",
                        status=status,
                        extracted_data=extracted_data or {},
                        evaluation_results=evaluation or {},
                    )
                    print(f"[Integration] DB save successful: {claim_id}")
                    yield f"data: {json.dumps({'node': 'db_save', 'status': 'completed'})}\n\n"
                except Exception as e:
                    print(f"[Integration] DB save failed (non-fatal): {e}")

                final_payload = {
                    "final_result": {
                        "extracted_data": extracted_data,
                        "evaluation": evaluation,
                        "blob_uri": blob_uri,
                        "claim_id": claim_id,
                    }
                }
                yield f"data: {json.dumps(final_payload)}\n\n"
                
        except Exception as e:
            print(f"Graph Execution Error: {str(e)}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# Serve static files from the React build if available
if os.path.exists("dist"):
    app.mount("/assets", StaticFiles(directory="dist/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        file_path = os.path.join("dist", full_path)
        if full_path and os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse("dist/index.html")

if __name__ == "__main__":
    import uvicorn
    # Enable reload for development
    uvicorn.run("langgraph_app.main:app", host="0.0.0.0", port=8000, reload=True)

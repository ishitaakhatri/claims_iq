import os
import asyncio
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
    get_all_rules, upsert_rule, delete_rule,
    register_session, check_active_session, terminate_session,
    delete_claim, get_db_connection
)
from .services.rules_cache import rules_cache
from .auth import get_current_user
from .graph.RulesGraph import rule_assistant_app
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

class SessionRequest(BaseModel):
    session_token: str

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


@app.delete("/claims-history/{claim_id}")
async def remove_claim(claim_id: str, user_info: dict = Depends(get_current_user)):
    """Delete a single claim from claims history."""
    try:
        is_admin = (user_info.get("role") == "admin")
        deleted = delete_claim(claim_id, user_info.get("id"), is_admin)
        if not deleted:
            raise HTTPException(status_code=404, detail="Claim not found or access denied")
        return {"status": "success", "deleted": claim_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[API] Claim Delete Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Session Management ───────────────────────────────────────────────────────

@app.post("/session/check")
async def session_check(request: SessionRequest, user_info: dict = Depends(get_current_user)):
    """Check if another active session exists for this user."""
    try:
        result = check_active_session(user_info.get("id"), request.session_token)
        return {"status": "success", **result}
    except Exception as e:
        print(f"[API] Session Check Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/session/register")
async def session_register(request: SessionRequest, user_info: dict = Depends(get_current_user)):
    """Register a new active session for the current user."""
    try:
        success = register_session(user_info.get("id"), request.session_token)
        return {"status": "success" if success else "error"}
    except Exception as e:
        print(f"[API] Session Register Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/session/terminate")
async def session_terminate(request: SessionRequest, user_info: dict = Depends(get_current_user)):
    """Terminate existing sessions and register a new one (force login)."""
    try:
        terminate_session(user_info.get("id"))
        register_session(user_info.get("id"), request.session_token)
        return {"status": "success"}
    except Exception as e:
        print(f"[API] Session Terminate Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Rules CRUD Endpoints ─────────────────────────────────────────────────────

@app.get("/rules")
async def list_rules(user_info: dict = Depends(get_current_user)):
    """Fetch all business rules — served from in-memory cache."""
    try:
        rules = rules_cache.get_rules()
        return {"status": "success", "rules": rules}
    except Exception as e:
        print(f"[API] Rules Fetch Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/rules")
async def create_rule(request: RuleRequest, user_info: dict = Depends(get_current_user)):
    """Create a new business rule — updates cache instantly, persists to DB in background."""
    try:
        rule_data = request.dict()
        # Generate ID if not provided
        if not rule_data.get("id"):
            rule_data["id"] = rules_cache.generate_rule_id()
        # Update cache immediately
        rules_cache.add(rule_data)
        # Persist to DB in background
        asyncio.create_task(rules_cache.bg_upsert(rule_data))
        return {"status": "success", "rule": rule_data}
    except Exception as e:
        print(f"[API] Rule Create Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/rules/{rule_id}")
async def update_rule(rule_id: str, request: RuleRequest, user_info: dict = Depends(get_current_user)):
    """Update an existing business rule — updates cache instantly, persists to DB in background."""
    try:
        data = request.dict()
        data["id"] = rule_id
        # Update cache immediately
        rules_cache.update(data)
        # Persist to DB in background
        asyncio.create_task(rules_cache.bg_upsert(data))
        return {"status": "success", "rule": data}
    except Exception as e:
        print(f"[API] Rule Update Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/rules/{rule_id}")
async def remove_rule(rule_id: str, user_info: dict = Depends(get_current_user)):
    """Delete a business rule — removes from cache instantly, deletes from DB in background."""
    try:
        # Remove from cache immediately
        rules_cache.remove(rule_id)
        # Delete from DB in background
        asyncio.create_task(rules_cache.bg_delete(rule_id))
        return {"status": "success", "deleted": rule_id}
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
    AI assistant for rule management using LangGraph — multi-agent conversational flow.
    Supports: add, delete, edit (stub) intents.
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
            # ── Multi-agent fields ──
            "intent": ctx.get("intent"),
            "available_rules": rules_cache.get_rules(),
            "delete_rule_id": ctx.get("delete_rule_id"),
            "error_count": ctx.get("error_count", 0),
            # ── Update flow fields ──
            "update_payload": ctx.get("update_payload"),
            "update_candidates": ctx.get("update_candidates"),
            "update_rule_id": ctx.get("update_rule_id"),
        }
        
        print(f"\n[API Debug] === NEW USER MESSAGE ===")
        print(f"[API Debug] Message: '{request.message}'")
        print(f"[API Debug] Incoming Step: '{ctx.get('step')}'")
        print(f"[API Debug] Intent: '{ctx.get('intent')}'")
        
        result = rule_assistant_app.invoke(initial_state)

        print(f"[API Debug] Outgoing Step: '{result.get('context', {}).get('step')}'")
        print(f"[API Debug] Next Step: '{result.get('next_step')}'")
        print(f"[API Debug] Generated Response: '{str(result.get('response'))[:50]}...'")
        print(f"[API Debug] ========================\n")
        
        # ── Handle __DEPLOY__ signal (add flow) ──
        if result.get("response") == "__DEPLOY__" and result.get("rule_data"):
            rule_data = result["rule_data"]
            if not rule_data.get("id"):
                rule_data["id"] = rules_cache.generate_rule_id()
            rules_cache.add(rule_data)
            asyncio.create_task(rules_cache.bg_upsert(rule_data))
            return {
                "status": "success",
                "response": f"✅ Rule **{rule_data['name']}** ({rule_data['id']}) has been deployed successfully!\n\nYou can view and edit it in the **Rule Registry** tab.",
                "next_step": "done",
                "collected": {},
                "current_field_index": 0,
                "intent": None,
                "delete_rule_id": None,
                "error_count": 0,
                "rule": rule_data,
            }

        # ── Handle __DELETE__ signal (delete flow) ──
        if result.get("response") == "__DELETE__" and result.get("delete_rule_id"):
            rule_id = result["delete_rule_id"]
            # Find rule name before removing
            all_rules = rules_cache.get_rules()
            rule_name = next((r.get("name", "Unknown") for r in all_rules if r.get("id") == rule_id), "Unknown")
            # Remove from cache immediately
            rules_cache.remove(rule_id)
            # Persist to DB in background
            asyncio.create_task(rules_cache.bg_delete(rule_id))
            return {
                "status": "success",
                "response": f"✅ Rule **{rule_name}** (`{rule_id}`) has been deleted successfully!\n\nThe rule has been removed from the system.",
                "next_step": "done",
                "collected": {},
                "current_field_index": 0,
                "intent": None,
                "delete_rule_id": None,
                "error_count": 0,
            }

        # ── Handle __UPDATE__ signal (update flow) ──
        if result.get("response") == "__UPDATE__" and result.get("update_rule_id"):
            rule_id = result["update_rule_id"]
            payload = result.get("update_payload") or {}
            field = payload.get("field")
            new_value = payload.get("new_value")

            # Find the rule in cache
            all_rules = rules_cache.get_rules()
            target_rule = next((r for r in all_rules if r.get("id") == rule_id), None)

            if target_rule and field and new_value is not None:
                # Apply the update
                updated_rule = dict(target_rule)
                config = dict(updated_rule.get("config", {}))

                # Map field to the correct location
                if field in ("name", "description", "weight", "is_active", "rule_type"):
                    # Rule-level property
                    if field == "weight":
                        updated_rule[field] = int(new_value)
                    elif field == "is_active":
                        updated_rule[field] = str(new_value).lower() in ("true", "1", "yes", "active")
                    else:
                        updated_rule[field] = new_value
                elif field in ("field_name", "operator", "value"):
                    # Config-level property
                    if field == "value":
                        # Try numeric conversion
                        try:
                            config[field] = float(new_value) if "." in str(new_value) else int(new_value)
                        except (ValueError, TypeError):
                            config[field] = new_value
                    else:
                        config[field] = new_value
                    updated_rule["config"] = config
                else:
                    # Treat as config property
                    config[field] = new_value
                    updated_rule["config"] = config

                # Update cache + persist
                rules_cache.update(updated_rule)
                asyncio.create_task(rules_cache.bg_upsert(updated_rule))

                return {
                    "status": "success",
                    "response": f"✅ Rule **{updated_rule.get('name')}** (`{rule_id}`) updated!\n\n**{field}** → **{new_value}**\n\nWould you like to make more changes? Type **yes** or **no**.",
                    "next_step": result.get("context", {}).get("step", "edit_confirm"),
                    "intent": "edit",
                    "update_rule_id": rule_id,
                    "update_payload": None,
                    "update_candidates": None,
                    "error_count": 0,
                }
            else:
                missing = []
                if not target_rule:
                    missing.append(f"rule {rule_id} not found")
                if not field:
                    missing.append("field not specified")
                if new_value is None:
                    missing.append("new value not specified")
                return {
                    "status": "success",
                    "response": f"⚠️ Couldn't apply update: {', '.join(missing)}.\n\nPlease specify what to change. Example: \"set value to 6000\"",
                    "next_step": "edit_extract",
                    "intent": "edit",
                    "update_rule_id": rule_id,
                    "error_count": 0,
                }
        
        next_step_val = result.get("next_step")
        if not next_step_val or next_step_val == "initial":
            next_step_val = result.get("context", {}).get("step", "initial")

        return {
            "status": "success",
            "response": str(result.get("response", "I'm not sure...")),
            "next_step": next_step_val,
            "collected": result.get("collected", {}),
            "current_field_index": result.get("current_field_index", 0),
            "intent": result.get("intent"),
            "delete_rule_id": result.get("delete_rule_id"),
            "error_count": result.get("error_count", 0),
            "update_payload": result.get("update_payload"),
            "update_rule_id": result.get("update_rule_id"),
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
        "user_id": internal_user_id,
        "ocr_content": None,
        "extracted_data": None,
        "rule_results": [],
        "rule_config": request.rule_config,
        "evaluation": None,
        "routing": None,
        "error": None
    }
    
    # Fetch active rules from cache (zero DB calls)
    active_rules = rules_cache.get_active()
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

                # ── Send results to user IMMEDIATELY ──
                final_payload = {
                    "final_result": {
                        "extracted_data": extracted_data,
                        "evaluation": evaluation,
                        "blob_uri": None,
                        "claim_id": None,
                    }
                }
                yield f"data: {json.dumps(final_payload)}\n\n"

                # ── Background: Blob upload + DB save in parallel ──
                yield f"data: {json.dumps({'node': 'background_save', 'status': 'saving'})}\n\n"

                loop = asyncio.get_event_loop()
                blob_uri = None
                claim_id = None
                errors = []

                async def bg_blob_upload():
                    nonlocal blob_uri
                    try:
                        print(f"[Integration] Attempting blob upload for {request.file_name}...")
                        blob_uri = await loop.run_in_executor(
                            None, upload_to_blob, request.file_data, request.file_name
                        )
                        print(f"[Integration] Blob upload successful: {blob_uri}")
                    except Exception as e:
                        print(f"[Integration] Blob upload failed (non-fatal): {e}")
                        errors.append(f"blob: {e}")

                async def bg_db_save():
                    nonlocal claim_id
                    try:
                        print(f"[Integration] Attempting to save claim record to DB...")
                        status = evaluation.get("routing", "PROCESSED") if evaluation else "PROCESSED"
                        form_category = (extracted_data or {}).get("claimType", "Medical Claim")
                        claim_id = await loop.run_in_executor(
                            None, save_claim_to_db,
                            internal_user_id, form_category, "",
                            status, extracted_data or {}, evaluation or {},
                        )
                        print(f"[Integration] DB save successful: {claim_id}")
                    except Exception as e:
                        print(f"[Integration] DB save failed (non-fatal): {e}")
                        errors.append(f"db: {e}")

                # Run both tasks in parallel
                await asyncio.gather(bg_blob_upload(), bg_db_save())

                # If we have the blob_uri now, update the DB record with it
                if blob_uri and claim_id:
                    try:
                        def _update_blob(cid, uri):
                            conn = None
                            try:
                                import psycopg2
                                conn = get_db_connection()
                                cur = conn.cursor()
                                cur.execute("UPDATE claims_history SET blob_uri = %s WHERE id = %s", (uri, cid))
                                conn.commit()
                                cur.close()
                                print(f"[Integration] DB record updated with blob URI")
                            except Exception as e2:
                                print(f"[Integration] Failed to update blob URI in DB: {e2}")
                            finally:
                                if conn: conn.close()
                        await loop.run_in_executor(None, _update_blob, claim_id, blob_uri)
                    except Exception:
                        pass

                if errors:
                    yield f"data: {json.dumps({'node': 'background_save', 'status': 'save_error', 'message': '; '.join(errors)})}\n\n"
                else:
                    yield f"data: {json.dumps({'node': 'background_save', 'status': 'saved', 'blob_uri': blob_uri, 'claim_id': claim_id})}\n\n"
                
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

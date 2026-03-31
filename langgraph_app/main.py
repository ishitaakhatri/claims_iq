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
    delete_claim, get_db_connection,
    ensure_review_tables, save_review, save_audit_entry,
    get_audit_trail, get_governance_metrics, update_claim_review_status,
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

class ReviewRequest(BaseModel):
    action: str  # approve, edit_field, reject_field, confirm_field, request_docs, escalate, override, add_note
    field_name: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    override_reason: Optional[str] = None
    reviewer_note: Optional[str] = None
    escalate_to: Optional[str] = None

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

        # ── Intercept bulk delete before hitting the graph ──
        if request.message.startswith("__BULK_DELETE__:"):
            rule_ids = [rid.strip() for rid in request.message[len("__BULK_DELETE__:"):].split(",") if rid.strip()]
            deleted_names = []
            for rule_id in rule_ids:
                all_rules = rules_cache.get_rules()
                rule_name = next((r.get("name", rule_id) for r in all_rules if r.get("id") == rule_id), rule_id)
                rules_cache.remove(rule_id)
                asyncio.create_task(rules_cache.bg_delete(rule_id))
                deleted_names.append(f"**{rule_name}** (`{rule_id}`)")
            summary = ", ".join(deleted_names)
            return {
                "status": "success",
                "response": f"✅ Deleted {len(rule_ids)} rule{'s' if len(rule_ids) > 1 else ''}:\n{summary}\n\nWhat would you like to do next?\n\n➕ **Add** a new rule\n🗑️ **Delete** an existing rule\n✏️ **Edit** a rule",
                "next_step": "done",
                "collected": {}, "current_field_index": 0,
                "intent": None, "delete_rule_id": None, "error_count": 0,
                "update_payload": None, "update_rule_id": None,
            }
        
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
                        # Determine initial review_status from evaluation
                        processing_mode = (evaluation or {}).get("processingMode", "pending")
                        review_status_map = {
                            "auto_eligible": "auto_approved",
                            "review_required": "review_required",
                            "escalated": "escalated",
                        }
                        review_status = review_status_map.get(processing_mode, "pending")
                        claim_id = await loop.run_in_executor(
                            None, save_claim_to_db,
                            internal_user_id, form_category, "",
                            status, extracted_data or {}, evaluation or {},
                            review_status,
                        )
                        print(f"[Integration] DB save successful: {claim_id} (review: {review_status})")
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


# ─── HITL & Governance Endpoints ───────────────────────────────────────────────

@app.on_event("startup")
async def startup_ensure_hitl_tables():
    """Ensure HITL tables exist on startup."""
    try:
        ensure_review_tables()
    except Exception as e:
        print(f"[Startup] Warning: Could not ensure HITL tables: {e}")


@app.post("/claims/{claim_id}/review")
async def submit_review(claim_id: str, request: ReviewRequest, user_info: dict = Depends(get_current_user)):
    """
    Submit a human review action on a claim.
    Actions: approve, edit_field, reject_field, confirm_field, request_docs, escalate, override, add_note
    """
    reviewer_id = user_info.get("id")
    
    # Validate override requires a reason
    if request.action == "override" and not request.override_reason:
        raise HTTPException(status_code=400, detail="Override reason is required when action is 'override'")
    
    try:
        # Save the review record
        review_id = save_review(
            claim_id=claim_id,
            reviewer_id=reviewer_id,
            action=request.action,
            ai_recommendation=None,  # Could be populated from claim data
            human_decision=request.action,
            override_reason=request.override_reason,
            reviewer_note=request.reviewer_note,
            edited_fields={"field": request.field_name, "old": request.old_value, "new": request.new_value} if request.field_name else {},
        )
        
        # Create audit trail entry
        action_labels = {
            "approve": "Approved claim",
            "edit_field": f"Edited field: {request.field_name}",
            "reject_field": f"Rejected field: {request.field_name}",
            "confirm_field": f"Confirmed field: {request.field_name}",
            "request_docs": "Requested additional documents",
            "escalate": f"Escalated to {request.escalate_to or 'specialist'}",
            "override": f"Overrode AI recommendation (Reason: {request.override_reason})",
            "add_note": "Added reviewer note",
        }
        details = action_labels.get(request.action, request.action)
        if request.reviewer_note:
            details += f" — Note: {request.reviewer_note}"
        
        save_audit_entry(
            claim_id=claim_id,
            actor_type="reviewer",
            actor_id=reviewer_id,
            action=request.action,
            details=details,
            metadata={
                "field_name": request.field_name,
                "old_value": request.old_value,
                "new_value": request.new_value,
                "override_reason": request.override_reason,
                "escalate_to": request.escalate_to,
            },
        )
        
        # Update claim review_status based on action
        status_map = {
            "approve": "approved",
            "escalate": "escalated",
            "override": "approved",  # Override means human made final decision
            "request_docs": "pending_documentation",
        }
        new_status = status_map.get(request.action)
        if new_status:
            update_claim_review_status(claim_id, new_status)
        
        return {"status": "success", "review_id": review_id, "message": f"Review action '{request.action}' recorded."}
    except Exception as e:
        print(f"[API] Review Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/claims/{claim_id}/audit-trail")
async def get_claim_audit_trail(claim_id: str, user_info: dict = Depends(get_current_user)):
    """Get the full audit trail for a claim."""
    try:
        trail = get_audit_trail(claim_id)
        return {"status": "success", "claim_id": claim_id, "audit_trail": trail}
    except Exception as e:
        print(f"[API] Audit Trail Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/claims/{claim_id}/review-status")
async def update_review_status(claim_id: str, status: str, user_info: dict = Depends(get_current_user)):
    """Update the review status of a claim."""
    valid_statuses = ["pending", "auto_approved", "review_required", "under_review", "approved", "rejected", "escalated", "pending_documentation"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    try:
        updated = update_claim_review_status(claim_id, status)
        if not updated:
            raise HTTPException(status_code=404, detail="Claim not found")
        
        # Audit entry for status change
        save_audit_entry(
            claim_id=claim_id,
            actor_type="reviewer",
            actor_id=user_info.get("id"),
            action="status_changed",
            details=f"Review status changed to: {status}",
            metadata={"new_status": status},
        )
        
        return {"status": "success", "claim_id": claim_id, "review_status": status}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[API] Status Update Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/governance/metrics")
async def governance_metrics(user_info: dict = Depends(get_current_user)):
    """Returns governance dashboard metrics."""
    try:
        is_admin = (user_info.get("role") == "admin")
        metrics = get_governance_metrics(
            user_id=user_info.get("id"),
            is_admin=is_admin,
        )
        return {"status": "success", "metrics": metrics}
    except Exception as e:
        print(f"[API] Governance Metrics Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/governance/policy")
async def governance_policy(user_info: dict = Depends(get_current_user)):
    """
    Returns the governance policy configuration.
    Includes the Decision Feature Whitelist and excluded features.
    """
    from .graph.nodes import DECISION_FEATURE_WHITELIST, EXCLUDED_FROM_DECISIONING
    
    return {
        "status": "success",
        "policy": {
            "allowed_features": sorted(list(DECISION_FEATURE_WHITELIST)),
            "excluded_features": EXCLUDED_FROM_DECISIONING,
            "controls": [
                {
                    "id": "policy_decisioning",
                    "title": "Policy-Relevant Decisioning Only",
                    "description": "Automated recommendations are based only on policy, claim evidence, and business rules.",
                    "status": "active",
                },
                {
                    "id": "protected_features",
                    "title": "Protected Features Excluded",
                    "description": "Sensitive or irrelevant claimant attributes are excluded from automated decision logic.",
                    "status": "active",
                },
                {
                    "id": "confidence_escalation",
                    "title": "Confidence-Based Human Escalation",
                    "description": "Low-confidence or high-risk claims are automatically routed for human validation.",
                    "status": "active",
                },
                {
                    "id": "explainability",
                    "title": "Explainability for Every Recommendation",
                    "description": "Every recommendation includes traceable reasoning, evidence references, and triggered rules.",
                    "status": "active",
                },
                {
                    "id": "drift_monitoring",
                    "title": "Override & Drift Monitoring",
                    "description": "Human overrides and claim outcome patterns are monitored to identify model drift and inconsistent decision behavior.",
                    "status": "active",
                },
            ],
        },
    }


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

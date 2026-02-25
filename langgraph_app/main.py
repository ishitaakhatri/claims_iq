import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from .graph.graph import app_graph
from dotenv import load_dotenv
import json

load_dotenv()

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

@app.post("/process-claim")
async def process_claim(request: ClaimRequest):
    """
    Endpoint to process a claim document using LangGraph with real-time streaming updates.
    """
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
                if kind == "on_chain_start" and name in ["ocr", "extraction", "br001", "br002", "br003", "br004", "br005", "br006", "evaluation"]:
                    yield f"data: {json.dumps({'node': name, 'status': 'started'})}\n\n"
                
                elif kind == "on_chain_end":
                    if name in ["ocr", "extraction", "br001", "br002", "br003", "br004", "br005", "br006", "evaluation"]:
                        # When a node ends, we update our local state from its output
                        output = event.get("data", {}).get("output")
                        if isinstance(output, dict):
                            state.update(output)
                        yield f"data: {json.dumps({'node': name, 'status': 'completed'})}\n\n"
            
            # Send final state
            if state.get("error"):
                yield f"data: {json.dumps({'error': state['error']})}\n\n"
            else:
                final_payload = {
                    "final_result": {
                        "extracted_data": state.get("extracted_data"),
                        "evaluation": state.get("evaluation")
                    }
                }
                yield f"data: {json.dumps(final_payload)}\n\n"
                
        except Exception as e:
            print(f"❌ Graph Execution Error: {str(e)}")
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

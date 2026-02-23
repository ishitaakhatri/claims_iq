import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from .graph.graph import app_graph
from dotenv import load_dotenv

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
    Endpoint to process a claim document using LangGraph.
    """
    initial_state = {
        "file_data": request.file_data,
        "file_type": request.file_type,
        "file_name": request.file_name,
        "ocr_content": None,
        "extracted_data": None,
        "rule_results": [],
        "rule_config": request.rule_config,
        "evaluation": None,
        "routing": None,
        "error": None
    }
    
    try:
        # Running the graph
        final_state = await app_graph.ainvoke(initial_state)
        
        if final_state.get("error"):
            raise HTTPException(status_code=400, detail=final_state["error"])
            
        return {
            "extracted_data": final_state["extracted_data"],
            "evaluation": final_state["evaluation"]
        }
        
    except Exception as e:
        print(f"❌ Graph Execution Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

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

# ClaimsIQ LangGraph Backend

This service provides a robust and scalable backend for processing claims documents using LangGraph, Azure Document Intelligence, and OpenAI's GPT-4o.

## Features
- **Multi-stage processing**: Uses LangGraph to manage the workflow: OCR -> Extraction -> Evaluation.
- **Intelligent Extraction**: Combines Azure Layout analysis with GPT-4o for high-accuracy field extraction.
- **Business Rules Engine**: Automated evaluation of claims against predefined insurance rules.
- **FastAPI Integration**: Simple REST API to connect with frontend applications.

## Prerequisites
- Python 3.9+
- Azure Document Intelligence instance (Endpoint and Key)
- OpenAI API Key

## Setup

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment variables**:
   Create a `.env` file in the `langgraph_app` directory:
   ```env
   AZURE_DOC_INTELLIGENCE_ENDPOINT="your-endpoint"
   AZURE_DOC_INTELLIGENCE_KEY="your-key"
   OPENAI_API_KEY="your-openai-key"
   ```

3. **Run the server**:
   ```bash
   python main.py
   ```
   The API will be available at `http://localhost:8000`.

## API Endpoints

### `POST /process-claim`
Processes a claim document.

**Request Body**:
```json
{
  "file_data": "base64_encoded_string",
  "file_type": "application/pdf | image/jpeg | image/png",
  "file_name": "document_name.pdf"
}
```

**Response**:
```json
{
  "extracted_data": { ... },
  "evaluation": {
    "results": [ ... ],
    "routing": "STP | ESCALATE",
    "confidence": 95,
    "escalation_reasons": [ ... ],
    "escalate_to": "Claims Specialist"
  }
}
```

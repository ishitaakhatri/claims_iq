import os
import time
import base64
import json
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

def call_azure_layout(file_data_b64: str, file_type: str):
    """
    Calls Azure Document Intelligence Layout model.
    """
    endpoint = os.getenv("VITE_AZURE_DOC_INTELLIGENCE_ENDPOINT")
    api_key = os.getenv("VITE_AZURE_DOC_INTELLIGENCE_KEY")
    
    if not endpoint or not api_key:
        print("⚠️ Azure credentials not found")
        return None

    try:
        # Initializing client
        document_analysis_client = DocumentAnalysisClient(
            endpoint=endpoint, credential=AzureKeyCredential(api_key)
        )
        
        # Decoding base64 data
        file_bytes = base64.b64decode(file_data_b64)
        
        # Calling Azure
        poller = document_analysis_client.begin_analyze_document(
            "prebuilt-read", file_bytes
        )
        result = poller.result()
        
        # Returning full content
        return result.content
    except Exception as e:
        print(f"❌ Azure Error: {str(e)}")
        return None

def call_openai_extraction(text: str, file_name: str):
    """
    Calls OpenAI to extract structured data from OCR text.
    """
    api_key = os.getenv("VITE_OPENAI_API_KEY")
    if not api_key:
        print("⚠️ OpenAI API key not found")
        return None

    client = OpenAI(api_key=api_key)
    
    system_prompt = """You are an expert claims processing AI. Extract structured data from the provided text content of a claims document.
The text was generated via OCR, so there might be minor errors or layout shifts. Use your reasoning to identify the correct fields.

Return ONLY a valid JSON object with these exact fields:
{
  "claimNumber": "string or null (Look for 'Claim #', 'Invoice #', 'Reference #', or 'Control #')",
  "claimantName": "string or null",
  "claimantId": "string or null",
  "policyNumber": "string or null",
  "policyStatus": "active | inactive | suspended | unknown",
  "claimType": "string (e.g. Medical, Auto, Property, Life, Liability)",
  "claimAmount": number or null,
  "currency": "string default USD",
  "incidentDate": "YYYY-MM-DD or null",
  "filingDate": "YYYY-MM-DD or null (Use today's date if missing and document is recent)",
  "incidentDescription": "string or null",
  "claimantAddress": "string or null",
  "contactNumber": "string or null",
  "supportingDocuments": ["array of document names mentioned"],
  "providerName": "string or null",
  "completeness": number (0-100, your assessment of how complete the form is based on required insurance fields),
  "fraudScore": number (0-100, your assessment of fraud risk. 0-30=low, 31-60=moderate, 61-100=high),
  "fraudReasons": ["IMPORTANT: Always provide specific, actionable reasons if fraudScore > 20. Examples: 'Missing incident description', 'Claim amount inconsistent with incident type', 'Filing date much later than incident date', 'Policy status marked as inactive', 'Suspicious document formatting', 'Unexplained gaps in documentation', 'Claim amount exceeds typical range for this claim type', 'Inconsistent claimant information across document'. Even for moderate scores, provide at least 2-3 specific reasons."],
  "isDuplicate": false,
  "extractionNotes": "any important observations about the data or layout",
  "missingFields": ["list of important missing fields"]
}

CRITICAL INSTRUCTIONS FOR fraudScore AND fraudReasons:
- If fraudScore is 0-20: fraudReasons can be empty array []
- If fraudScore is 21-40: MUST provide 1-2 specific reasons in fraudReasons array
- If fraudScore is 41-60: MUST provide 2-3 specific reasons in fraudReasons array
- If fraudScore is 61+: MUST provide 3+ specific reasons in fraudReasons array
- Reasons must be specific to THIS document, not generic
- Each reason should be a clear, actionable statement"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Extract claims data from this document text (Filename: {file_name}):\\n\\n{text}"}
            ],
            response_format={"type": "json_object"}
        )
        
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"❌ OpenAI Error: {str(e)}")
        return None

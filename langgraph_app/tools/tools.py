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
    Extracts raw text, key-value pairs, and tables for better downstream accuracy.
    """
    endpoint = os.getenv("VITE_AZURE_DOC_INTELLIGENCE_ENDPOINT")
    api_key = os.getenv("VITE_AZURE_DOC_INTELLIGENCE_KEY")
    
    if not endpoint or not api_key:
        print("[Warning] Azure credentials not found")
        return None

    try:
        # Initializing client
        document_analysis_client = DocumentAnalysisClient(
            endpoint=endpoint, credential=AzureKeyCredential(api_key)
        )
        
        # Decoding base64 data
        file_bytes = base64.b64decode(file_data_b64)
        
        # Using prebuilt-layout for richer extraction (tables, key-value pairs, selection marks)
        poller = document_analysis_client.begin_analyze_document(
            "prebuilt-layout", file_bytes
        )
        result = poller.result()
        
        # Start with the raw OCR text
        output_parts = [result.content]
        
        # Extract key-value pairs (if present in Layout results)
        if hasattr(result, 'key_value_pairs') and result.key_value_pairs:
            kv_lines = []
            for kv in result.key_value_pairs:
                key = kv.key.content if kv.key else ""
                value = kv.value.content if kv.value else ""
                if key:
                    kv_lines.append(f"  {key}: {value}")
            if kv_lines:
                output_parts.append("\n\n--- EXTRACTED KEY-VALUE PAIRS ---")
                output_parts.append("\n".join(kv_lines))
        
        # Extract tables
        if result.tables:
            for i, table in enumerate(result.tables):
                table_lines = [f"\n\n--- TABLE {i+1} ({table.row_count}x{table.column_count}) ---"]
                # Build a grid
                grid = {}
                for cell in table.cells:
                    grid[(cell.row_index, cell.column_index)] = cell.content
                for row in range(table.row_count):
                    row_cells = [grid.get((row, col), "") for col in range(table.column_count)]
                    table_lines.append(" | ".join(row_cells))
                output_parts.append("\n".join(table_lines))
        
        combined = "\n".join(output_parts)
        print(f"[OCR] Layout extracted {len(result.content)} chars text, "
              f"{len(result.key_value_pairs) if hasattr(result, 'key_value_pairs') and result.key_value_pairs else 0} key-value pairs, "
              f"{len(result.tables) if result.tables else 0} tables")
        
        return combined
    except Exception as e:
        print(f"[Error] Azure Error: {str(e)}")
        return None

def call_openai_extraction(text: str, file_name: str):
    """
    Calls OpenAI to extract structured data from OCR text.
    """
    api_key = os.getenv("VITE_OPENAI_API_KEY")
    if not api_key:
        print("[Warning] OpenAI API key not found")
        return None

    client = OpenAI(api_key=api_key)
    
    system_prompt = """You are an expert claims processing AI. Extract structured data from the provided text content of a claims document.
The text was generated via OCR, so there might be minor errors or layout shifts. Use your reasoning to identify the correct fields.
The input may include raw text followed by structured sections (KEY-VALUE PAIRS, TABLES) — use ALL sections to maximize extraction accuracy.

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
  "missingFields": ["list of important missing fields"],
  "additionalFields": {
    "description": "A dictionary capturing EVERY other field, detail, data point, line item, or piece of information found in the document that is NOT already covered by the fixed fields above. Use human-readable camelCase keys and preserve the original values. Examples: diagnosisCode, deductibleAmount, adjusterName, providerNPI, treatmentDate, serviceDescription, copayAmount, priorAuthNumber, referralNumber, employerName, dateOfBirth, gender, relationshipToInsured, groupNumber, planName, billingCode, unitCount, allowedAmount, patientAccountNumber, renderingProvider, facilityName, placeOfService, referringPhysician, accidentDate, accidentLocation, witnessInfo, policeReportNumber, damageDescription, repairEstimate, replacementCost, etc. Include ALL data you can find — do not omit anything. If no additional fields exist, use an empty object {}."
  }
}

CRITICAL INSTRUCTIONS FOR fraudScore AND fraudReasons:
- If fraudScore is 0-20: fraudReasons can be empty array []
- If fraudScore is 21-40: MUST provide 1-2 specific reasons in fraudReasons array
- If fraudScore is 41-60: MUST provide 2-3 specific reasons in fraudReasons array
- If fraudScore is 61+: MUST provide 3+ specific reasons in fraudReasons array
- Reasons must be specific to THIS document, not generic
- Each reason should be a clear, actionable statement

CRITICAL INSTRUCTIONS FOR additionalFields:
- Scan the ENTIRE document text thoroughly for ANY data not captured in the fixed fields
- Include every single piece of identifiable information: dates, codes, amounts, names, IDs, descriptions, statuses, addresses, phone numbers, etc.
- Use descriptive camelCase keys (e.g. "diagnosisCode", "treatmentDate", "deductibleAmount")
- For line items or repeated data, use arrays or numbered keys (e.g. "serviceItem1", "serviceItem2")
- Do NOT leave this empty if there is additional data in the document"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            temperature=0,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Extract claims data from this document text (Filename: {file_name}):\n\n{text}"}
            ],
            response_format={"type": "json_object"}
        )
        
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"[Error] OpenAI Error: {str(e)}")
        return None

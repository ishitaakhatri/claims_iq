import { useState, useCallback, useRef } from "react";

// ─── Business Rules Engine ────────────────────────────────────────────────────
const BUSINESS_RULES = [
  { id: "BR001", name: "Claim Amount Threshold", description: "Claims ≤ $5,000 auto-approved", field: "claimAmount", operator: "lte", value: 5000, weight: 30 },
  { id: "BR002", name: "High-Value Escalation", description: "Claims > $25,000 require senior review", field: "claimAmount", operator: "lte", value: 25000, weight: 40 },
  { id: "BR003", name: "Document Completeness", description: "All required fields must be present", field: "completeness", operator: "gte", value: 80, weight: 25 },
  { id: "BR004", name: "Fraud Indicators", description: "No fraud flags detected", field: "fraudScore", operator: "lte", value: 30, weight: 50 },
  { id: "BR005", name: "Policy Active Status", description: "Policy must be active at time of claim", field: "policyStatus", operator: "eq", value: "active", weight: 35 },
  { id: "BR006", name: "Duplicate Claim Check", description: "No duplicate claim reference found", field: "isDuplicate", operator: "eq", value: false, weight: 45 },
];

function evaluateRules(extracted) {
  const results = [];
  let stp = true;
  const escalationReasons = [];

  for (const rule of BUSINESS_RULES) {
    const rawVal = extracted[rule.field];
    let passed = false;
    let actual = rawVal;

    if (rawVal === undefined || rawVal === null) {
      passed = false;
      actual = "N/A";
    } else {
      switch (rule.operator) {
        case "lte": passed = Number(rawVal) <= rule.value; break;
        case "lt": passed = Number(rawVal) < rule.value; break;
        case "gte": passed = Number(rawVal) >= rule.value; break;
        case "gt": passed = Number(rawVal) > rule.value; break;
        case "eq": passed = rawVal === rule.value || String(rawVal).toLowerCase() === String(rule.value).toLowerCase(); break;
        default: passed = false;
      }
    }

    if (!passed) {
      stp = false;
      escalationReasons.push(rule.name);
    }

    results.push({ ...rule, passed, actual });
  }

  const passCount = results.filter(r => r.passed).length;
  const confidence = Math.round((passCount / results.length) * 100);
  const routing = stp ? "STP" : "ESCALATE";
  const escalateTo = escalationReasons.includes("High-Value Escalation") || escalationReasons.includes("Fraud Indicators")
    ? "Senior Claims Manager"
    : escalationReasons.includes("Duplicate Claim Check")
      ? "Fraud Investigation Unit"
      : escalationReasons.includes("Document Completeness") || escalationReasons.includes("Policy Active Status")
        ? "Claims Specialist"
        : "Claims Reviewer";

  return { results, routing, confidence, escalationReasons, escalateTo };
}

// ─── Azure Document Intelligence API Call ────────────────────────────────────
async function extractWithAzureDocIntelligence(fileData, fileType, fileName) {
  console.log("🔵 [Azure Doc Intelligence] Starting extraction for:", fileName);

  const endpoint = import.meta.env.VITE_AZURE_DOC_INTELLIGENCE_ENDPOINT;
  const apiKey = import.meta.env.VITE_AZURE_DOC_INTELLIGENCE_KEY;

  if (!endpoint || !apiKey) {
    console.warn("⚠️  [Azure Doc Intelligence] Credentials not configured, falling back to OpenAI");
    return null;
  }

  try {
    console.log("🔵 [Azure Doc Intelligence] Endpoint:", endpoint);
    console.log("🔵 [Azure Doc Intelligence] File type:", fileType);

    // Determine model based on document type
    let modelId = "prebuilt-layout"; // Use layout model for better text/structure extraction

    console.log("🔵 [Azure Doc Intelligence] Using model:", modelId);

    // Create FormData
    const formData = new FormData();

    // Convert base64 back to Blob
    if (fileType.startsWith("image/") || fileType === "application/pdf") {
      const binaryString = atob(fileData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: fileType });
      formData.append("file", blob, fileName);
    } else {
      formData.append("file", fileData);
    }

    const url = `${endpoint}documentintelligence/documentModels/${modelId}:analyze?api-version=2024-02-29-preview`;
    const urlToTry = url;
    const fallbackUrl = `${endpoint}documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-02-29-preview`;

    console.log("🔵 [Azure Doc Intelligence] Request URL:", urlToTry);
    console.log("🔵 [Azure Doc Intelligence] FormData keys:", Array.from(formData.keys()));
    console.log("🔵 [Azure Doc Intelligence] Sending request...");

    let response = await fetch(urlToTry, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
      body: formData
    });

    console.log("🔵 [Azure Doc Intelligence] Response status:", response.status);
    console.log("🔵 [Azure Doc Intelligence] Response headers:", {
      contentType: response.headers.get("content-type"),
      location: response.headers.get("location"),
      operationLocation: response.headers.get("operation-location")
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ [Azure Doc Intelligence] HTTP Error:", response.status, errorText);
      return null;
    }

    // Azure returns 202 with operation-location for async processing
    if (response.status === 202) {
      const operationLocation = response.headers.get("operation-location");
      console.log("🔵 [Azure Doc Intelligence] Async processing - Operation Location:", operationLocation);

      if (!operationLocation) {
        console.error("❌ [Azure Doc Intelligence] No operation-location header in 202 response");
        return null;
      }

      // Poll for results
      let result = null;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds total

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        attempts++;

        console.log(`🔵 [Azure Doc Intelligence] Polling attempt ${attempts}/${maxAttempts}...`);

        const statusResponse = await fetch(operationLocation, {
          method: "GET",
          headers: {
            "Ocp-Apim-Subscription-Key": apiKey,
          }
        });

        console.log(`🔵 [Azure Doc Intelligence] Poll response status:`, statusResponse.status);

        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          console.error("❌ [Azure Doc Intelligence] Poll error:", errorText);
          continue;
        }

        const pollResult = await statusResponse.json();
        console.log(`🔵 [Azure Doc Intelligence] Poll response keys:`, Object.keys(pollResult));
        console.log(`🔵 [Azure Doc Intelligence] Poll response:`, pollResult);

        if (pollResult.status === "succeeded") {
          console.log("✅ [Azure Doc Intelligence] Processing succeeded!");
          result = pollResult;
          break;
        } else if (pollResult.status === "failed") {
          console.error("❌ [Azure Doc Intelligence] Processing failed:", pollResult.error);
          return null;
        }

        console.log(`🔵 [Azure Doc Intelligence] Status: ${pollResult.status}, continuing...`);
      }

      if (!result) {
        console.error("❌ [Azure Doc Intelligence] Timeout waiting for results");
        return null;
      }

      const analyzeResult = result.analyzeResult || result;
      console.log("🔵 [Azure Doc Intelligence] Received async result");

      // Pass the raw content to OpenAI/LLM for intelligent field extraction
      if (analyzeResult?.content) {
        console.log("🔵 [Azure Doc Intelligence] Sending content to OpenAI for intelligent extraction...");
        return await extractClaimsDataFromText(analyzeResult.content, fileName);
      }

      return null;
    } else {
      // Synchronous response (200 status)
      const responseData = await response.json();
      console.log("🔵 [Azure Doc Intelligence] Sync response received");
      const analyzeResult = responseData.analyzeResult || responseData;

      if (analyzeResult?.content) {
        return await extractClaimsDataFromText(analyzeResult.content, fileName);
      }
      return null;
    }
  } catch (error) {
    console.error("❌ [Azure Doc Intelligence] Exception:", error.message);
    return null;
  }
}

/**
 * Intelligent field extraction using LLM on OCR text/layout
 */
async function extractClaimsDataFromText(text, fileName) {
  const systemPrompt = `You are an expert claims processing AI. Extract structured data from the provided text content of a claims document.
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
  "fraudScore": number (0-100, your assessment of fraud risk),
  "isDuplicate": false,
  "extractionNotes": "any important observations about the data or layout",
  "missingFields": ["list of important missing fields"]
}

Be thorough. OCR can confuse 8/9, 0/O, 1/l; use context to resolve them. If a field isn't found, use null. Analyze the text carefully to extract context-aware information.`;

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("VITE_OPENAI_API_KEY environment variable is not set");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extract claims data from this document text (Filename: ${fileName}):\n\n${text}` }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`OpenAI API Error: ${errorData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const result = JSON.parse(data.choices[0].message.content);

  console.log("✅ [Intelligent Extraction] Successful. Extracted fields:", result);
  return result;
}

// DEPRECATED: Traditional parsing functions removed in favor of Intelligent LLM Extraction

// ─── OpenAI API Call ──────────────────────────────────────────────────────────
async function extractClaimsData(fileData, fileType, fileName) {
  console.log("📄 [Extract Claims Data] Processing file:", fileName, "Type:", fileType);

  // Try Azure Document Intelligence first
  console.log("🔄 [Extract Claims Data] Attempting Azure Document Intelligence extraction...");
  const azureResult = await extractWithAzureDocIntelligence(fileData, fileType, fileName);

  if (azureResult) {
    console.log("✅ [Extract Claims Data] Using Azure Document Intelligence results");
    // Use Azure results but enhance with fraud score from OpenAI if needed
    return azureResult;
  }

  // Fallback to OpenAI
  console.log("⚠️  [Extract Claims Data] Azure failed or not configured. Falling back to OpenAI...");
  return await extractClaimsDataOpenAI(fileData, fileType, fileName);
}

async function extractClaimsDataOpenAI(fileData, fileType, fileName) {
  console.log("🟢 [OpenAI Extraction] Starting with file:", fileName);
  const isImage = fileType.startsWith("image/");
  const isPdf = fileType === "application/pdf";

  const systemPrompt = `You are an expert claims processing AI. Extract structured data from the provided claims document and return ONLY a valid JSON object with these exact fields:

{
  "claimNumber": "string or null",
  "claimantName": "string or null",
  "claimantId": "string or null",
  "policyNumber": "string or null",
  "policyStatus": "active | inactive | suspended | unknown",
  "claimType": "string (e.g. Medical, Auto, Property, Life, Liability)",
  "claimAmount": number or null,
  "currency": "string default USD",
  "incidentDate": "YYYY-MM-DD or null",
  "filingDate": "YYYY-MM-DD or null",
  "incidentDescription": "string or null",
  "claimantAddress": "string or null",
  "contactNumber": "string or null",
  "supportingDocuments": ["array of document names mentioned"],
  "providerName": "string or null",
  "completeness": number (0-100, your assessment of how complete the form is),
  "fraudScore": number (0-100, your assessment of fraud risk based on document content; 0=low risk),
  "isDuplicate": false,
  "extractionNotes": "any important observations",
  "missingFields": ["list of important missing fields"]
}

Be thorough. If a field isn't found, use null. Assess completeness honestly. Flag any inconsistencies in extractionNotes.`;

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("VITE_OPENAI_API_KEY environment variable is not set");

  let messageContent = [];

  if (isImage) {
    // For images, send as base64 data URL
    console.log("🟢 [OpenAI Extraction] Processing as image");
    messageContent.push({
      type: "image_url",
      image_url: { url: `data:${fileType};base64,${fileData}` }
    });
    messageContent.push({ type: "text", text: "Extract all claims information from this document image." });
  } else {
    // For PDF and text documents, send as text
    console.log("🟢 [OpenAI Extraction] Processing as text/PDF");
    const textContent = isPdf
      ? `This is a PDF document (filename: ${fileName}). Extract all claims information from this PDF document content.\n\nContent: ${fileData.substring(0, 3000)}`
      : `Extract claims information from this document content (filename: ${fileName}).\n\nContent: ${fileData.substring(0, 3000)}`;
    messageContent = [{ type: "text", text: textContent }];
  }

  console.log("🟢 [OpenAI Extraction] Sending request to OpenAI...");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      max_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: messageContent }
      ]
    })
  });

  console.log("🟢 [OpenAI Extraction] Response status:", response.status);

  if (!response.ok) {
    const errorData = await response.json();
    console.error("❌ [OpenAI Extraction] Error:", errorData.error?.message);
    throw new Error(`OpenAI API Error: ${errorData.error?.message || response.statusText}`);
  }

  const data = await response.json();

  if (!data.choices || !data.choices[0]) {
    console.error("❌ [OpenAI Extraction] Unexpected API response:", data);
    throw new Error("Invalid API response - no choices returned");
  }

  const text = data.choices[0]?.message?.content || "{}";
  console.log("🟢 [OpenAI Extraction] Received response, parsing...");
  const clean = text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(clean);
    console.log("✅ [OpenAI Extraction] Successfully parsed JSON");
    return parsed;
  } catch (e) {
    console.error("❌ [OpenAI Extraction] JSON Parse Error:", e.message);
    console.error("❌ [OpenAI Extraction] Response text:", clean.substring(0, 200));
    const match = clean.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : {};
    console.log("✅ [OpenAI Extraction] Recovered from parse error");
    return result;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fmt(val) {
  if (val === null || val === undefined) return <span style={{ color: "#6b7280", fontStyle: "italic" }}>Not found</span>;
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number" && val > 100) return `$${val.toLocaleString()}`;
  if (Array.isArray(val)) return val.length ? val.join(", ") : <span style={{ color: "#6b7280", fontStyle: "italic" }}>None</span>;
  return String(val);
}

// ─── Components ───────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const styles = {
    STP: { bg: "#052e16", color: "#4ade80", border: "#166534", label: "✓ STRAIGHT-THROUGH" },
    ESCALATE: { bg: "#450a0a", color: "#f87171", border: "#7f1d1d", label: "⚠ ESCALATE" },
    PROCESSING: { bg: "#172554", color: "#93c5fd", border: "#1e3a8a", label: "⟳ PROCESSING" },
    IDLE: { bg: "#111827", color: "#6b7280", border: "#374151", label: "AWAITING INPUT" },
  };
  const s = styles[status] || styles.IDLE;
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700,
      letterSpacing: "0.08em", fontFamily: "'Courier New', monospace"
    }}>{s.label}</span>
  );
}

function RuleRow({ rule }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "24px 80px 1fr 100px 80px",
      gap: 12, padding: "10px 14px", borderBottom: "1px solid #1f2937",
      alignItems: "center", fontSize: 13
    }}>
      <span style={{ fontSize: 16 }}>{rule.passed ? "✓" : "✗"}</span>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 11,
        color: rule.passed ? "#4ade80" : "#f87171", fontWeight: 700
      }}>{rule.id}</span>
      <div>
        <div style={{ color: "#e5e7eb", fontWeight: 600, fontSize: 12 }}>{rule.name}</div>
        <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{rule.description}</div>
      </div>
      <span style={{ color: "#9ca3af", fontSize: 12, fontFamily: "monospace" }}>
        {rule.actual !== undefined ? String(rule.actual) : "—"}
      </span>
      <span style={{
        padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700, textAlign: "center",
        background: rule.passed ? "#052e16" : "#450a0a",
        color: rule.passed ? "#4ade80" : "#f87171",
        border: `1px solid ${rule.passed ? "#166534" : "#7f1d1d"}`
      }}>{rule.passed ? "PASS" : "FAIL"}</span>
    </div>
  );
}

export default function ClaimsProcessor() {
  const [stage, setStage] = useState("idle"); // idle | processing | done | error
  const [file, setFile] = useState(null);
  const [extracted, setExtracted] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState("extraction");
  const [claimsLog, setClaimsLog] = useState([]);
  const fileRef = useRef();

  const process = useCallback(async (f) => {
    console.log("📥 [Process] File selected:", f.name, "Size:", f.size, "bytes", "Type:", f.type);
    setFile(f);
    setStage("processing");
    setError(null);
    setExtracted(null);
    setEvaluation(null);

    try {
      console.log("📥 [Process] Converting file to base64...");
      const b64 = await fileToBase64(f);
      console.log("📥 [Process] Base64 conversion complete. Length:", b64.length);

      console.log("📥 [Process] Starting data extraction...");
      const data = await extractClaimsData(b64, f.type, f.name);
      console.log("📥 [Process] Extraction complete. Evaluating rules...");

      const ev = evaluateRules(data);
      console.log("📥 [Process] Rules evaluation complete. Routing:", ev.routing, "Confidence:", ev.confidence + "%");

      setExtracted(data);
      setEvaluation(ev);
      setStage("done");
      setActiveTab("extraction");

      setClaimsLog(prev => [{
        id: Date.now(),
        file: f.name,
        claim: data.claimNumber || "N/A",
        claimant: data.claimantName || "Unknown",
        amount: data.claimAmount,
        routing: ev.routing,
        time: new Date().toLocaleTimeString(),
        confidence: ev.confidence,
      }, ...prev.slice(0, 9)]);
    } catch (e) {
      console.error("❌ [Process] Error occurred:", e.message);
      console.error("❌ [Process] Full error:", e);
      setError(e.message);
      setStage("error");
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) process(f);
  }, [process]);

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (f) process(f);
  };

  const reset = () => {
    setStage("idle"); setFile(null); setExtracted(null); setEvaluation(null); setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Styles ──
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=Barlow:wght@300;400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #030712; }
    ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: #111827; }
    ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
    @keyframes scanline { from{top:-10%} to{top:110%} }
  `;

  const colors = {
    bg: "#030712", surface: "#0d1117", card: "#111827",
    border: "#1f2937", accent: "#f59e0b", accentDim: "#78350f",
    text: "#f9fafb", muted: "#6b7280", dim: "#374151",
  };

  return (
    <>
      <style>{css}</style>
      <div style={{ fontFamily: "'Barlow', sans-serif", background: colors.bg, minHeight: "100vh", color: colors.text }}>

        {/* ── Top Bar ── */}
        <div style={{
          borderBottom: `1px solid ${colors.border}`, padding: "0 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 56, background: colors.surface, position: "sticky", top: 0, zIndex: 100
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 32, height: 32, background: colors.accent, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16
            }}>⚡</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.02em" }}>CLAIMSIQ</div>
              <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.05em" }}>AGENTIC PROCESSING ENGINE</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 12, color: colors.muted, fontFamily: "IBM Plex Mono" }}>
              {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </div>
            <div style={{
              padding: "4px 10px", background: "#052e16", border: "1px solid #166534",
              borderRadius: 4, fontSize: 11, color: "#4ade80", fontFamily: "IBM Plex Mono", fontWeight: 700
            }}>● LIVE</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 0, maxWidth: 1400, margin: "0 auto" }}>

          {/* ── Main Panel ── */}
          <div style={{ padding: 24, borderRight: `1px solid ${colors.border}` }}>

            {/* Upload Zone */}
            {stage === "idle" || stage === "error" ? (
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                style={{
                  border: `2px dashed ${dragOver ? colors.accent : colors.dim}`,
                  borderRadius: 12, padding: "48px 24px", textAlign: "center", cursor: "pointer",
                  background: dragOver ? "#1c1207" : colors.card,
                  transition: "all 0.2s", marginBottom: 24,
                  animation: "slideIn 0.3s ease"
                }}
              >
                <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Drop your claims document</div>
                <div style={{ fontSize: 14, color: colors.muted, marginBottom: 16 }}>
                  Supports PDF, Word (.docx), PNG, JPG, JPEG, TIFF
                </div>
                <div style={{
                  display: "inline-block", padding: "10px 24px",
                  background: colors.accent, color: "#000", borderRadius: 6,
                  fontWeight: 700, fontSize: 14
                }}>Browse Files</div>
                {stage === "error" && (
                  <div style={{ marginTop: 16, padding: "10px 16px", background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 6, color: "#f87171", fontSize: 13 }}>
                    ⚠ Error: {error}
                  </div>
                )}
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tiff,.tif" onChange={handleFile} style={{ display: "none" }} />
              </div>
            ) : stage === "processing" ? (
              <div style={{
                border: `1px solid ${colors.border}`, borderRadius: 12, padding: "48px 24px",
                textAlign: "center", background: colors.card, marginBottom: 24,
                animation: "slideIn 0.3s ease", position: "relative", overflow: "hidden"
              }}>
                <div style={{
                  position: "absolute", left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${colors.accent}, transparent)`,
                  animation: "scanline 1.5s linear infinite", top: 0
                }} />
                <div style={{
                  width: 48, height: 48, border: `3px solid ${colors.dim}`,
                  borderTopColor: colors.accent, borderRadius: "50%",
                  animation: "spin 0.8s linear infinite", margin: "0 auto 16px"
                }} />
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Processing Document</div>
                <div style={{ fontSize: 13, color: colors.muted, fontFamily: "IBM Plex Mono" }}>
                  {file?.name}
                </div>
                <div style={{ marginTop: 20, display: "flex", justifyContent: "center", gap: 24, fontSize: 12, color: colors.muted }}>
                  {["Ingesting document", "Extracting fields", "Evaluating rules", "Routing decision"].map((s, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: colors.accent, animation: `pulse 1.2s ${i * 0.3}s infinite`
                      }} />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Results */}
            {stage === "done" && extracted && evaluation && (
              <div style={{ animation: "slideIn 0.4s ease" }}>

                {/* Decision Banner */}
                <div style={{
                  borderRadius: 10, padding: "20px 24px", marginBottom: 20,
                  background: evaluation.routing === "STP" ? "#052e16" : "#450a0a",
                  border: `1px solid ${evaluation.routing === "STP" ? "#166534" : "#7f1d1d"}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between"
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.1em", marginBottom: 6 }}>ROUTING DECISION</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: evaluation.routing === "STP" ? "#4ade80" : "#f87171" }}>
                      {evaluation.routing === "STP" ? "✓ Straight-Through Processing" : `⚠ Escalate to ${evaluation.escalateTo}`}
                    </div>
                    {evaluation.routing === "ESCALATE" && (
                      <div style={{ fontSize: 13, color: "#fca5a5", marginTop: 6 }}>
                        Reasons: {evaluation.escalationReasons.join(" · ")}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.muted, marginBottom: 4 }}>RULES PASSED</div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: evaluation.routing === "STP" ? "#4ade80" : "#f87171" }}>
                      {evaluation.confidence}%
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${colors.border}`, marginBottom: 20 }}>
                  {[
                    { id: "extraction", label: "Extracted Data" },
                    { id: "rules", label: `Business Rules (${evaluation.results.filter(r => r.passed).length}/${evaluation.results.length})` },
                    { id: "notes", label: "AI Notes" },
                  ].map(t => (
                    <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                      padding: "10px 18px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                      fontFamily: "'Barlow', sans-serif",
                      background: activeTab === t.id ? colors.card : "transparent",
                      color: activeTab === t.id ? colors.accent : colors.muted,
                      borderBottom: activeTab === t.id ? `2px solid ${colors.accent}` : "2px solid transparent",
                      borderRadius: "6px 6px 0 0", transition: "all 0.15s"
                    }}>{t.label}</button>
                  ))}
                </div>

                {/* Extraction Tab */}
                {activeTab === "extraction" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    {[
                      { label: "Claim Number", key: "claimNumber" },
                      { label: "Policy Number", key: "policyNumber" },
                      { label: "Claimant Name", key: "claimantName" },
                      { label: "Claimant ID", key: "claimantId" },
                      { label: "Claim Type", key: "claimType" },
                      { label: "Claim Amount", key: "claimAmount" },
                      { label: "Policy Status", key: "policyStatus" },
                      { label: "Incident Date", key: "incidentDate" },
                      { label: "Filing Date", key: "filingDate" },
                      { label: "Provider", key: "providerName" },
                      { label: "Contact", key: "contactNumber" },
                      { label: "Completeness Score", key: "completeness" },
                    ].map(({ label, key }) => (
                      <div key={key} style={{
                        padding: "12px 14px", background: colors.card,
                        borderRadius: 8, border: `1px solid ${colors.border}`
                      }}>
                        <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 5 }}>{label.toUpperCase()}</div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{fmt(extracted[key])}</div>
                      </div>
                    ))}
                    {extracted.claimantAddress && (
                      <div style={{ gridColumn: "1 / -1", padding: "12px 14px", background: colors.card, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                        <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 5 }}>ADDRESS</div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{extracted.claimantAddress}</div>
                      </div>
                    )}
                    {extracted.incidentDescription && (
                      <div style={{ gridColumn: "1 / -1", padding: "12px 14px", background: colors.card, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                        <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 5 }}>INCIDENT DESCRIPTION</div>
                        <div style={{ fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>{extracted.incidentDescription}</div>
                      </div>
                    )}
                    {extracted.missingFields?.length > 0 && (
                      <div style={{ gridColumn: "1 / -1", padding: "12px 14px", background: "#1c1107", borderRadius: 8, border: `1px solid ${colors.accentDim}` }}>
                        <div style={{ fontSize: 10, color: colors.accent, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 5 }}>MISSING FIELDS</div>
                        <div style={{ fontSize: 13, color: "#fcd34d" }}>{extracted.missingFields.join(", ")}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Rules Tab */}
                {activeTab === "rules" && (
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "24px 80px 1fr 100px 80px",
                      gap: 12, padding: "8px 14px",
                      background: "#0d1117", fontSize: 10, color: colors.muted,
                      fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", borderBottom: `1px solid ${colors.border}`
                    }}>
                      <span></span><span>RULE ID</span><span>DESCRIPTION</span><span>ACTUAL</span><span>RESULT</span>
                    </div>
                    {evaluation.results.map(r => <RuleRow key={r.id} rule={r} />)}
                  </div>
                )}

                {/* Notes Tab */}
                {activeTab === "notes" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ padding: "16px", background: colors.card, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                      <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 8 }}>AI EXTRACTION NOTES</div>
                      <div style={{ fontSize: 14, color: "#d1d5db", lineHeight: 1.7 }}>{extracted.extractionNotes || "No notable observations."}</div>
                    </div>
                    <div style={{ padding: "16px", background: colors.card, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                      <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 8 }}>FRAUD RISK ASSESSMENT</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1, height: 8, background: colors.dim, borderRadius: 4, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", width: `${extracted.fraudScore || 0}%`,
                            background: (extracted.fraudScore || 0) > 60 ? "#ef4444" : (extracted.fraudScore || 0) > 30 ? "#f59e0b" : "#4ade80",
                            borderRadius: 4, transition: "width 0.8s ease"
                          }} />
                        </div>
                        <span style={{ fontFamily: "IBM Plex Mono", fontSize: 14, fontWeight: 700, minWidth: 40 }}>{extracted.fraudScore ?? 0}/100</span>
                      </div>
                      <div style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
                        {(extracted.fraudScore || 0) <= 30 ? "Low risk — proceed normally" :
                          (extracted.fraudScore || 0) <= 60 ? "Moderate risk — manual review recommended" :
                            "High risk — escalate to fraud investigation unit"}
                      </div>
                    </div>
                    <div style={{ padding: "16px", background: colors.card, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                      <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 8 }}>SUPPORTING DOCUMENTS REFERENCED</div>
                      <div style={{ fontSize: 14 }}>{fmt(extracted.supportingDocuments)}</div>
                    </div>
                    <div style={{ padding: "16px", background: "#1c1107", borderRadius: 8, border: `1px solid ${colors.accentDim}` }}>
                      <div style={{ fontSize: 10, color: colors.accent, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 8 }}>RECOMMENDED ACTIONS</div>
                      <div style={{ fontSize: 13, color: "#fcd34d", lineHeight: 1.8 }}>
                        {evaluation.routing === "STP"
                          ? "✓ All rules passed. Claim can be auto-processed without manual intervention.\n✓ Generate payment authorization.\n✓ Notify claimant of approval."
                          : `• Route to: ${evaluation.escalateTo}\n• Reason(s): ${evaluation.escalationReasons.join(", ")}\n• Assign priority: ${(extracted.fraudScore || 0) > 60 || (extracted.claimAmount || 0) > 25000 ? "HIGH" : "MEDIUM"}`
                        }
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={reset} style={{
                    padding: "10px 20px", background: colors.card, border: `1px solid ${colors.border}`,
                    borderRadius: 6, color: colors.text, cursor: "pointer", fontFamily: "'Barlow', sans-serif",
                    fontWeight: 600, fontSize: 13, transition: "all 0.15s"
                  }}>+ Process Another Claim</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Sidebar ── */}
          <div style={{ padding: 20, background: colors.surface }}>

            {/* Current Status */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.1em", marginBottom: 10 }}>CURRENT STATUS</div>
              <StatusBadge status={stage === "processing" ? "PROCESSING" : stage === "done" ? evaluation?.routing : "IDLE"} />
              {file && (
                <div style={{ marginTop: 10, padding: "10px 12px", background: colors.card, borderRadius: 6, border: `1px solid ${colors.border}` }}>
                  <div style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>Document</div>
                  <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{file.name}</div>
                  <div style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>{(file.size / 1024).toFixed(1)} KB</div>
                </div>
              )}
            </div>

            {/* Business Rules Reference */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.1em", marginBottom: 10 }}>BUSINESS RULES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {BUSINESS_RULES.map(r => (
                  <div key={r.id} style={{
                    padding: "8px 10px", background: colors.card, borderRadius: 6,
                    border: `1px solid ${colors.border}`, fontSize: 11
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontFamily: "IBM Plex Mono", color: colors.accent, fontWeight: 700, fontSize: 10 }}>{r.id}</span>
                      <span style={{ color: colors.muted, fontSize: 10 }}>W:{r.weight}</span>
                    </div>
                    <div style={{ color: "#d1d5db", fontWeight: 600 }}>{r.name}</div>
                    <div style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>{r.description}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Processing Log */}
            <div>
              <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.1em", marginBottom: 10 }}>
                PROCESSING LOG {claimsLog.length > 0 && `(${claimsLog.length})`}
              </div>
              {claimsLog.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.muted, fontStyle: "italic", padding: "10px 0" }}>No claims processed yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {claimsLog.map(c => (
                    <div key={c.id} style={{
                      padding: "8px 10px", background: colors.card, borderRadius: 6,
                      border: `1px solid ${c.routing === "STP" ? "#166534" : "#7f1d1d"}`,
                      fontSize: 11, animation: "slideIn 0.3s ease"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontWeight: 700, color: c.routing === "STP" ? "#4ade80" : "#f87171" }}>
                          {c.routing === "STP" ? "✓ STP" : "⚠ ESC"}
                        </span>
                        <span style={{ color: colors.muted, fontFamily: "IBM Plex Mono", fontSize: 10 }}>{c.time}</span>
                      </div>
                      <div style={{ color: "#d1d5db" }}>{c.claimant}</div>
                      <div style={{ color: colors.muted, fontSize: 10 }}>
                        {c.claim} {c.amount ? `· $${Number(c.amount).toLocaleString()}` : ""} · {c.confidence}% pass
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

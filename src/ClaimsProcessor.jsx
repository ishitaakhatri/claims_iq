import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react"

import { useState, useCallback, useRef } from "react";
import logoImg from "./logo.png";

// ─── Business Rules Engine ────────────────────────────────────────────────────
const BUSINESS_RULES = [
  { id: "BR001", name: "Claim Amount Threshold", description: "Claims ≤ $5,000 auto-approved", field: "claimAmount", operator: "lte", value: 5000, weight: 30, hasThreshold: true, min: 1000, max: 50000, step: 1000 },
  { id: "BR002", name: "High-Value Escalation", description: "Claims > $25,000 require senior review", field: "claimAmount", operator: "lte", value: 25000, weight: 40, hasThreshold: true, min: 5000, max: 100000, step: 5000 },
  { id: "BR003", name: "Document Completeness", description: "All required fields must be present", field: "completeness", operator: "gte", value: 80, weight: 25, hasThreshold: true, min: 50, max: 100, step: 5 },
  { id: "BR004", name: "Fraud Indicators", description: "No fraud flags detected", field: "fraudScore", operator: "lte", value: 30, weight: 50, hasThreshold: true, min: 0, max: 100, step: 5 },
  { id: "BR005", name: "Policy Active Status", description: "Policy must be active at time of claim", field: "policyStatus", operator: "eq", value: "active", weight: 35 },
  { id: "BR006", name: "Duplicate Claim Check", description: "No duplicate claim reference found", field: "isDuplicate", operator: "eq", value: false, weight: 45 },
];


// ─── LangGraph Backend API Call ──────────────────────────────────────────────
async function processClaimWithLangGraph(fileData, fileType, fileName, ruleConfig) {
  console.log("🚀 [LangGraph Backend] Processing file:", fileName);

  try {
    const response = await fetch("http://localhost:8000/process-claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_data: fileData,
        file_type: fileType,
        file_name: fileName,
        rule_config: ruleConfig,
      }),
    });


    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || "Backend processing failed");
    }

    const result = await response.json();
    console.log("✅ [LangGraph Backend] Success:", result);
    return result;
  } catch (error) {
    console.error("❌ [LangGraph Backend] Error:", error.message);
    throw error;
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
  const isSkipped = rule.status === "SKIPPED";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "24px 80px 1fr 100px 80px",
      gap: 12, padding: "10px 14px", borderBottom: "1px solid #1f2937",
      alignItems: "center", fontSize: 13,
      opacity: isSkipped ? 0.5 : 1
    }}>
      <span style={{ fontSize: 16 }}>{isSkipped ? "○" : rule.passed ? "✓" : "✗"}</span>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 11,
        color: isSkipped ? "#6b7280" : rule.passed ? "#4ade80" : "#f87171", fontWeight: 700
      }}>{rule.id}</span>
      <div>
        <div style={{ color: isSkipped ? "#6b7280" : "#e5e7eb", fontWeight: 600, fontSize: 12 }}>{rule.name}</div>
        <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{isSkipped ? "Skipped by configuration" : rule.description}</div>
      </div>
      <span style={{ color: "#9ca3af", fontSize: 12, fontFamily: "monospace" }}>
        {isSkipped ? "—" : rule.actual !== undefined ? String(rule.actual) : "—"}
      </span>
      <span style={{
        padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700, textAlign: "center",
        background: isSkipped ? "#1f2937" : rule.passed ? "#052e16" : "#450a0a",
        color: isSkipped ? "#9ca3af" : rule.passed ? "#4ade80" : "#f87171",
        border: `1px solid ${isSkipped ? "#374151" : rule.passed ? "#166534" : "#7f1d1d"}`
      }}>{isSkipped ? "SKIP" : rule.passed ? "PASS" : "FAIL"}</span>
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
  const [ruleConfig, setRuleConfig] = useState(
    BUSINESS_RULES.reduce((acc, rule) => ({
      ...acc,
      [rule.id]: { enabled: true, threshold: rule.value }
    }), {})
  );
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

      console.log("📥 [Process] Starting LangGraph Backend execution...");
      const result = await processClaimWithLangGraph(b64, f.type, f.name, ruleConfig);


      const { extracted_data, evaluation } = result;
      console.log("✅ [Process] Backend complete. Routing:", evaluation.routing, "Confidence:", evaluation.confidence + "%");

      setExtracted(extracted_data);
      setEvaluation(evaluation);
      setStage("done");
      setActiveTab("extraction");

      setClaimsLog(prev => [{
        id: Date.now(),
        file: f.name,
        claim: extracted_data.claimNumber || "N/A",
        claimant: extracted_data.claimantName || "Unknown",
        amount: extracted_data.claimAmount,
        routing: evaluation.routing,
        time: new Date().toLocaleTimeString(),
        confidence: evaluation.confidence,
      }, ...prev.slice(0, 9)]);
    } catch (e) {
      console.error("❌ [Process] Error occurred:", e.message);
      console.error("❌ [Process] Full error:", e);
      setError(e.message);
      setStage("error");
    }
  }, [ruleConfig]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
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

  const clerkAppearance = {
    variables: {
      colorPrimary: colors.accent,
      colorBackground: colors.card,
      colorText: colors.text,
      colorTextSecondary: colors.muted,
      colorInputBackground: colors.bg,
      colorInputText: colors.text,
      colorTextOnPrimaryBackground: colors.bg, // High contrast on amber
      borderRadius: "6px",
      fontFamily: "'Barlow', sans-serif",
    },
    elements: {
      card: {
        border: `1px solid ${colors.border}`,
        background: colors.card,
      },
      headerTitle: { color: colors.text, fontWeight: 800 },
      headerSubtitle: { color: colors.muted },
      socialButtonsBlockButton: {
        backgroundColor: colors.surface,
        border: `1px solid ${colors.border}`,
        color: colors.text,
        "&:hover": { backgroundColor: colors.surface, color: colors.text },
      },
      formButtonPrimary: {
        backgroundColor: colors.accent,
        color: colors.bg,
        fontWeight: 700,
        "&:hover": { backgroundColor: colors.accent, color: colors.bg },
      },
      userButtonPopoverActionButton: {
        color: colors.text,
        "&:hover": { backgroundColor: colors.card, color: colors.text },
      },
      userButtonPopoverActionButtonText: {
        color: colors.text,
        fontWeight: 600,
      },
      userButtonPopoverActionButtonIcon: {
        color: colors.accent,
      },
      userButtonPopoverCard: {
        background: colors.card,
        border: `1px solid ${colors.border}`
      },
      userButtonTrigger: {
        focusRing: `0 0 0 2px ${colors.accent}`,
      },
      footerActionLink: { color: colors.accent, "&:hover": { color: colors.accent } },
    }
  };

  return (
    <>
      <style>{css}</style>
      {/* Show sign-in if user is logged out */}
      <SignedOut>
        <div style={{
          background: colors.bg, minHeight: "100vh", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 20
        }}>
          <SignIn appearance={clerkAppearance} />
        </div>
      </SignedOut>

      {/* Show dashboard if user is signed in */}
      <SignedIn>

        <div style={{ fontFamily: "'Barlow', sans-serif", background: colors.bg, minHeight: "100vh", color: colors.text }}>

          {/* ── Top Bar ── */}
          <div style={{
            borderBottom: `1px solid ${colors.border}`, padding: "0 24px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            height: 56, background: colors.surface, position: "sticky", top: 0, zIndex: 100
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src={logoImg} alt="Extremum Analytics" style={{ height: 38 }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.02em", color: "#f59e0b" }}>CLAIMSIQ</div>
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
              <UserButton afterSignOutUrl="/" appearance={clerkAppearance} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 0, maxWidth: 1440, margin: "0 auto", height: "calc(100vh - 56px)" }}>

            {/* ── Main Panel ── */}
            <div style={{ padding: 24, borderRight: `1px solid ${colors.border}` }}>

              {/* Upload Zone */}
              {stage === "idle" || stage === "error" ? (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
                  onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${dragOver ? colors.accent : colors.dim}`,
                    borderRadius: 16, padding: "120px 40px", textAlign: "center", cursor: "pointer",
                    background: dragOver ? "rgba(245, 158, 11, 0.05)" : colors.card,
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", marginBottom: 24,
                    minHeight: "500px", display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    boxShadow: dragOver ? `0 0 40px ${colors.accent + "22"}` : "none",
                    animation: "slideIn 0.4s ease-out"
                  }}
                >
                  <div style={{ fontSize: 64, marginBottom: 20, filter: dragOver ? "drop-shadow(0 0 10px #f59e0b)" : "none", transition: "all 0.3s" }}>📄</div>
                  <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 12, letterSpacing: "-0.02em" }}>Drop your claims document</div>
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
            <div style={{ padding: 20, background: colors.surface, maxHeight: "100vh", overflowY: "auto" }}>

              {/* Analysis Settings */}
              <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${colors.border}` }}>
                <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.accent, letterSpacing: "0.1em", marginBottom: 16, fontWeight: 700 }}>ANALYSIS SETTINGS</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {BUSINESS_RULES.map(rule => (
                    <div key={rule.id} style={{ background: colors.card, padding: 12, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: rule.hasThreshold ? 12 : 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={ruleConfig[rule.id].enabled}
                            onChange={(e) => setRuleConfig(prev => ({
                              ...prev,
                              [rule.id]: { ...prev[rule.id], enabled: e.target.checked }
                            }))}
                            style={{ cursor: "pointer", accentColor: colors.accent }}
                          />
                          <span style={{ fontSize: 12, fontWeight: 600, color: ruleConfig[rule.id].enabled ? colors.text : colors.muted }}>{rule.name}</span>
                        </div>
                        <span style={{ fontFamily: "IBM Plex Mono", fontSize: 10, color: colors.muted }}>{rule.id}</span>
                      </div>

                      {rule.hasThreshold && ruleConfig[rule.id].enabled && (
                        <div>
                          <input
                            type="range"
                            min={rule.min}
                            max={rule.max}
                            step={rule.step}
                            value={ruleConfig[rule.id].threshold}
                            onChange={(e) => setRuleConfig(prev => ({
                              ...prev,
                              [rule.id]: { ...prev[rule.id], threshold: Number(e.target.value) }
                            }))}
                            style={{ width: "100%", accentColor: colors.accent, height: 4, cursor: "pointer" }}
                          />
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                            <span style={{ fontSize: 10, color: colors.muted }}>{rule.field === "claimAmount" ? `$${rule.min.toLocaleString()}` : `${rule.min}%`}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: colors.accent }}>
                              {rule.field === "claimAmount" ? `$${ruleConfig[rule.id].threshold.toLocaleString()}` : `${ruleConfig[rule.id].threshold}%`}
                            </span>
                            <span style={{ fontSize: 10, color: colors.muted }}>{rule.field === "claimAmount" ? `$${rule.max.toLocaleString()}` : `${rule.max}%`}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

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
      </SignedIn>

    </>
  );
}
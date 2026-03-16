import { SignedIn, SignedOut, SignIn, SignUp, UserButton, useAuth } from "@clerk/clerk-react"
import AuthPage from "./AuthPage.jsx";
import RulesManagement from "./RulesManagement.jsx";

import { useState, useCallback, useRef, useEffect } from "react";
import logoImg from "./logo.png";

// ─── Business Rules Engine ────────────────────────────────────────────────────
// Base messages for fixed processing nodes; rule messages are generated dynamically
const BASE_NODE_MESSAGES = {
  "start": "Initializing Agentic Engine",
  "ocr": "Scanning document",
  "extraction": "Extracting data fields",
  "evaluation": "Finalizing Routing Decision"
};

// Generate node messages dynamically from active rules
function buildNodeMessages(rules) {
  const messages = { ...BASE_NODE_MESSAGES };
  (rules || []).forEach(rule => {
    messages[rule.id.toLowerCase()] = `Checking ${rule.name}`;
  });
  return messages;
}



// ─── LangGraph Backend API Call ──────────────────────────────────────────────
async function processClaimWithLangGraph(fileData, fileType, fileName, ruleConfig, onLog, token) {
  console.log("🚀 [LangGraph Backend] Processing file:", fileName);

  return new Promise(async (resolve, reject) => {
    try {
      const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";
      const response = await fetch(`${apiUrl}/process-claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          file_data: fileData,
          file_type: fileType,
          file_name: fileName,
          rule_config: ruleConfig
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return reject(new Error(errorData.detail || "Backend processing failed"));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let hasResolved = false;
      let buffer = "";

      // Start background reading
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || ""; // Keep any partial data for the next read

            for (const part of parts) {
              if (!part.trim()) continue;

              const lines = part.split("\n");
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.error) {
                      if (!hasResolved) reject(new Error(data.error));
                      return; // stop stream processing on error
                    }
                    if (data.node) {
                      onLog(data);
                    }
                    if (data.final_result) {
                      console.log("✅ [LangGraph Backend] Success (early return):", data.final_result);
                      resolve(data.final_result);
                      hasResolved = true;
                    }
                  } catch (e) {
                    console.error("❌ Error parsing JSON from stream:", e, "Part:", part);
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error("❌ [LangGraph Backend] Stream reading error:", err);
          if (!hasResolved) reject(err);
        }
      })();
    } catch (error) {
      console.error("❌ [LangGraph Backend] Request Error:", error.message);
      reject(error);
    }
  });
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
  if (typeof val === "object" && val !== null) return JSON.stringify(val);
  return String(val);
}

function camelToLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/([0-9]+)/g, " $1")
    .trim()
    .toUpperCase();
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
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [view, setView] = useState('dashboard'); // dashboard | rules
  const [stage, setStage] = useState("idle"); // idle | processing | done | error
  const [file, setFile] = useState(null);
  const [extracted, setExtracted] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState("extraction");
  const [claimsLog, setClaimsLog] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [detailTab, setDetailTab] = useState("rules");
  const [processingLogs, setProcessingLogs] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [activeRules, setActiveRules] = useState([]);
  const [sessionConflict, setSessionConflict] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // claim id to confirm delete
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // "saving" | "saved" | "error" | null

  const [ruleConfig, setRuleConfig] = useState({});
  const fileRef = useRef();

  // Generate or retrieve a unique session token for this browser tab
  const getSessionToken = () => {
    let token = sessionStorage.getItem('claimsiq_session_token');
    if (!token) {
      token = crypto.randomUUID();
      sessionStorage.setItem('claimsiq_session_token', token);
    }
    return token;
  };

  // Delete a claim from history
  const handleDeleteClaim = async (claimId) => {
    setDeleteLoading(true);
    try {
      const token = await getToken();
      const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";
      const res = await fetch(`${apiUrl}/claims-history/${claimId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        setClaimsLog(prev => prev.filter(c => c.id !== claimId));
        if (selectedLog?.id === claimId) setSelectedLog(null);
        console.log(`🗑️ [Delete] Claim ${claimId} deleted`);
      } else {
        console.error("❌ [Delete] Failed to delete claim");
      }
    } catch (err) {
      console.error("❌ [Delete] Error:", err);
    } finally {
      setDeleteLoading(false);
      setDeleteConfirm(null);
    }
  };

  // Force terminate other session and login
  const handleForceLogin = async () => {
    setSessionLoading(true);
    try {
      const token = await getToken();
      const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";
      const sessionToken = getSessionToken();
      await fetch(`${apiUrl}/session/terminate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ session_token: sessionToken })
      });
      setSessionConflict(false);
    } catch (err) {
      console.error("❌ [Session] Force login error:", err);
    } finally {
      setSessionLoading(false);
    }
  };


  const process = useCallback(async (f) => {
    console.log("📥 [Process] File selected:", f.name, "Size:", f.size, "bytes", "Type:", f.type);
    setFile(f);
    setStage("processing");
    setError(null);
    setExtracted(null);
    setEvaluation(null);
    setProcessingLogs([]);

    try {
      const token = await getToken();

      // Refresh rules from DB before processing to get latest enabled/disabled states
      const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";
      let latestConfig = ruleConfig;
      let latestRules = activeRules;
      try {
        const rulesRes = await fetch(`${apiUrl}/rules`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        const rulesData = await rulesRes.json();
        if (rulesData.status === "success" && rulesData.rules) {
          latestRules = rulesData.rules;
          setActiveRules(latestRules);
          const freshConfig = {};
          latestRules.forEach(rule => {
            if (rule.is_active) {
              freshConfig[rule.id] = { enabled: true, threshold: rule.config?.value || 0 };
            }
          });
          setRuleConfig(freshConfig);
          latestConfig = freshConfig;
        }
      } catch (err) {
        console.warn("⚠️ [Process] Could not refresh rules, using cached config:", err);
      }

      // Build dynamic node messages from latest active rules
      const currentNodeMessages = buildNodeMessages(latestRules.filter(r => r.is_active));

      console.log("📥 [Process] Converting file to base64...");
      const b64 = await fileToBase64(f);
      console.log("📥 [Process] Base64 conversion complete. Length:", b64.length);

      console.log("📥 [Process] Starting LangGraph Backend execution...");

      const onLog = (data) => {
        const { node, status } = data;

        if (node === 'background_save') {
          setSaveStatus(status); // 'saving' | 'saved' | 'save_error'
          if (status === 'saved' || status === 'save_error') {
            setTimeout(() => setSaveStatus(null), 3500); // auto-hide after 3.5s
          }
          return; // don't add to processing logs
        }

        setProcessingLogs(prev => {
          const message = currentNodeMessages[node] || `Processing ${node}...`;
          const existingIndex = prev.findIndex(l => l.node === node);

          if (existingIndex >= 0) {
            const newLogs = [...prev];
            newLogs[existingIndex] = {
              ...newLogs[existingIndex],
              status,
              time: new Date().toLocaleTimeString()
            };
            return newLogs;
          } else {
            return [...prev, {
              node,
              message,
              status,
              time: new Date().toLocaleTimeString()
            }];
          }
        });
      };

      const result = await processClaimWithLangGraph(b64, f.type, f.name, latestConfig, onLog, token);

      if (!result) {
        throw new Error("No result received from processing engine.");
      }

      const { extracted_data, evaluation } = result;
      console.log("✅ [Process] Backend complete. Routing:", evaluation.routing, "Confidence:", evaluation.confidence + "%");

      setExtracted(extracted_data);
      setEvaluation(evaluation);
      setStage("done");
      setActiveTab("extraction");

      setClaimsLog(prev => [{
        id: Date.now(),
        file: f, // Store the full file object
        fileName: f.name,
        claim: extracted_data.claimNumber || "N/A",
        claimant: extracted_data.claimantName || "Unknown",
        amount: extracted_data.claimAmount,
        routing: evaluation.routing,
        time: new Date().toLocaleTimeString(),
        confidence: evaluation.confidence,
        extracted: extracted_data, // Store full extracted data
        evaluation: evaluation,    // Store full evaluation
      }, ...prev.slice(0, 19)]); // Increased log size slightly
    } catch (e) {
      console.error("❌ [Process] Error occurred:", e.message);
      console.error("❌ [Process] Full error:", e);
      setError(e.message);
      setStage("error");
    }
  }, [ruleConfig, activeRules, getToken]);


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
    ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #111827; }
    ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; transition: background 0.2s; }
    ::-webkit-scrollbar-thumb:hover { background: #4b5563; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes slideIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fadeIn { from{opacity:0} to{opacity:1} }
    @keyframes scanline { from{top:-10%} to{top:110%} }
    @keyframes shimmer { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
    @keyframes glow { 0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0.4)} 50%{box-shadow:0 0 20px 10px rgba(245,158,11,0)} }
    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
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

  const [authMode, setAuthMode] = useState("sign-in");


  // Fetch history and active rules after sign in (with session check)
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      const fetchData = async () => {
        setIsHistoryLoading(true);
        const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";

        try {
          const token = await getToken();
          const sessionToken = getSessionToken();

          // Step 1: Check for active session conflict
          try {
            const sessionRes = await fetch(`${apiUrl}/session/check`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
              },
              body: JSON.stringify({ session_token: sessionToken })
            });
            const sessionData = await sessionRes.json();
            if (sessionData.conflict) {
              console.warn("⚠️ [Session] Active session conflict detected!");
              setSessionConflict(true);
              setIsHistoryLoading(false);
              return; // Don't load dashboard — show conflict UI
            }
          } catch (sessionErr) {
            console.warn("⚠️ [Session] Could not check session, proceeding:", sessionErr);
          }

          // Step 2: Register this session
          try {
            await fetch(`${apiUrl}/session/register`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
              },
              body: JSON.stringify({ session_token: sessionToken })
            });
          } catch (regErr) {
            console.warn("⚠️ [Session] Could not register session:", regErr);
          }

          // Step 3: Fetch History & Rules
          const historyPromise = fetch(`${apiUrl}/claims-history`, {
            headers: { "Authorization": `Bearer ${token}` }
          }).then(res => res.json());

          const rulesPromise = fetch(`${apiUrl}/rules`, {
            headers: { "Authorization": `Bearer ${token}` }
          }).then(res => res.json());

          const [historyData, rulesData] = await Promise.all([historyPromise, rulesPromise]);

          if (historyData.status === "success" && historyData.history) {
            console.log(`✅ [History] Fetched ${historyData.history.length} claims from DB`);
            setClaimsLog(historyData.history);
          }

          if (rulesData.status === "success" && rulesData.rules) {
            const fetchedRules = rulesData.rules;
            setActiveRules(fetchedRules);

            const initialConfig = {};
            fetchedRules.forEach(rule => {
              if (rule.is_active) {
                initialConfig[rule.id] = { enabled: true, threshold: rule.config?.value || 0 };
              }
            });
            setRuleConfig(initialConfig);
          }

        } catch (err) {
          console.error("❌ [Fetch Data] Error:", err);
        } finally {
          setIsHistoryLoading(false);
        }
      };
      fetchData();
    }
  }, [isLoaded, isSignedIn, sessionConflict, getToken]);

  return (
    <>
      <style>{css}</style>
      <SignedOut>
        <AuthPage mode={authMode} />
      </SignedOut>

      {/* Show dashboard if user is signed in */}
      <SignedIn>

        {/* ── Session Conflict Overlay ── */}
        {sessionConflict && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(3, 7, 18, 0.97)",
            backdropFilter: "blur(12px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Barlow', sans-serif",
            animation: "fadeIn 0.4s ease"
          }}>
            <div style={{
              textAlign: "center", maxWidth: 520, padding: "48px 40px",
              background: "rgba(17, 24, 39, 0.95)",
              border: "2px solid rgba(239, 68, 68, 0.4)",
              borderRadius: 20,
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(239, 68, 68, 0.1)",
              animation: "slideIn 0.5s ease"
            }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.12)",
                border: "2px solid rgba(239, 68, 68, 0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 24px", fontSize: 32
              }}>⚠️</div>
              <h2 style={{
                fontSize: 22, fontWeight: 800, color: "#f87171",
                marginBottom: 12, letterSpacing: "-0.02em"
              }}>Active Session Detected</h2>
              <p style={{
                fontSize: 15, color: "#9ca3af", lineHeight: 1.7,
                marginBottom: 32, maxWidth: 400, margin: "0 auto 32px"
              }}>
                Someone else is already signed in with this username on another device or browser.
              </p>
              <button
                onClick={handleForceLogin}
                disabled={sessionLoading}
                style={{
                  padding: "14px 32px",
                  background: sessionLoading
                    ? "rgba(239, 68, 68, 0.3)"
                    : "linear-gradient(135deg, #ef4444, #dc2626)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: sessionLoading ? "wait" : "pointer",
                  fontFamily: "'Barlow', sans-serif",
                  transition: "all 0.3s ease",
                  boxShadow: "0 8px 24px rgba(239, 68, 68, 0.3)",
                  display: "inline-flex", alignItems: "center", gap: 10
                }}
                onMouseEnter={(e) => {
                  if (!sessionLoading) {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 12px 32px rgba(239, 68, 68, 0.4)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(239, 68, 68, 0.3)";
                }}
              >
                {sessionLoading ? (
                  <>
                    <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}></span>
                    Terminating...
                  </>
                ) : (
                  "🔄 Terminate session and login"
                )}
              </button>
              <p style={{ fontSize: 11, color: "#6b7280", marginTop: 20, fontFamily: "IBM Plex Mono" }}>
                This will end the other session immediately.
              </p>
            </div>
          </div>
        )}

        {/* ── Delete Confirmation Dialog ── */}
        {deleteConfirm && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9998,
            background: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fadeIn 0.2s ease"
          }}
            onClick={() => setDeleteConfirm(null)}
          >
            <div style={{
              background: "#111827",
              border: "1px solid #374151",
              borderRadius: 16,
              padding: "32px 36px",
              maxWidth: 420,
              textAlign: "center",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
              animation: "slideIn 0.3s ease"
            }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: 36, marginBottom: 16 }}>🗑️</div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#f9fafb", marginBottom: 8 }}>Delete Processing Log?</h3>
              <p style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6, marginBottom: 24 }}>
                This will permanently remove this claim record from the database. This action cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  style={{
                    padding: "10px 24px", background: "transparent",
                    border: "1px solid #374151", borderRadius: 10,
                    color: "#d1d5db", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", fontFamily: "'Barlow', sans-serif",
                    transition: "all 0.2s ease"
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#6b7280"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#374151"; }}
                >Cancel</button>
                <button
                  onClick={() => handleDeleteClaim(deleteConfirm)}
                  disabled={deleteLoading}
                  style={{
                    padding: "10px 24px",
                    background: deleteLoading ? "rgba(239, 68, 68, 0.4)" : "linear-gradient(135deg, #ef4444, #dc2626)",
                    border: "none", borderRadius: 10,
                    color: "#fff", fontSize: 13, fontWeight: 700,
                    cursor: deleteLoading ? "wait" : "pointer",
                    fontFamily: "'Barlow', sans-serif",
                    transition: "all 0.2s ease",
                    boxShadow: "0 4px 16px rgba(239, 68, 68, 0.3)",
                    display: "inline-flex", alignItems: "center", gap: 8
                  }}
                  onMouseEnter={(e) => {
                    if (!deleteLoading) {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 6px 20px rgba(239, 68, 68, 0.4)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 16px rgba(239, 68, 68, 0.3)";
                  }}
                >
                  {deleteLoading ? (
                    <>
                      <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}></span>
                      Deleting...
                    </>
                  ) : (
                    "Delete"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ fontFamily: "'Barlow', sans-serif", background: colors.bg, minHeight: "100vh", color: colors.text }}>

          {/* ── Top Bar ── */}
          <div style={{
            borderBottom: `1px solid ${colors.border}`, padding: "0 24px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            height: 64, background: "rgba(13, 17, 23, 0.95)",
            backdropFilter: "blur(8px)",
            position: "sticky", top: 0, zIndex: 100,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
            animation: "slideIn 0.4s ease"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src={logoImg} alt="Extremum Analytics" style={{ height: 38 }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.02em", color: "#f59e0b" }}>CLAIMSIQ</div>
                <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.05em" }}>AGENTIC PROCESSING ENGINE</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ fontSize: 13, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.02em" }}>
                {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
              </div>
              <div style={{
                padding: "6px 12px",
                background: "linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 46, 22, 0.2))",
                border: "1.5px solid rgba(16, 185, 129, 0.4)",
                borderRadius: 8,
                fontSize: 11,
                color: "#10b981",
                fontFamily: "IBM Plex Mono",
                fontWeight: 700,
                letterSpacing: "0.05em",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.3s ease",
                animation: "slideIn 0.5s ease 0.2s backwards",
                opacity: 0,
                animationFillMode: "forwards",
                boxShadow: "0 0 12px rgba(16, 185, 129, 0.2)"
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite" }}></span>
                LIVE
              </div>

              {/* Navigation */}
              <div style={{
                display: "flex", background: "rgba(31, 41, 55, 0.4)",
                padding: "4px", borderRadius: "10px", border: `1px solid ${colors.border}`,
                marginLeft: 12
              }}>
                <button
                  onClick={() => setView('dashboard')}
                  style={{
                    padding: "6px 16px", borderRadius: "8px", border: "none",
                    background: view === 'dashboard' ? colors.accent : "transparent",
                    color: view === 'dashboard' ? "#000" : colors.muted,
                    fontSize: 11, fontWeight: 800, cursor: "pointer", transition: "all 0.3s ease"
                  }}
                >CLAIMS</button>
                <button
                  onClick={() => setView('rules')}
                  style={{
                    padding: "6px 16px", borderRadius: "8px", border: "none",
                    background: view === 'rules' ? colors.accent : "transparent",
                    color: view === 'rules' ? colors.bg : colors.text,
                    fontSize: 11, fontWeight: 800, cursor: "pointer", transition: "all 0.3s ease"
                  }}
                >RULES</button>
              </div>

              <UserButton afterSignOutUrl="/" appearance={clerkAppearance} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: view === 'dashboard' ? "1fr 420px" : "1fr", gap: 0, maxWidth: 1440, margin: "0 auto", height: "calc(100vh - 64px)" }}>

            {/* ── Main Panel ── */}
            <div style={{ padding: 28, borderRight: view === 'dashboard' ? `1px solid ${colors.border}` : "none", overflowY: "auto" }}>

              {view === "rules" ? (
                <RulesManagement colors={colors} getToken={getToken} />
              ) : (
                <>
                  {/* Upload Zone */}
                  {stage === "idle" || stage === "error" ? (
                    <>
                      <div
                        onClick={() => fileRef.current?.click()}
                        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
                        onDrop={handleDrop}
                        style={{
                          border: `2px dashed ${dragOver ? colors.accent : colors.border}`,
                          borderRadius: 20, padding: "140px 40px", textAlign: "center", cursor: "pointer",
                          background: dragOver ? "rgba(245, 158, 11, 0.08)" : "rgba(17, 24, 39, 0.6)",
                          backdropFilter: dragOver ? "blur(8px)" : "blur(4px)",
                          transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)", marginBottom: 24,
                          minHeight: "520px", display: "flex", flexDirection: "column",
                          alignItems: "center", justifyContent: "center",
                          boxShadow: dragOver
                            ? `0 0 60px ${colors.accent}33, inset 0 0 40px ${colors.accent}11`
                            : "0 8px 32px rgba(0, 0, 0, 0.3)",
                          animation: "slideIn 0.5s ease-out",
                          transform: dragOver ? "scale(1.01)" : "scale(1)"
                        }}
                      >
                        <div style={{
                          marginBottom: 24,
                          filter: dragOver ? "drop-shadow(0 4px 16px rgba(245, 158, 11, 0.4))" : "drop-shadow(0 2px 8px rgba(0,0,0,0.3))",
                          transition: "all 0.3s ease",
                          transform: dragOver ? "scale(1.1)" : "scale(1)"
                        }}>
                          <img
                            src="/document_icon.jpg"
                            alt="document"
                            style={{
                              width: 140,
                              height: "auto",
                              opacity: dragOver ? 1 : 0.9,
                              transition: "all 0.3s ease"
                            }}
                          />
                        </div>
                        <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 12, letterSpacing: "-0.02em", color: colors.text }}>
                          Drop your claims document
                        </div>
                        <div style={{ fontSize: 15, color: colors.muted, marginBottom: 20, maxWidth: 480, lineHeight: 1.5 }}>
                          Supports PDF, Word (.docx), PNG, JPG, JPEG, TIFF
                        </div>
                        <div style={{
                          display: "inline-block", padding: "12px 32px",
                          background: `linear-gradient(135deg, ${colors.accent}, #f9a825)`,
                          color: "#000", borderRadius: 10,
                          fontWeight: 700, fontSize: 15, cursor: "pointer",
                          transition: "all 0.3s ease",
                          boxShadow: "0 4px 16px rgba(245, 158, 11, 0.3)",
                          border: "2px solid transparent",
                          transform: dragOver ? "translateY(-2px)" : "translateY(0)"
                        }}>
                          Browse Files
                        </div>
                        {stage === "error" && (
                          <div style={{
                            marginTop: 24, padding: "12px 16px",
                            background: "rgba(244, 63, 94, 0.1)",
                            border: "1px solid #f87171",
                            borderRadius: 10,
                            color: "#fca5a5",
                            fontSize: 13,
                            backdropFilter: "blur(4px)",
                            animation: "slideIn 0.3s ease"
                          }}>
                            ⚠ Error: {error}
                          </div>
                        )}
                        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tiff,.tif" onChange={handleFile} style={{ display: "none" }} />
                      </div>

                      {/* Rule Selection Section Removed as per request */}
                    </>
                  ) : stage === "processing" ? (
                    <div style={{
                      border: `1px solid ${colors.border}`, borderRadius: 16, padding: "40px 24px",
                      textAlign: "center", background: "rgba(13, 17, 23, 0.8)",
                      backdropFilter: "blur(8px)", marginBottom: 24,
                      animation: "slideIn 0.3s ease", position: "relative", overflow: "hidden",
                      boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
                      minHeight: "520px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center"
                    }}>
                      <div style={{
                        position: "absolute", left: 0, right: 0, height: 2,
                        background: `linear-gradient(90deg, transparent, ${colors.accent}, transparent)`,
                        animation: "scanline 1.5s linear infinite", top: 0
                      }} />

                      <div style={{ padding: "0 20px", width: "100%", maxWidth: 600 }}>
                        <div style={{
                          width: 56, height: 56, border: `3px solid ${colors.dim}`,
                          borderTopColor: colors.accent, borderRadius: "50%",
                          animation: "spin 0.9s linear infinite", margin: "0 auto 24px",
                          boxShadow: `0 0 20px ${colors.accent}44`
                        }} />

                        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, color: colors.text }}>Processing Claim</div>
                        <div style={{ fontSize: 14, color: colors.muted, fontFamily: "IBM Plex Mono", marginBottom: 32 }}>
                          {file?.name}
                        </div>

                        {/* Processing Logs */}
                        <div style={{
                          background: "rgba(3, 7, 18, 0.6)",
                          borderRadius: 12,
                          border: `1px solid ${colors.border}`,
                          padding: 16,
                          textAlign: "left",
                          maxHeight: 280,
                          overflowY: "auto",
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5)"
                        }}>
                          {processingLogs.length === 0 ? (
                            <div style={{ color: colors.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                              Waiting for engine signals...
                            </div>
                          ) : (
                            processingLogs.map((log, i) => {
                              const isActive = log.status === "started";
                              const isLast = i === processingLogs.length - 1;

                              return (
                                <div key={i} style={{
                                  display: "flex",
                                  gap: 12,
                                  alignItems: "flex-start",
                                  animation: "slideIn 0.3s ease-out",
                                  opacity: isLast || isActive ? 1 : 0.5,
                                  padding: "8px 0",
                                  borderBottom: isLast ? "none" : `1px solid ${colors.border}33`,
                                  transition: "all 0.3s ease"
                                }}>
                                  <div style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: "50%",
                                    background: isActive ? colors.accent : "#10b981",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 9,
                                    color: "#000",
                                    fontWeight: 900,
                                    marginTop: 2,
                                    boxShadow: isActive ? `0 0 10px ${colors.accent}88` : "none",
                                    animation: isActive ? "pulse 1.5s infinite" : "none"
                                  }}>
                                    {isActive ? "▶" : "✓"}
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{
                                      fontSize: 13,
                                      fontWeight: isLast || isActive ? 700 : 500,
                                      color: isActive ? colors.accent : colors.text,
                                      transition: "color 0.3s ease"
                                    }}>
                                      {log.message} {isActive && "..."}
                                    </div>
                                    <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", marginTop: 2, opacity: 0.8 }}>
                                      {log.time}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                          <div ref={el => el?.scrollIntoView({ behavior: "smooth" })} />
                        </div>

                        <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 32, fontSize: 11, color: colors.muted, opacity: 0.8 }}>
                          {["Ingest", "Extract", "Analyze", "Route"].map((s, i) => {
                            const active = (i === 0 && processingLogs.some(l => l.node === "ocr")) ||
                              (i === 1 && processingLogs.some(l => l.node === "extraction")) ||
                              (i === 2 && processingLogs.some(l => l.node.startsWith("br0"))) ||
                              (i === 3 && processingLogs.some(l => l.node === "evaluation"));

                            return (
                              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                                <div style={{
                                  width: 8, height: 8, borderRadius: "50%",
                                  background: active ? colors.accent : colors.dim,
                                  boxShadow: active ? `0 0 10px ${colors.accent}66` : "none",
                                  transition: "all 0.4s ease"
                                }} />
                                <span style={{ fontWeight: active ? 700 : 500, color: active ? colors.text : colors.muted }}>{s.toUpperCase()}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                  ) : null}

                  {/* Results */}
                  {stage === "done" && extracted && evaluation && (
                    <div style={{ animation: "slideIn 0.4s ease" }}>

                      {/* Decision Banner */}
                      <div style={{
                        borderRadius: 16, padding: "24px 28px", marginBottom: 24,
                        background: evaluation.routing === "STP"
                          ? "linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 46, 22, 0.3))"
                          : "linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(69, 10, 10, 0.3))",
                        border: `2px solid ${evaluation.routing === "STP" ? "#10b9814d" : "#ef4444cc"}`,
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        animation: "slideIn 0.5s ease",
                        boxShadow: evaluation.routing === "STP"
                          ? "0 0 30px rgba(16, 185, 129, 0.2)"
                          : "0 0 30px rgba(239, 68, 68, 0.15)",
                        backdropFilter: "blur(8px)"
                      }}>
                        <div>
                          <div style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.12em", marginBottom: 8, fontWeight: 700 }}>ROUTING DECISION</div>
                          <div style={{ fontSize: 28, fontWeight: 800, color: evaluation.routing === "STP" ? "#10b981" : "#ef4444", marginBottom: 4 }}>
                            {evaluation.routing === "STP" ? "✓ Straight-Through" : `⚠ Escalate`}
                          </div>
                          {evaluation.routing === "ESCALATE" && (
                            <div style={{ fontSize: 14, color: "#fca5a5", marginTop: 4, opacity: 0.9 }}>
                              {evaluation.escalateTo}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.muted, marginBottom: 4, fontWeight: 700 }}>CONFIDENCE</div>
                          <div style={{ fontSize: 40, fontWeight: 800, color: evaluation.routing === "STP" ? "#10b981" : "#ef4444" }}>
                            {evaluation.confidence}%
                          </div>
                        </div>
                      </div>

                      {/* Tabs */}
                      <div style={{ display: "flex", gap: 2, borderBottom: `2px solid ${colors.border}`, marginBottom: 24 }}>
                        {[
                          { id: "extraction", label: "Extracted Data" },
                          { id: "rules", label: `Business Rules (${evaluation.results.filter(r => r.passed && r.status !== "SKIPPED").length}/${evaluation.results.filter(r => r.status !== "SKIPPED").length})` },
                          { id: "notes", label: "AI Notes" },
                        ].map(t => (
                          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                            padding: "12px 20px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
                            fontFamily: "'Barlow', sans-serif",
                            background: "transparent",
                            color: activeTab === t.id ? colors.accent : colors.muted,
                            borderBottom: activeTab === t.id ? `3px solid ${colors.accent}` : "3px solid transparent",
                            transition: "all 0.2s ease",
                            position: "relative",
                            opacity: activeTab === t.id ? 1 : 0.7
                          }}>
                            {t.label}
                            {activeTab === t.id && (
                              <div style={{
                                position: "absolute",
                                bottom: "-4px",
                                left: "0",
                                right: "0",
                                height: "3px",
                                background: colors.accent,
                                animation: "slideIn 0.2s ease"
                              }} />
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Extraction Tab */}
                      {activeTab === "extraction" && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, animation: "fadeIn 0.3s ease" }}>
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
                              padding: "14px 16px",
                              background: "rgba(17, 24, 39, 0.8)",
                              backdropFilter: "blur(8px)",
                              borderRadius: 12,
                              border: `1px solid ${colors.border}`,
                              transition: "all 0.3s ease",
                              cursor: "default",
                              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                              animation: "slideIn 0.4s ease"
                            }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = colors.accent;
                                e.currentTarget.style.background = "rgba(17, 24, 39, 0.95)";
                                e.currentTarget.style.boxShadow = `0 8px 24px rgba(245, 158, 11, 0.15)`;
                                e.currentTarget.style.transform = "translateY(-2px)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = colors.border;
                                e.currentTarget.style.background = "rgba(17, 24, 39, 0.8)";
                                e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
                                e.currentTarget.style.transform = "translateY(0)";
                              }}>
                              <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>{label.toUpperCase()}</div>
                              <div style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>{fmt(extracted[key])}</div>
                            </div>
                          ))}
                          {extracted.claimantAddress && (
                            <div style={{
                              gridColumn: "1 / -1", padding: "14px 16px",
                              background: "rgba(17, 24, 39, 0.8)",
                              backdropFilter: "blur(8px)",
                              borderRadius: 12,
                              border: `1px solid ${colors.border}`,
                              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                              animation: "slideIn 0.4s ease",
                              transition: "all 0.3s ease"
                            }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = colors.accent;
                                e.currentTarget.style.transform = "translateY(-2px)";
                                e.currentTarget.style.boxShadow = `0 8px 24px rgba(245, 158, 11, 0.15)`;
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = colors.border;
                                e.currentTarget.style.transform = "translateY(0)";
                                e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
                              }}>
                              <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>ADDRESS</div>
                              <div style={{ fontSize: 15, fontWeight: 600 }}>{extracted.claimantAddress}</div>
                            </div>
                          )}
                          {extracted.incidentDescription && (
                            <div style={{
                              gridColumn: "1 / -1", padding: "14px 16px",
                              background: "rgba(17, 24, 39, 0.8)",
                              backdropFilter: "blur(8px)",
                              borderRadius: 12,
                              border: `1px solid ${colors.border}`,
                              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                              animation: "slideIn 0.4s ease",
                              transition: "all 0.3s ease"
                            }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = colors.accent;
                                e.currentTarget.style.transform = "translateY(-2px)";
                                e.currentTarget.style.boxShadow = `0 8px 24px rgba(245, 158, 11, 0.15)`;
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = colors.border;
                                e.currentTarget.style.transform = "translateY(0)";
                                e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
                              }}>
                              <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>INCIDENT DESCRIPTION</div>
                              <div style={{ fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>{extracted.incidentDescription}</div>
                            </div>
                          )}
                          {extracted.missingFields?.length > 0 && (
                            <div style={{
                              gridColumn: "1 / -1", padding: "14px 16px",
                              background: "rgba(28, 17, 7, 0.9)",
                              backdropFilter: "blur(8px)",
                              borderRadius: 12,
                              border: `1px solid rgba(245, 158, 11, 0.4)`,
                              boxShadow: "0 4px 16px rgba(245, 158, 11, 0.1)",
                              animation: "slideIn 0.4s ease"
                            }}>
                              <div style={{ fontSize: 11, color: colors.accent, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>⚠ MISSING FIELDS</div>
                              <div style={{ fontSize: 13, color: "#fcd34d" }}>{extracted.missingFields.join(", ")}</div>
                            </div>
                          )}

                          {/* Additional Fields from Document */}
                          {extracted.additionalFields && Object.keys(extracted.additionalFields).length > 0 && (
                            <>
                              <div style={{
                                gridColumn: "1 / -1", fontSize: 12, fontFamily: "IBM Plex Mono",
                                color: colors.accent, letterSpacing: "0.08em", fontWeight: 700,
                                marginTop: 8, paddingTop: 16, borderTop: `1px solid ${colors.border}`,
                                display: "flex", alignItems: "center", gap: 8
                              }}>
                                <span>📋</span> ADDITIONAL DETAILS
                              </div>
                              {Object.entries(extracted.additionalFields).map(([key, value]) => (
                                <div key={key} style={{
                                  padding: "14px 16px",
                                  background: "rgba(17, 24, 39, 0.8)",
                                  backdropFilter: "blur(8px)",
                                  borderRadius: 12,
                                  border: `1px solid ${colors.border}`,
                                  transition: "all 0.3s ease",
                                  cursor: "default",
                                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                                  animation: "slideIn 0.4s ease",
                                  gridColumn: (typeof value === "string" && value.length > 60) || (Array.isArray(value) && value.length > 2) || (typeof value === "object" && !Array.isArray(value) && value !== null) ? "1 / -1" : undefined
                                }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = colors.accent;
                                    e.currentTarget.style.background = "rgba(17, 24, 39, 0.95)";
                                    e.currentTarget.style.boxShadow = `0 8px 24px rgba(245, 158, 11, 0.15)`;
                                    e.currentTarget.style.transform = "translateY(-2px)";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = colors.border;
                                    e.currentTarget.style.background = "rgba(17, 24, 39, 0.8)";
                                    e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
                                    e.currentTarget.style.transform = "translateY(0)";
                                  }}>
                                  <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>{camelToLabel(key)}</div>
                                  <div style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>{fmt(value)}</div>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}

                      {/* Rules Tab */}
                      {activeTab === "rules" && (
                        <div style={{
                          border: `1px solid ${colors.border}`,
                          borderRadius: 12,
                          overflow: "hidden",
                          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
                          animation: "fadeIn 0.3s ease"
                        }}>
                          <div style={{
                            display: "grid", gridTemplateColumns: "24px 80px 1fr 100px 80px",
                            gap: 12, padding: "12px 14px",
                            background: "rgba(13, 17, 23, 0.9)", fontSize: 10, color: colors.muted,
                            fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", borderBottom: `1px solid ${colors.border}`
                          }}>
                            <span></span><span>RULE ID</span><span>DESCRIPTION</span><span>ACTUAL</span><span>RESULT</span>
                          </div>
                          {evaluation.results.map((r, idx) => (
                            <div key={r.id}
                              style={{
                                display: "grid", gridTemplateColumns: "24px 80px 1fr 100px 80px",
                                gap: 12, padding: "12px 14px",
                                borderBottom: idx !== evaluation.results.length - 1 ? `1px solid ${colors.border}` : "none",
                                alignItems: "center", fontSize: 13,
                                opacity: r.status === "SKIPPED" ? 0.5 : 1,
                                background: idx % 2 === 0 ? "transparent" : "rgba(17, 24, 39, 0.3)",
                                transition: "all 0.2s ease"
                              }}
                              onMouseEnter={(e) => {
                                if (r.status !== "SKIPPED") {
                                  e.currentTarget.style.background = "rgba(245, 158, 11, 0.05)";
                                  e.currentTarget.style.borderLeft = `3px solid ${colors.accent}`;
                                  e.currentTarget.style.paddingLeft = "11px";
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = idx % 2 === 0 ? "transparent" : "rgba(17, 24, 39, 0.3)";
                                e.currentTarget.style.borderLeft = "none";
                                e.currentTarget.style.paddingLeft = "14px";
                              }}>
                              <span style={{ fontSize: 16 }}>{r.status === "SKIPPED" ? "○" : r.passed ? "✓" : "✗"}</span>
                              <span style={{
                                fontFamily: "'Courier New', monospace", fontSize: 11,
                                color: r.status === "SKIPPED" ? "#6b7280" : r.passed ? "#4ade80" : "#f87171", fontWeight: 700
                              }}>{r.id}</span>
                              <div>
                                <div style={{ color: r.status === "SKIPPED" ? "#6b7280" : "#e5e7eb", fontWeight: 600, fontSize: 12 }}>{r.name}</div>
                                <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{r.status === "SKIPPED" ? "Skipped by configuration" : r.description}</div>
                              </div>
                              <span style={{ color: "#9ca3af", fontSize: 12, fontFamily: "monospace" }}>
                                {r.status === "SKIPPED" ? "—" : r.actual !== undefined ? String(r.actual) : "—"}
                              </span>
                              <span style={{
                                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, textAlign: "center",
                                background: r.status === "SKIPPED" ? "#1f2937" : r.passed ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                color: r.status === "SKIPPED" ? "#9ca3af" : r.passed ? "#10b981" : "#ef4444",
                                border: `1px solid ${r.status === "SKIPPED" ? "#374151" : r.passed ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                                transition: "all 0.2s ease"
                              }}>{r.status === "SKIPPED" ? "SKIP" : r.passed ? "✓ PASS" : "✗ FAIL"}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Notes Tab */}
                      {activeTab === "notes" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fadeIn 0.3s ease" }}>
                          <div style={{
                            padding: "18px",
                            background: "rgba(17, 24, 39, 0.8)",
                            backdropFilter: "blur(8px)",
                            borderRadius: 12,
                            border: `1px solid ${colors.border}`,
                            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                            transition: "all 0.3s ease"
                          }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = colors.accent;
                              e.currentTarget.style.boxShadow = `0 8px 24px rgba(245, 158, 11, 0.15)`;
                              e.currentTarget.style.transform = "translateY(-2px)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = colors.border;
                              e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
                              e.currentTarget.style.transform = "translateY(0)";
                            }}>
                            <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>💡 EXTRACTION NOTES</div>
                            <div style={{ fontSize: 14, color: "#d1d5db", lineHeight: 1.7 }}>{extracted.extractionNotes || "No notable observations."}</div>
                          </div>

                          <div style={{
                            padding: "18px",
                            background: "rgba(17, 24, 39, 0.8)",
                            backdropFilter: "blur(8px)",
                            borderRadius: 12,
                            border: `1px solid ${colors.border}`,
                            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                            transition: "all 0.3s ease"
                          }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = colors.accent;
                              e.currentTarget.style.boxShadow = `0 8px 24px rgba(245, 158, 11, 0.15)`;
                              e.currentTarget.style.transform = "translateY(-2px)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = colors.border;
                              e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
                              e.currentTarget.style.transform = "translateY(0)";
                            }}>
                            <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>🛡️ FRAUD RISK ASSESSMENT</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                              <div style={{ flex: 1, height: 10, background: colors.dim, borderRadius: 6, overflow: "hidden" }}>
                                <div style={{
                                  height: "100%", width: `${extracted.fraudScore || 0}%`,
                                  background: (extracted.fraudScore || 0) > 60 ? "linear-gradient(90deg, #ef4444, #f87171)" : (extracted.fraudScore || 0) > 30 ? "linear-gradient(90deg, #f59e0b, #fbbf24)" : "linear-gradient(90deg, #10b981, #4ade80)",
                                  borderRadius: 6, transition: "width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)"
                                }} />
                              </div>
                              <span style={{ fontFamily: "IBM Plex Mono", fontSize: 15, fontWeight: 700, minWidth: 50 }}>{extracted.fraudScore ?? 0}/100</span>
                            </div>
                            <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.6, marginBottom: 14 }}>
                              {(extracted.fraudScore || 0) <= 30 ? "✓ Low risk — proceed normally" :
                                (extracted.fraudScore || 0) <= 60 ? "⚠ Moderate risk — manual review recommended" :
                                  "🔴 High risk — escalate to fraud investigation unit"}
                            </div>
                            {extracted.fraudReasons && extracted.fraudReasons.length > 0 && (
                              <div style={{
                                padding: "12px",
                                background: "rgba(245, 158, 11, 0.08)",
                                border: `1px solid rgba(245, 158, 11, 0.3)`,
                                borderRadius: 8,
                                fontSize: 12,
                                color: "#fcd34d",
                                lineHeight: 1.7
                              }}>
                                <div style={{ fontSize: 10, color: colors.accent, fontWeight: 700, marginBottom: 8, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em" }}>⚠️ CONTRIBUTING FACTORS:</div>
                                {extracted.fraudReasons.map((reason, idx) => (
                                  <div key={idx} style={{ marginBottom: idx < extracted.fraudReasons.length - 1 ? 6 : 0, display: "flex", gap: 8 }}>
                                    <span style={{ minWidth: 20, color: colors.accent, fontWeight: 700 }}>•</span>
                                    <span>{reason}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div style={{
                            padding: "18px",
                            background: "rgba(17, 24, 39, 0.8)",
                            backdropFilter: "blur(8px)",
                            borderRadius: 12,
                            border: `1px solid ${colors.border}`,
                            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                            transition: "all 0.3s ease"
                          }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = colors.accent;
                              e.currentTarget.style.boxShadow = `0 8px 24px rgba(245, 158, 11, 0.15)`;
                              e.currentTarget.style.transform = "translateY(-2px)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = colors.border;
                              e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
                              e.currentTarget.style.transform = "translateY(0)";
                            }}>
                            <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>📄 SUPPORTING DOCUMENTS</div>
                            <div style={{ fontSize: 14 }}>{fmt(extracted.supportingDocuments)}</div>
                          </div>

                          <div style={{
                            padding: "18px",
                            background: "rgba(28, 17, 7, 0.9)",
                            backdropFilter: "blur(8px)",
                            borderRadius: 12,
                            border: `2px solid rgba(245, 158, 11, 0.4)`,
                            boxShadow: "0 4px 16px rgba(245, 158, 11, 0.1)",
                            transition: "all 0.3s ease"
                          }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = colors.accent;
                              e.currentTarget.style.boxShadow = `0 8px 24px rgba(245, 158, 11, 0.25)`;
                              e.currentTarget.style.transform = "translateY(-2px)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = "rgba(245, 158, 11, 0.4)";
                              e.currentTarget.style.boxShadow = "0 4px 16px rgba(245, 158, 11, 0.1)";
                              e.currentTarget.style.transform = "translateY(0)";
                            }}>
                            <div style={{ fontSize: 11, color: colors.accent, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>✨ RECOMMENDED ACTIONS</div>
                            <div style={{ fontSize: 13, color: "#fcd34d", lineHeight: 1.8, whiteSpace: "pre-line" }}>
                              {evaluation.routing === "STP"
                                ? "✓ All rules passed. Claim can be auto-processed without manual intervention.\n✓ Generate payment authorization.\n✓ Notify claimant of approval."
                                : `• Route to: ${evaluation.escalateTo}\n• Reason(s): ${evaluation.escalationReasons.join(", ")}\n• Priority: ${(extracted.fraudScore || 0) > 60 || (extracted.claimAmount || 0) > 25000 ? "HIGH" : "MEDIUM"}`
                              }
                            </div>
                          </div>
                        </div>
                      )}


                      <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={reset} style={{
                          padding: "12px 28px",
                          background: "transparent",
                          border: `2px solid ${colors.border}`,
                          borderRadius: 10,
                          color: colors.text,
                          cursor: "pointer",
                          fontFamily: "'Barlow', sans-serif",
                          fontWeight: 700,
                          fontSize: 14,
                          transition: "all 0.3s ease",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)"
                        }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = colors.accent;
                            e.currentTarget.style.background = `rgba(245, 158, 11, 0.1)`;
                            e.currentTarget.style.color = colors.accent;
                            e.currentTarget.style.transform = "translateY(-2px)";
                            e.currentTarget.style.boxShadow = `0 8px 20px rgba(245, 158, 11, 0.2)`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = colors.border;
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = colors.text;
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
                          }}>
                          + Process Another Claim
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Sidebar ── */}
            {view === 'dashboard' && (
              <div style={{ padding: 24, background: "rgba(13, 17, 23, 0.9)", backdropFilter: "blur(4px)", maxHeight: "100vh", overflowY: "auto", borderLeft: `1px solid ${colors.border}` }}>

                {/* Current Status */}
                <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${colors.border}` }}>
                  <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.accent, letterSpacing: "0.1em", marginBottom: 12, fontWeight: 700 }}>📊 CURRENT STATUS</div>
                  <StatusBadge status={stage === "processing" ? "PROCESSING" : stage === "done" ? evaluation?.routing : "IDLE"} />
                  {file && (
                    <div style={{
                      marginTop: 12, padding: "12px 14px",
                      background: "rgba(17, 24, 39, 0.8)",
                      backdropFilter: "blur(8px)",
                      borderRadius: 10,
                      border: `1px solid ${colors.border}`,
                      animation: "slideIn 0.4s ease",
                      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)"
                    }}>
                      <div style={{ fontSize: 11, color: colors.muted, marginBottom: 4, fontWeight: 700 }}>DOCUMENT</div>
                      <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all", color: colors.text, marginBottom: 4 }}>{file.name}</div>
                      <div style={{ fontSize: 11, color: colors.muted }}>{(file.size / 1024).toFixed(1)} KB</div>
                    </div>
                  )}
                </div>



                {/* Processing Log */}
                <div>
                  <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.1em", marginBottom: 12 }}>
                    📋 PROCESSING LOG {claimsLog.length > 0 && !isHistoryLoading ? `(${claimsLog.length})` : ""}
                  </div>
                  {isHistoryLoading ? (
                    <div style={{ padding: "30px 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.3s ease" }}>
                      <div style={{ width: 28, height: 28, border: `2px solid ${colors.dim}`, borderTopColor: colors.accent, borderRadius: "50%", animation: "spin 0.9s linear infinite", marginBottom: 12 }} />
                      <div style={{ fontSize: 12, color: colors.muted, fontStyle: "italic" }}>loading your past fetched documents...</div>
                    </div>
                  ) : claimsLog.length === 0 ? (
                    <div style={{ fontSize: 12, color: colors.muted, fontStyle: "italic", padding: "10px 0" }}>No claims processed yet</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {claimsLog.map(c => (
                        <div key={c.id} style={{
                          padding: "10px 12px",
                          background: selectedLog?.id === c.id ? `rgba(245, 158, 11, 0.15)` : "rgba(17, 24, 39, 0.8)",
                          backdropFilter: "blur(4px)",
                          borderRadius: 8,
                          border: `2px solid ${selectedLog?.id === c.id ? colors.accent : c.routing === "STP" ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                          fontSize: 11,
                          animation: "slideIn 0.3s ease",
                          transition: "all 0.2s ease",
                          cursor: "pointer",
                          boxShadow: selectedLog?.id === c.id ? `0 0 16px ${colors.accent}44` : "0 2px 6px rgba(0, 0, 0, 0.2)",
                          position: "relative"
                        }}
                          onClick={() => setSelectedLog(c)}
                          onMouseEnter={(e) => {
                            if (selectedLog?.id !== c.id) {
                              e.currentTarget.style.transform = "translateX(4px)";
                              e.currentTarget.style.boxShadow = `0 4px 12px ${c.routing === "STP" ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`;
                            }
                            e.currentTarget.querySelector('.delete-btn').style.opacity = '1';
                          }}
                          onMouseLeave={(e) => {
                            if (selectedLog?.id !== c.id) {
                              e.currentTarget.style.transform = "translateX(0)";
                              e.currentTarget.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.2)";
                            }
                            e.currentTarget.querySelector('.delete-btn').style.opacity = '0';
                          }}>
                          {/* Delete button */}
                          <button
                            className="delete-btn"
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(c.id); }}
                            style={{
                              position: "absolute", bottom: 6, right: 6,
                              width: 28, height: 28, borderRadius: 6,
                              background: "rgba(239, 68, 68, 0.2)",
                              border: "1px solid rgba(239, 68, 68, 0.4)",
                              color: "#f87171", fontSize: 14,
                              cursor: "pointer", display: "flex",
                              alignItems: "center", justifyContent: "center",
                              opacity: 0, transition: "all 0.2s ease",
                              padding: 0, lineHeight: 1
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(239, 68, 68, 0.3)";
                              e.currentTarget.style.borderColor = "#ef4444";
                              e.currentTarget.style.transform = "scale(1.1)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
                              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
                              e.currentTarget.style.transform = "scale(1)";
                            }}
                            title="Delete this log entry"
                          >🗑</button>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, color: c.routing === "STP" ? "#10b981" : "#ef4444" }}>
                              {c.routing === "STP" ? "✓ STP" : "⚠ ESC"}
                            </span>
                            <span style={{ color: colors.muted, fontFamily: "IBM Plex Mono", fontSize: 9 }}>{c.time && c.time !== "N/A" ? new Date(c.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : "N/A"}</span>
                          </div>
                          <div style={{ color: "#d1d5db", fontWeight: 500, marginBottom: 2 }}>{c.claimant}</div>
                          <div style={{ color: colors.muted, fontSize: 10 }}>
                            {c.claim} {c.amount ? `· $${Number(c.amount).toLocaleString()}` : ""} · {c.confidence}% pass
                          </div>
                          {c.submitterEmail && (
                            <div style={{ color: colors.accent, fontSize: 10, marginTop: 4, fontFamily: "IBM Plex Mono", fontWeight: 600 }}>
                              Submitted by: {c.submitterEmail}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </SignedIn >

      {/* ── Claim History Detail Modal ── */}
      {
        selectedLog && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20, animation: "fadeIn 0.2s ease"
          }}
            onClick={() => setSelectedLog(null)}>
            <div style={{
              background: colors.card, borderRadius: 16, maxWidth: 900, width: "100%",
              maxHeight: "90vh", overflowY: "auto",
              border: `1px solid ${colors.border}`,
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
              animation: "slideIn 0.3s ease",
              color: colors.text
            }}
              onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div style={{
                padding: "20px 24px", borderBottom: `1px solid ${colors.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: selectedLog.routing === "STP"
                  ? "rgba(16, 185, 129, 0.05)"
                  : "rgba(239, 68, 68, 0.05)",
                position: "sticky", top: 0, zIndex: 10
              }}>
                <div>
                  <div style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>CLAIM HISTORY</div>
                  <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: colors.text }}>{selectedLog.claimant}</h2>
                  <div style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>
                    Claim #{selectedLog.claim} · {selectedLog.time}
                  </div>
                  {selectedLog.submitterEmail && (
                    <div style={{ fontSize: 11, color: colors.accent, marginTop: 6, fontFamily: "IBM Plex Mono", fontWeight: 700 }}>
                      <span style={{ opacity: 0.8 }}>SUBMITTER:</span> {selectedLog.submitterEmail}
                    </div>
                  )}
                </div>
                <button onClick={() => setSelectedLog(null)} style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: colors.border, border: "none",
                  color: colors.text, fontSize: 18, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s ease",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)"
                }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = colors.accent;
                    e.currentTarget.style.color = colors.bg;
                    e.currentTarget.style.transform = "scale(1.1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = colors.border;
                    e.currentTarget.style.color = colors.text;
                    e.currentTarget.style.transform = "scale(1)";
                  }}>×</button>
              </div>

              {/* Top Info Banner */}
              <div style={{
                padding: "16px 24px", borderBottom: `1px solid ${colors.border}`,
                display: "flex", justifyContent: "space-between", gap: 24,
                background: "rgba(17, 24, 39, 0.4)"
              }}>
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", fontWeight: 700, marginBottom: 4 }}>ROUTING</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: selectedLog.routing === "STP" ? "#10b981" : "#ef4444" }}>
                    {selectedLog.routing === "STP" ? "✓ STRAIGHT-THROUGH" : "⚠ ESCALATED"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", fontWeight: 700, marginBottom: 4 }}>CONFIDENCE</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: colors.accent }}>{selectedLog.confidence}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", fontWeight: 700, marginBottom: 4 }}>AMOUNT</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>
                    ${Number(selectedLog.amount).toLocaleString()}
                  </div>
                </div>
                {selectedLog.extracted?.fraudScore !== undefined && (
                  <div>
                    <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", fontWeight: 700, marginBottom: 4 }}>FRAUD SCORE</div>
                    <div style={{
                      fontSize: 14, fontWeight: 700,
                      color: selectedLog.extracted.fraudScore > 60 ? "#ef4444" : selectedLog.extracted.fraudScore > 30 ? "#f59e0b" : "#10b981"
                    }}>
                      {selectedLog.extracted.fraudScore}/100
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div style={{ borderBottom: `1px solid ${colors.border}`, display: "flex", background: "rgba(13, 17, 23, 0.5)", position: "sticky", top: 60, zIndex: 9 }}>
                {[
                  { id: "rules", label: "Rules Evaluation", icon: "✓" },
                  { id: "extraction", label: "Extracted Data", icon: "📄" },
                  { id: "notes", label: "Details & Notes", icon: "💡" },
                ].map(t => (
                  <button key={t.id} onClick={() => setDetailTab(t.id)} style={{
                    flex: 1, padding: "12px 16px", border: "none", cursor: "pointer",
                    fontSize: 13, fontWeight: 600, fontFamily: "'Barlow', sans-serif",
                    background: "transparent", color: detailTab === t.id ? colors.accent : colors.muted,
                    borderBottom: detailTab === t.id ? `3px solid ${colors.accent}` : "3px solid transparent",
                    transition: "all 0.2s ease"
                  }}>
                    <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div style={{ padding: "24px" }}>
                {/* Rules Tab */}
                {detailTab === "rules" && selectedLog.evaluation && (
                  <div style={{ animation: "fadeIn 0.3s ease" }}>
                    <div style={{ marginBottom: 24 }}>
                      <div style={{
                        fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.accent,
                        letterSpacing: "0.08em", marginBottom: 12, fontWeight: 700
                      }}>RULES SUMMARY</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                        <div style={{
                          padding: "12px 14px", background: "rgba(16, 185, 129, 0.1)",
                          borderRadius: 8, border: "1px solid rgba(16, 185, 129, 0.3)"
                        }}>
                          <div style={{ fontSize: 11, color: "#10b981", fontWeight: 700, marginBottom: 4 }}>PASSED</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: "#10b981" }}>
                            {selectedLog.evaluation.results.filter(r => r.passed && r.status !== "SKIPPED").length}
                          </div>
                        </div>
                        <div style={{
                          padding: "12px 14px", background: "rgba(239, 68, 68, 0.1)",
                          borderRadius: 8, border: "1px solid rgba(239, 68, 68, 0.3)"
                        }}>
                          <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginBottom: 4 }}>FAILED</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: "#ef4444" }}>
                            {selectedLog.evaluation.results.filter(r => !r.passed && r.status !== "SKIPPED").length}
                          </div>
                        </div>
                        <div style={{
                          padding: "12px 14px", background: "rgba(107, 114, 128, 0.1)",
                          borderRadius: 8, border: "1px solid rgba(107, 114, 128, 0.3)"
                        }}>
                          <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, marginBottom: 4 }}>SKIPPED</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: "#9ca3af" }}>
                            {selectedLog.evaluation.results.filter(r => r.status === "SKIPPED").length}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{
                      fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.accent,
                      letterSpacing: "0.08em", marginBottom: 12, fontWeight: 700
                    }}>DETAILED RESULTS</div>

                    {/* Passed Rules */}
                    {selectedLog.evaluation.results.filter(r => r.passed && r.status !== "SKIPPED").length > 0 && (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{
                          padding: "10px 14px", background: "rgba(16, 185, 129, 0.08)",
                          borderRadius: 8, marginBottom: 10, fontSize: 12, fontWeight: 700, color: "#10b981",
                          border: "1px solid rgba(16, 185, 129, 0.2)"
                        }}>✓ PASSED RULES ({selectedLog.evaluation.results.filter(r => r.passed && r.status !== "SKIPPED").length})</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {selectedLog.evaluation.results.filter(r => r.passed && r.status !== "SKIPPED").map(r => (
                            <div key={r.id} style={{
                              padding: "12px 14px", background: "rgba(16, 185, 129, 0.05)",
                              borderRadius: 8, border: "1px solid rgba(16, 185, 129, 0.2)",
                              transition: "all 0.2s ease"
                            }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "rgba(16, 185, 129, 0.1)";
                                e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.4)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "rgba(16, 185, 129, 0.05)";
                                e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.2)";
                              }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
                                    ✓ {r.name}
                                  </div>
                                  <div style={{ fontSize: 11, color: colors.muted }}>{r.description}</div>
                                </div>
                                <span style={{
                                  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                                  background: "rgba(16, 185, 129, 0.2)", color: "#10b981"
                                }}>PASS</span>
                              </div>
                              {r.actual !== undefined && (
                                <div style={{ marginTop: 8, fontSize: 11, color: colors.muted }}>
                                  <span style={{ fontFamily: "IBM Plex Mono" }}>Value: {String(r.actual)}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Failed Rules */}
                    {selectedLog.evaluation.results.filter(r => !r.passed && r.status !== "SKIPPED").length > 0 && (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{
                          padding: "10px 14px", background: "rgba(239, 68, 68, 0.08)",
                          borderRadius: 8, marginBottom: 10, fontSize: 12, fontWeight: 700, color: "#ef4444",
                          border: "1px solid rgba(239, 68, 68, 0.2)"
                        }}>✗ FAILED RULES ({selectedLog.evaluation.results.filter(r => !r.passed && r.status !== "SKIPPED").length})</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {selectedLog.evaluation.results.filter(r => !r.passed && r.status !== "SKIPPED").map(r => (
                            <div key={r.id} style={{
                              padding: "12px 14px", background: "rgba(239, 68, 68, 0.05)",
                              borderRadius: 8, border: "1px solid rgba(239, 68, 68, 0.2)",
                              transition: "all 0.2s ease"
                            }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
                                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.4)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "rgba(239, 68, 68, 0.05)";
                                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.2)";
                              }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
                                    ✗ {r.name}
                                  </div>
                                  <div style={{ fontSize: 11, color: colors.muted }}>{r.description}</div>
                                </div>
                                <span style={{
                                  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                                  background: "rgba(239, 68, 68, 0.2)", color: "#ef4444"
                                }}>FAIL</span>
                              </div>
                              {r.actual !== undefined && (
                                <div style={{ marginTop: 8, fontSize: 11, color: colors.muted }}>
                                  <span style={{ fontFamily: "IBM Plex Mono" }}>Value: {String(r.actual)}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Skipped Rules */}
                    {selectedLog.evaluation.results.filter(r => r.status === "SKIPPED").length > 0 && (
                      <div>
                        <div style={{
                          padding: "10px 14px", background: "rgba(107, 114, 128, 0.08)",
                          borderRadius: 8, marginBottom: 10, fontSize: 12, fontWeight: 700, color: "#9ca3af",
                          border: "1px solid rgba(107, 114, 128, 0.2)"
                        }}>○ SKIPPED RULES ({selectedLog.evaluation.results.filter(r => r.status === "SKIPPED").length})</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {selectedLog.evaluation.results.filter(r => r.status === "SKIPPED").map(r => (
                            <div key={r.id} style={{
                              padding: "12px 14px", background: "rgba(107, 114, 128, 0.05)",
                              borderRadius: 8, border: "1px solid rgba(107, 114, 128, 0.2)", opacity: 0.6
                            }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 4 }}>
                                  ○ {r.name}
                                </div>
                                <div style={{ fontSize: 11, color: colors.muted }}>Skipped by configuration</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Extraction Tab */}
                {detailTab === "extraction" && selectedLog.extracted && (
                  <div style={{ animation: "fadeIn 0.3s ease" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
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
                          padding: "12px 14px", background: "rgba(17, 24, 39, 0.8)",
                          borderRadius: 8, border: `1px solid ${colors.border}`,
                          transition: "all 0.2s ease"
                        }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = colors.accent;
                            e.currentTarget.style.transform = "translateY(-2px)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = colors.border;
                            e.currentTarget.style.transform = "translateY(0)";
                          }}>
                          <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", marginBottom: 4, fontWeight: 700 }}>
                            {label.toUpperCase()}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                            {fmt(selectedLog.extracted[key])}
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedLog.extracted.claimantAddress && (
                      <div style={{
                        marginTop: 14, padding: "14px 16px", background: "rgba(17, 24, 39, 0.8)",
                        borderRadius: 8, border: `1px solid ${colors.border}`
                      }}>
                        <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", marginBottom: 6, fontWeight: 700 }}>ADDRESS</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedLog.extracted.claimantAddress}</div>
                      </div>
                    )}

                    {selectedLog.extracted.incidentDescription && (
                      <div style={{
                        marginTop: 14, padding: "14px 16px", background: "rgba(17, 24, 39, 0.8)",
                        borderRadius: 8, border: `1px solid ${colors.border}`
                      }}>
                        <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", marginBottom: 6, fontWeight: 700 }}>INCIDENT DESCRIPTION</div>
                        <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.6 }}>{selectedLog.extracted.incidentDescription}</div>
                      </div>
                    )}

                    {selectedLog.extracted.missingFields?.length > 0 && (
                      <div style={{
                        marginTop: 14, padding: "14px 16px", background: "rgba(28, 17, 7, 0.9)",
                        borderRadius: 8, border: `1px solid rgba(245, 158, 11, 0.4)`
                      }}>
                        <div style={{ fontSize: 10, color: colors.accent, fontFamily: "IBM Plex Mono", marginBottom: 6, fontWeight: 700 }}>⚠ MISSING FIELDS</div>
                        <div style={{ fontSize: 12, color: "#fcd34d" }}>{selectedLog.extracted.missingFields.join(", ")}</div>
                      </div>
                    )}

                    {/* Additional Fields from Document */}
                    {selectedLog.extracted.additionalFields && Object.keys(selectedLog.extracted.additionalFields).length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{
                          fontSize: 11, fontFamily: "IBM Plex Mono",
                          color: colors.accent, letterSpacing: "0.08em", fontWeight: 700,
                          marginBottom: 14, display: "flex", alignItems: "center", gap: 8
                        }}>
                          <span>📋</span> ADDITIONAL DETAILS
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
                          {Object.entries(selectedLog.extracted.additionalFields).map(([key, value]) => (
                            <div key={key} style={{
                              padding: "12px 14px", background: "rgba(17, 24, 39, 0.8)",
                              borderRadius: 8, border: `1px solid ${colors.border}`,
                              transition: "all 0.2s ease",
                              gridColumn: (typeof value === "string" && value.length > 60) || (Array.isArray(value) && value.length > 2) || (typeof value === "object" && !Array.isArray(value) && value !== null) ? "1 / -1" : undefined
                            }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = colors.accent;
                                e.currentTarget.style.transform = "translateY(-2px)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = colors.border;
                                e.currentTarget.style.transform = "translateY(0)";
                              }}>
                              <div style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono", marginBottom: 4, fontWeight: 700 }}>
                                {camelToLabel(key)}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                                {fmt(value)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Notes & Details Tab */}
                {detailTab === "notes" && selectedLog.extracted && selectedLog.evaluation && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "fadeIn 0.3s ease" }}>
                    <div style={{
                      padding: "14px 16px", background: "rgba(17, 24, 39, 0.8)",
                      borderRadius: 8, border: `1px solid ${colors.border}`
                    }}>
                      <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>💡 EXTRACTION NOTES</div>
                      <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.7 }}>
                        {selectedLog.extracted.extractionNotes || "No notable observations."}
                      </div>
                    </div>

                    <div style={{
                      padding: "14px 16px", background: "rgba(17, 24, 39, 0.8)",
                      borderRadius: 8, border: `1px solid ${colors.border}`
                    }}>
                      <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>🛡️ FRAUD RISK</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <div style={{ flex: 1, height: 10, background: colors.dim, borderRadius: 6, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", width: `${selectedLog.extracted.fraudScore || 0}%`,
                            background: (selectedLog.extracted.fraudScore || 0) > 60 ? "linear-gradient(90deg, #ef4444, #f87171)" : (selectedLog.extracted.fraudScore || 0) > 30 ? "linear-gradient(90deg, #f59e0b, #fbbf24)" : "linear-gradient(90deg, #10b981, #4ade80)",
                            borderRadius: 6
                          }} />
                        </div>
                        <span style={{ fontFamily: "IBM Plex Mono", fontSize: 14, fontWeight: 700, minWidth: 50 }}>
                          {selectedLog.extracted.fraudScore ?? 0}/100
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.6, marginBottom: 10 }}>
                        {(selectedLog.extracted.fraudScore || 0) <= 30 ? "✓ Low risk — Safe to proceed" :
                          (selectedLog.extracted.fraudScore || 0) <= 60 ? "⚠ Moderate risk — Review recommended" :
                            "🔴 High risk — Escalate immediately"}
                      </div>
                      {selectedLog.extracted.fraudReasons && selectedLog.extracted.fraudReasons.length > 0 && (
                        <div style={{
                          padding: "10px",
                          background: "rgba(245, 158, 11, 0.08)",
                          border: `1px solid rgba(245, 158, 11, 0.3)`,
                          borderRadius: 6,
                          fontSize: 11,
                          color: "#fcd34d",
                          lineHeight: 1.6
                        }}>
                          <div style={{ fontSize: 9, color: colors.accent, fontWeight: 700, marginBottom: 6, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em" }}>⚠️ CONTRIBUTING FACTORS:</div>
                          {selectedLog.extracted.fraudReasons.map((reason, idx) => (
                            <div key={idx} style={{ marginBottom: idx < selectedLog.extracted.fraudReasons.length - 1 ? 4 : 0, display: "flex", gap: 6 }}>
                              <span style={{ minWidth: 16, color: colors.accent, fontWeight: 700 }}>•</span>
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedLog.evaluation.routing === "ESCALATE" && (
                      <div style={{
                        padding: "14px 16px", background: "rgba(239, 68, 68, 0.05)",
                        borderRadius: 8, border: `1px solid rgba(239, 68, 68, 0.3)`
                      }}>
                        <div style={{ fontSize: 11, color: "#ef4444", fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 700 }}>📨 ESCALATION DETAILS</div>
                        <div style={{ fontSize: 12, color: "#d1d5db", lineHeight: 1.6 }}>
                          <div style={{ marginBottom: 8 }}>
                            <strong>Escalated to:</strong> {selectedLog.evaluation.escalateTo}
                          </div>
                          <div>
                            <strong>Reasons:</strong> {selectedLog.evaluation.escalationReasons?.join(", ") || "See failed rules above"}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedLog.extracted.supportingDocuments && (
                      <div style={{
                        padding: "14px 16px", background: "rgba(17, 24, 39, 0.8)",
                        borderRadius: 8, border: `1px solid ${colors.border}`
                      }}>
                        <div style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>📄 DOCUMENTS</div>
                        <div style={{ fontSize: 13 }}>{fmt(selectedLog.extracted.supportingDocuments)}</div>
                      </div>
                    )}

                    <div style={{
                      padding: "14px 16px", background: "rgba(28, 17, 7, 0.9)",
                      borderRadius: 8, border: `1px solid rgba(245, 158, 11, 0.4)`,
                      boxShadow: "0 4px 12px rgba(245, 158, 11, 0.1)"
                    }}>
                      <div style={{ fontSize: 11, color: colors.accent, fontFamily: "IBM Plex Mono", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>✨ RECOMMENDED ACTIONS</div>
                      <div style={{ fontSize: 12, color: "#fcd34d", lineHeight: 1.8, whiteSpace: "pre-line" }}>
                        {selectedLog.evaluation.routing === "STP"
                          ? "✓ All rules passed. Ready for auto-processing.\n✓ Generate payment authorization.\n✓ Notify claimant of approval."
                          : `• Route to: ${selectedLog.evaluation.escalateTo}\n• Reason(s): ${selectedLog.evaluation.escalationReasons?.join(", ")}\n• Priority: ${(selectedLog.extracted.fraudScore || 0) > 60 || selectedLog.amount > 25000 ? "HIGH" : "MEDIUM"}`
                        }
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }

      {/* Background Save Toast Notification */}
      {saveStatus && (
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          background: "rgba(17, 24, 39, 0.95)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          zIndex: 9999,
          animation: "slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          fontFamily: "var(--font-primary)",
          fontSize: 14,
          color: colors.text
        }}>
          {saveStatus === 'saving' && (
            <>
              <div style={{ width: 16, height: 16, border: `2px solid ${colors.dim}`, borderTopColor: colors.accent, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <span>Saving results...</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <span style={{ color: "#4ade80", fontSize: 16 }}>✓</span>
              <span>Saved successfully</span>
            </>
          )}
          {saveStatus === 'save_error' && (
            <>
              <span style={{ color: "#f87171", fontSize: 16 }}>✗</span>
              <span style={{ color: "#fca5a5" }}>Error saving results</span>
            </>
          )}
        </div>
      )}
    </>
  );
}

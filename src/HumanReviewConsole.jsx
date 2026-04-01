import { useState } from "react";

/**
 * HumanReviewConsole — Three-panel review workbench
 * 
 * Panel 1: Claim Summary & AI Recommendation
 * Panel 2: Field-by-Field Review with Edit/Confirm/Reject
 * Panel 3: Actions Panel (Approve, Override, Escalate, Request Docs, Notes)
 */

const COMMON_DOC_TYPES = [
  { id: "police_report", label: "Police Report" },
  { id: "medical_records", label: "Medical Records" },
  { id: "repair_estimate", label: "Repair Estimate" },
  { id: "proof_of_ownership", label: "Proof of Ownership" },
  { id: "photos_evidence", label: "Photos / Evidence" },
  { id: "receipts_invoices", label: "Receipts / Invoices" },
  { id: "witness_statement", label: "Witness Statement" },
  { id: "death_certificate", label: "Death Certificate" },
];

export default function HumanReviewConsole({ claim, evaluation, extracted, colors, getToken, onReviewComplete }) {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmedFields, setConfirmedFields] = useState({});
  const [editedFields, setEditedFields] = useState({});
  const [showOverride, setShowOverride] = useState(false);
  const [showDocChecklist, setShowDocChecklist] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState({});
  const [customDocRequest, setCustomDocRequest] = useState("");
  const [toast, setToast] = useState(null); // { message, type: 'success' | 'info' | 'warning' }

  const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";
  const claimId = claim?.id;

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const submitReview = async (action, extra = {}) => {
    if (!claimId) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const body = { action, ...extra };
      const res = await fetch(`${apiUrl}/claims/${claimId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[Review] ${action} submitted:`, data);

        // Toast feedback for every action
        const toastMessages = {
          approve: "✓ Claim approved successfully",
          override: "✓ AI override submitted",
          escalate: "⤴ Claim escalated to specialist",
          request_docs: "📄 Docs requested — claim moved to Awaiting Docs queue",
          edit_field: `✏ Field "${extra.field_name}" updated`,
          confirm_field: `✓ Field "${extra.field_name}" confirmed`,
          reject_field: `✗ Field "${extra.field_name}" rejected`,
          add_note: "📝 Note added to audit trail",
        };
        showToast(toastMessages[action] || `✓ ${action} recorded`);

        // Terminal actions that close the review console
        if (["approve", "override", "escalate", "request_docs"].includes(action)) {
          onReviewComplete?.(action);
        }
      }
    } catch (err) {
      console.error("[Review] Error:", err);
      showToast("⚠ Action failed — please try again", "warning");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFieldEdit = (fieldKey, oldVal) => {
    setEditingField(fieldKey);
    setEditValue(String(oldVal || ""));
  };

  const handleFieldSave = async (fieldKey) => {
    const oldVal = extracted[fieldKey];
    setEditedFields(prev => ({ ...prev, [fieldKey]: editValue }));
    setEditingField(null);
    await submitReview("edit_field", {
      field_name: fieldKey,
      old_value: String(oldVal || ""),
      new_value: editValue,
      reviewer_note: `Field corrected: ${fieldKey}`,
    });
  };

  const handleFieldConfirm = async (fieldKey) => {
    setConfirmedFields(prev => ({ ...prev, [fieldKey]: true }));
    await submitReview("confirm_field", {
      field_name: fieldKey,
      reviewer_note: `Field confirmed: ${fieldKey}`,
    });
  };

  const handleRequestDocs = () => {
    const docLabels = COMMON_DOC_TYPES
      .filter(d => selectedDocs[d.id])
      .map(d => d.label);
    if (customDocRequest.trim()) {
      docLabels.push(customDocRequest.trim());
    }

    const docNote = docLabels.length > 0
      ? `Documents requested: ${docLabels.join(", ")}`
      : "Additional documentation requested";

    const fullNote = reviewNote
      ? `${docNote} — Note: ${reviewNote}`
      : docNote;

    submitReview("request_docs", {
      reviewer_note: fullNote,
      requested_docs: docLabels,
    });
  };

  const toggleDoc = (docId) => {
    setSelectedDocs(prev => ({ ...prev, [docId]: !prev[docId] }));
  };

  const fieldConfidence = extracted?.fieldConfidence || {};
  const reviewableFields = [
    { label: "Claim Number", key: "claimNumber" },
    { label: "Policy Number", key: "policyNumber" },
    { label: "Claimant Name", key: "claimantName" },
    { label: "Claim Type", key: "claimType" },
    { label: "Claim Amount", key: "claimAmount" },
    { label: "Policy Status", key: "policyStatus" },
    { label: "Incident Date", key: "incidentDate" },
    { label: "Filing Date", key: "filingDate" },
    { label: "Provider", key: "providerName" },
    { label: "Completeness", key: "completeness" },
  ];

  const isReviewMode = evaluation?.humanReviewRequired || evaluation?.processingMode === "review_required" || evaluation?.processingMode === "escalated";

  const selectedDocCount = Object.values(selectedDocs).filter(Boolean).length + (customDocRequest.trim() ? 1 : 0);

  return (
    <div style={{
      padding: "24px", borderRadius: 16,
      background: "linear-gradient(135deg, rgba(17, 24, 39, 0.95), rgba(28, 17, 7, 0.3))",
      border: `2px solid rgba(245, 158, 11, 0.25)`,
      boxShadow: "0 8px 40px rgba(0, 0, 0, 0.4)",
      animation: "slideIn 0.4s ease",
      position: "relative",
    }}>

      {/* ── Toast Notification ── */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 10000,
          padding: "14px 22px", borderRadius: 12,
          background: toast.type === "warning"
            ? "linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(185, 28, 28, 0.95))"
            : "linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))",
          border: `1px solid ${toast.type === "warning" ? "rgba(239, 68, 68, 0.6)" : "rgba(16, 185, 129, 0.6)"}`,
          color: "#fff",
          fontSize: 13, fontWeight: 700,
          fontFamily: "'Barlow', sans-serif",
          boxShadow: toast.type === "warning"
            ? "0 8px 32px rgba(239, 68, 68, 0.4)"
            : "0 8px 32px rgba(16, 185, 129, 0.4)",
          animation: "slideIn 0.3s ease",
          display: "flex", alignItems: "center", gap: 10,
          backdropFilter: "blur(8px)",
          maxWidth: 400,
        }}>
          <span style={{ fontSize: 16 }}>{toast.type === "warning" ? "⚠" : "✓"}</span>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.accent, letterSpacing: "0.12em", fontWeight: 700 }}>⚑ HUMAN REVIEW CONSOLE</div>
          <span style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 10, fontWeight: 800,
            fontFamily: "IBM Plex Mono",
            background: isReviewMode ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
            color: isReviewMode ? "#f59e0b" : "#10b981",
            border: `1px solid ${isReviewMode ? "rgba(245, 158, 11, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
          }}>{isReviewMode ? "REVIEW REQUIRED" : "AUTO-ELIGIBLE"}</span>
        </div>
        <h3 style={{ fontSize: 20, fontWeight: 800, color: colors.text, margin: 0 }}>
          {evaluation?.routing === "STP" ? "✓ AI Recommends: Approve" : "⚠ AI Recommends: Escalate"}
        </h3>
        <p style={{ fontSize: 13, color: colors.muted, margin: "4px 0 0", lineHeight: 1.5 }}>
          Review each field below. Confirm, edit, or reject values before making your final decision.
        </p>
      </div>

      {/* Three-Panel Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        
        {/* Panel 1 + 2: Field-by-Field Review */}
        <div style={{
          gridColumn: "1 / -1",
          padding: "18px", borderRadius: 12,
          background: "rgba(3, 7, 18, 0.7)",
          border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.accent, fontWeight: 700, marginBottom: 14, letterSpacing: "0.08em" }}>📋 FIELD-BY-FIELD REVIEW</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reviewableFields.map(({ label, key }) => {
              const fc = fieldConfidence[key];
              const conf = fc?.confidence;
              const isLow = conf !== undefined && conf < 80;
              const isConfirmed = confirmedFields[key];
              const isEdited = editedFields[key] !== undefined;
              const display = isEdited ? editedFields[key] : extracted?.[key];

              return (
                <div key={key} style={{
                  display: "grid", gridTemplateColumns: "140px 1fr 60px auto",
                  gap: 10, padding: "10px 14px", borderRadius: 8, alignItems: "center",
                  background: isLow ? "rgba(245, 158, 11, 0.04)" : isConfirmed ? "rgba(16, 185, 129, 0.04)" : "transparent",
                  border: `1px solid ${isLow ? "rgba(245, 158, 11, 0.2)" : isConfirmed ? "rgba(16, 185, 129, 0.15)" : colors.border}`,
                  transition: "all 0.2s ease",
                }}>
                  <div style={{ fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.muted, fontWeight: 700 }}>{label.toUpperCase()}</div>
                  
                  {editingField === key ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        style={{
                          flex: 1, padding: "6px 10px", borderRadius: 6,
                          border: `1px solid ${colors.accent}`, background: "rgba(3, 7, 18, 0.9)",
                          color: colors.text, fontSize: 13, fontFamily: "'Barlow', sans-serif",
                          outline: "none",
                        }}
                        onKeyDown={(e) => e.key === "Enter" && handleFieldSave(key)}
                        autoFocus
                      />
                      <button onClick={() => handleFieldSave(key)} style={{
                        padding: "4px 10px", borderRadius: 6, border: "none",
                        background: "#10b981", color: "#000", fontSize: 11, fontWeight: 700, cursor: "pointer",
                      }}>Save</button>
                      <button onClick={() => setEditingField(null)} style={{
                        padding: "4px 10px", borderRadius: 6, border: `1px solid ${colors.border}`,
                        background: "transparent", color: colors.muted, fontSize: 11, cursor: "pointer",
                      }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: isEdited ? "#f59e0b" : colors.text }}>
                      {display !== null && display !== undefined ? String(display) : "—"}
                      {isEdited && <span style={{ fontSize: 10, color: "#f59e0b", marginLeft: 6 }}>(edited)</span>}
                    </div>
                  )}

                  {/* Confidence */}
                  <div style={{ textAlign: "center" }}>
                    {conf !== undefined && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, fontFamily: "IBM Plex Mono",
                        color: conf >= 80 ? "#10b981" : conf >= 60 ? "#f59e0b" : "#ef4444",
                        padding: "2px 6px", borderRadius: 4,
                        background: conf >= 80 ? "rgba(16, 185, 129, 0.15)" : conf >= 60 ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)",
                      }}>{conf}%</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {isConfirmed ? (
                      <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700 }}>✓ Confirmed</span>
                    ) : (
                      <>
                        <button onClick={() => handleFieldConfirm(key)} disabled={submitting} style={{
                          padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(16, 185, 129, 0.3)",
                          background: "rgba(16, 185, 129, 0.1)", color: "#10b981", fontSize: 10, fontWeight: 700, cursor: "pointer",
                        }}>✓</button>
                        <button onClick={() => handleFieldEdit(key, display)} disabled={submitting} style={{
                          padding: "4px 8px", borderRadius: 4, border: `1px solid ${colors.border}`,
                          background: "transparent", color: colors.muted, fontSize: 10, fontWeight: 700, cursor: "pointer",
                        }}>✏</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Panel 3: Actions */}
      <div style={{
        padding: "18px", borderRadius: 12,
        background: "rgba(3, 7, 18, 0.7)",
        border: `1px solid ${colors.border}`,
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.accent, fontWeight: 700, marginBottom: 14, letterSpacing: "0.08em" }}>⚡ REVIEW ACTIONS</div>

        {/* Reviewer Note */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: colors.muted, marginBottom: 6, fontWeight: 600 }}>Reviewer Note (optional)</div>
          <textarea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            placeholder="Add notes about your review decision..."
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 8,
              border: `1px solid ${colors.border}`, background: "rgba(3, 7, 18, 0.9)",
              color: colors.text, fontSize: 13, fontFamily: "'Barlow', sans-serif",
              outline: "none", resize: "vertical", minHeight: 60,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Override Reason (conditional) */}
        {showOverride && (
          <div style={{ marginBottom: 16, animation: "slideIn 0.3s ease" }}>
            <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 6, fontWeight: 600 }}>Override Reason (required)</div>
            <input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Explain why you're overriding the AI recommendation..."
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 8,
                border: "1px solid rgba(239, 68, 68, 0.3)", background: "rgba(239, 68, 68, 0.05)",
                color: colors.text, fontSize: 13, fontFamily: "'Barlow', sans-serif",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* ── Document Checklist (Fix 2) ── */}
        {showDocChecklist && (
          <div style={{
            marginBottom: 16, padding: "16px 18px", borderRadius: 12,
            background: "rgba(167, 139, 250, 0.05)",
            border: "1px solid rgba(167, 139, 250, 0.25)",
            animation: "slideIn 0.3s ease",
          }}>
            <div style={{
              fontSize: 10, fontFamily: "IBM Plex Mono", color: "#a78bfa",
              fontWeight: 700, marginBottom: 12, letterSpacing: "0.08em",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>📋 SELECT REQUIRED DOCUMENTS</span>
              {selectedDocCount > 0 && (
                <span style={{
                  padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                  background: "rgba(167, 139, 250, 0.2)", color: "#a78bfa",
                  border: "1px solid rgba(167, 139, 250, 0.3)",
                }}>{selectedDocCount} selected</span>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
              {COMMON_DOC_TYPES.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => toggleDoc(doc.id)}
                  style={{
                    padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    fontFamily: "'Barlow', sans-serif", cursor: "pointer",
                    textAlign: "left",
                    background: selectedDocs[doc.id] ? "rgba(167, 139, 250, 0.15)" : "rgba(17, 24, 39, 0.6)",
                    border: `1.5px solid ${selectedDocs[doc.id] ? "rgba(167, 139, 250, 0.5)" : colors.border}`,
                    color: selectedDocs[doc.id] ? "#c4b5fd" : colors.muted,
                    transition: "all 0.2s ease",
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 4,
                    border: `2px solid ${selectedDocs[doc.id] ? "#a78bfa" : colors.border}`,
                    background: selectedDocs[doc.id] ? "#a78bfa" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, color: "#000", fontWeight: 900, flexShrink: 0,
                    transition: "all 0.2s ease",
                  }}>
                    {selectedDocs[doc.id] ? "✓" : ""}
                  </span>
                  {doc.label}
                </button>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.muted, marginBottom: 6, fontWeight: 600 }}>Other (specify)</div>
              <input
                value={customDocRequest}
                onChange={(e) => setCustomDocRequest(e.target.value)}
                placeholder="e.g., Signed affidavit, Bank statements..."
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: `1px solid ${colors.border}`, background: "rgba(3, 7, 18, 0.9)",
                  color: colors.text, fontSize: 12, fontFamily: "'Barlow', sans-serif",
                  outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* Approve */}
          <button
            onClick={() => submitReview("approve", { reviewer_note: reviewNote })}
            disabled={submitting}
            style={{
              padding: "10px 20px", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg, #10b981, #059669)",
              color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
              transition: "all 0.2s ease", opacity: submitting ? 0.5 : 1,
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
            }}
          >✓ Approve Claim</button>

          {/* Request Docs — now toggles the checklist */}
          <button
            onClick={() => {
              if (showDocChecklist) {
                // Submit the docs request
                handleRequestDocs();
              } else {
                setShowDocChecklist(true);
              }
            }}
            disabled={submitting}
            style={{
              padding: "10px 20px", borderRadius: 10,
              border: `1.5px solid ${showDocChecklist ? "rgba(167, 139, 250, 0.6)" : "rgba(167, 139, 250, 0.35)"}`,
              background: showDocChecklist ? "rgba(167, 139, 250, 0.12)" : "transparent",
              color: "#a78bfa", fontSize: 13, fontWeight: 700,
              cursor: "pointer", transition: "all 0.2s ease", opacity: submitting ? 0.5 : 1,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            📄 {showDocChecklist
              ? `Send Request${selectedDocCount > 0 ? ` (${selectedDocCount})` : ""}`
              : "Request Docs"
            }
          </button>

          {/* Cancel doc checklist */}
          {showDocChecklist && (
            <button
              onClick={() => { setShowDocChecklist(false); setSelectedDocs({}); setCustomDocRequest(""); }}
              style={{
                padding: "10px 14px", borderRadius: 10, border: `1px solid ${colors.border}`,
                background: "transparent", color: colors.muted, fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all 0.2s ease",
              }}
            >Cancel</button>
          )}

          {/* Escalate */}
          <button
            onClick={() => submitReview("escalate", { reviewer_note: reviewNote, escalate_to: "Senior Claims Manager" })}
            disabled={submitting}
            style={{
              padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(239, 68, 68, 0.4)",
              background: "rgba(239, 68, 68, 0.08)", color: "#ef4444", fontSize: 13, fontWeight: 700,
              cursor: "pointer", transition: "all 0.2s ease", opacity: submitting ? 0.5 : 1,
            }}
          >⤴ Escalate to Official</button>

          {/* Override */}
          {!showOverride ? (
            <button
              onClick={() => setShowOverride(true)}
              disabled={submitting}
              style={{
                padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(239, 68, 68, 0.3)",
                background: "transparent", color: "#ef4444", fontSize: 13, fontWeight: 700,
                cursor: "pointer", transition: "all 0.2s ease", opacity: submitting ? 0.5 : 1,
              }}
            >↺ Override AI</button>
          ) : (
            <button
              onClick={() => {
                if (!overrideReason.trim()) return alert("Override reason is required.");
                submitReview("override", { override_reason: overrideReason, reviewer_note: reviewNote });
              }}
              disabled={submitting || !overrideReason.trim()}
              style={{
                padding: "10px 20px", borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, #ef4444, #dc2626)",
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                transition: "all 0.2s ease",
                opacity: (submitting || !overrideReason.trim()) ? 0.4 : 1,
                boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)",
              }}
            >⚠ Confirm Override</button>
          )}

          {/* Add Note Only */}
          <button
            onClick={() => submitReview("add_note", { reviewer_note: reviewNote })}
            disabled={submitting || !reviewNote.trim()}
            style={{
              padding: "10px 20px", borderRadius: 10, border: `1px solid ${colors.border}`,
              background: "transparent", color: colors.muted, fontSize: 13, fontWeight: 700,
              cursor: "pointer", transition: "all 0.2s ease",
              opacity: (submitting || !reviewNote.trim()) ? 0.4 : 1,
            }}
          >📝 Add Note</button>
        </div>
      </div>
    </div>
  );
}

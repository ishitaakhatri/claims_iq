import { useState } from "react";

/**
 * HumanReviewConsole — Three-panel review workbench
 * 
 * Panel 1: Claim Summary & AI Recommendation
 * Panel 2: Field-by-Field Review with Edit/Confirm/Reject
 * Panel 3: Actions Panel (Approve, Override, Escalate, Request Docs, Notes)
 */
export default function HumanReviewConsole({ claim, evaluation, extracted, colors, getToken, onReviewComplete }) {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmedFields, setConfirmedFields] = useState({});
  const [editedFields, setEditedFields] = useState({});
  const [showOverride, setShowOverride] = useState(false);

  const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";
  const claimId = claim?.id;

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
        if (["approve", "override", "escalate"].includes(action)) {
          onReviewComplete?.(action);
        }
      }
    } catch (err) {
      console.error("[Review] Error:", err);
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

  return (
    <div style={{
      padding: "24px", borderRadius: 16,
      background: "linear-gradient(135deg, rgba(17, 24, 39, 0.95), rgba(28, 17, 7, 0.3))",
      border: `2px solid rgba(245, 158, 11, 0.25)`,
      boxShadow: "0 8px 40px rgba(0, 0, 0, 0.4)",
      animation: "slideIn 0.4s ease",
    }}>
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

          {/* Request Docs */}
          <button
            onClick={() => submitReview("request_docs", { reviewer_note: reviewNote || "Additional documentation requested" })}
            disabled={submitting}
            style={{
              padding: "10px 20px", borderRadius: 10, border: `1px solid ${colors.accent}`,
              background: "transparent", color: colors.accent, fontSize: 13, fontWeight: 700,
              cursor: "pointer", transition: "all 0.2s ease", opacity: submitting ? 0.5 : 1,
            }}
          >📄 Request Docs</button>

          {/* Escalate */}
          <button
            onClick={() => submitReview("escalate", { reviewer_note: reviewNote, escalate_to: "Senior Claims Manager" })}
            disabled={submitting}
            style={{
              padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(245, 158, 11, 0.4)",
              background: "rgba(245, 158, 11, 0.08)", color: "#f59e0b", fontSize: 13, fontWeight: 700,
              cursor: "pointer", transition: "all 0.2s ease", opacity: submitting ? 0.5 : 1,
            }}
          >⤴ Escalate</button>

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

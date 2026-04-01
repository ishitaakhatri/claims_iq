import { useState, useEffect } from "react";
import HumanReviewConsole from "./HumanReviewConsole.jsx";

const API_URL = import.meta.env.PROD ? "" : "http://localhost:8000";

const STATUS_META = {
  review_required:      { label: "Needs Review",    color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  icon: "⚑" },
  under_review:         { label: "Under Review",    color: "#93c5fd", bg: "rgba(147,197,253,0.1)", border: "rgba(147,197,253,0.3)", icon: "🔍" },
  escalated:            { label: "Escalated",       color: "#ef4444", bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)",   icon: "⤴" },
  pending_documentation:{ label: "Awaiting Docs",   color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.3)", icon: "📄" },
};

const RISK_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#10b981" };

function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.review_required;
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700,
      fontFamily: "IBM Plex Mono", letterSpacing: "0.06em",
      background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      display: "inline-flex", alignItems: "center", gap: 5,
    }}>{m.icon} {m.label.toUpperCase()}</span>
  );
}

export default function ReviewQueue({ colors, getToken }) {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [reviewDone, setReviewDone] = useState({}); // claimId -> action
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");
  const [markingDocsReceived, setMarkingDocsReceived] = useState(null); // claimId being marked

  const load = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/review-queue`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.status === "success") setQueue(data.queue);
    } catch (e) {
      console.error("[ReviewQueue] load error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = queue.filter(c => {
    if (filterStatus !== "all" && c.review_status !== filterStatus) return false;
    if (filterRisk !== "all" && c.riskTier !== filterRisk) return false;
    return true;
  });

  const handleReviewComplete = (claimId, action) => {
    setReviewDone(prev => ({ ...prev, [claimId]: action }));

    if (action === "request_docs") {
      // Update status in-place to "Awaiting Docs" instead of removing
      setQueue(prev => prev.map(c =>
        c.id === claimId ? { ...c, review_status: "pending_documentation" } : c
      ));
      // Also update the selected claim if it's the one being viewed
      setSelected(prev =>
        prev?.id === claimId ? { ...prev, review_status: "pending_documentation" } : prev
      );
      // Clear the reviewDone after a brief flash so the claim is still usable
      setTimeout(() => {
        setReviewDone(prev => {
          const next = { ...prev };
          delete next[claimId];
          return next;
        });
      }, 2000);
    } else {
      // Terminal actions: remove from queue after a short delay
      setTimeout(() => {
        setQueue(prev => prev.filter(c => c.id !== claimId));
        if (selected?.id === claimId) setSelected(null);
      }, 1200);
    }
  };

  const handleMarkDocsReceived = async (claimId) => {
    setMarkingDocsReceived(claimId);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/claims/${claimId}/review-status?status=review_required`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        // Update in-place
        setQueue(prev => prev.map(c =>
          c.id === claimId ? { ...c, review_status: "review_required" } : c
        ));
        setSelected(prev =>
          prev?.id === claimId ? { ...prev, review_status: "review_required" } : prev
        );
        console.log(`[ReviewQueue] Claim ${claimId} → review_required (docs received)`);
      }
    } catch (e) {
      console.error("[ReviewQueue] mark docs received error", e);
    } finally {
      setMarkingDocsReceived(null);
    }
  };

  const btnBase = {
    border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700,
    cursor: "pointer", fontFamily: "'Barlow', sans-serif", transition: "all 0.2s",
  };

  // Count by status for filter badges
  const statusCounts = {};
  queue.forEach(c => {
    const s = c.review_status || "review_required";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left: Queue List ── */}
      <div style={{
        width: selected ? 340 : "100%", minWidth: 300, flexShrink: 0,
        borderRight: selected ? `1px solid ${colors.border}` : "none",
        overflowY: "auto", padding: "24px 20px",
        transition: "width 0.3s ease",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.accent, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4 }}>
              ⚑ REVIEW QUEUE
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>
              Pending Claims
              <span style={{
                marginLeft: 10, fontSize: 12, fontFamily: "IBM Plex Mono",
                background: "rgba(245,158,11,0.15)", color: "#f59e0b",
                border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6,
                padding: "2px 8px", fontWeight: 700,
              }}>{filtered.length}</span>
            </div>
          </div>
          <button onClick={load} style={{
            ...btnBase, padding: "7px 14px",
            background: "rgba(245,158,11,0.08)", border: `1px solid ${colors.accent}44`,
            color: colors.accent, fontSize: 12,
          }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(245,158,11,0.18)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(245,158,11,0.08)"}
          >↻ Refresh</button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          {["all", "review_required", "under_review", "escalated", "pending_documentation"].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} style={{
              ...btnBase, padding: "4px 12px", fontSize: 10,
              background: filterStatus === s ? "rgba(245,158,11,0.2)" : "transparent",
              border: `1px solid ${filterStatus === s ? colors.accent : colors.border}`,
              color: filterStatus === s ? colors.accent : colors.muted,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              {s === "all" ? "ALL" : STATUS_META[s]?.label.toUpperCase()}
              {s !== "all" && statusCounts[s] ? (
                <span style={{
                  fontSize: 9, fontFamily: "IBM Plex Mono", fontWeight: 800,
                  padding: "1px 5px", borderRadius: 4,
                  background: `${STATUS_META[s]?.color || colors.accent}22`,
                  color: STATUS_META[s]?.color || colors.accent,
                }}>{statusCounts[s]}</span>
              ) : null}
            </button>
          ))}
          <div style={{ width: 1, background: colors.border, margin: "0 2px" }} />
          {["all", "high", "medium", "low"].map(r => (
            <button key={r} onClick={() => setFilterRisk(r)} style={{
              ...btnBase, padding: "4px 12px", fontSize: 10,
              background: filterRisk === r ? `${RISK_COLOR[r] || colors.accent}22` : "transparent",
              border: `1px solid ${filterRisk === r ? (RISK_COLOR[r] || colors.accent) : colors.border}`,
              color: filterRisk === r ? (RISK_COLOR[r] || colors.accent) : colors.muted,
            }}>
              {r === "all" ? "ALL RISK" : r.toUpperCase()}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: colors.muted, fontFamily: "IBM Plex Mono", fontSize: 12 }}>
            Loading queue...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "48px 24px",
            background: "rgba(16,185,129,0.05)", borderRadius: 16,
            border: "1px solid rgba(16,185,129,0.15)",
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981", marginBottom: 6 }}>Queue Clear</div>
            <div style={{ fontSize: 12, color: colors.muted }}>No claims pending review</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map(claim => {
              const isSelected = selected?.id === claim.id;
              const isDone = !!reviewDone[claim.id];
              const isEscalated = claim.review_status === "escalated";
              const isPendingDocs = claim.review_status === "pending_documentation";

              // Distinct left-border accents for escalated vs pending_docs
              const leftBorderColor = isEscalated
                ? "rgba(239, 68, 68, 0.6)"
                : isPendingDocs
                  ? "rgba(167, 139, 250, 0.6)"
                  : "transparent";

              return (
                <div
                  key={claim.id}
                  onClick={() => setSelected(isSelected ? null : claim)}
                  style={{
                    padding: "14px 16px", borderRadius: 12, cursor: "pointer",
                    background: isSelected
                      ? "rgba(245,158,11,0.08)"
                      : isPendingDocs
                        ? "rgba(167,139,250,0.04)"
                        : isEscalated
                          ? "rgba(239,68,68,0.04)"
                          : "rgba(17,24,39,0.7)",
                    border: `1.5px solid ${isSelected ? colors.accent : colors.border}`,
                    borderLeft: `4px solid ${isSelected ? colors.accent : leftBorderColor}`,
                    transition: "all 0.2s", opacity: isDone ? 0.4 : 1,
                  }}
                  onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderColor = `${colors.accent}66`; e.currentTarget.style.background = "rgba(245,158,11,0.04)"; } }}
                  onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.background = isPendingDocs ? "rgba(167,139,250,0.04)" : isEscalated ? "rgba(239,68,68,0.04)" : "rgba(17,24,39,0.7)"; } }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 2 }}>
                        {claim.claimant || "Unknown Claimant"}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted }}>
                        {claim.claim} · {claim.claimType || "—"}
                      </div>
                    </div>
                    <StatusPill status={claim.review_status} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: colors.accent }}>
                      {claim.amount != null ? `$${Number(claim.amount).toLocaleString()}` : "—"}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: RISK_COLOR[claim.riskTier] || colors.muted, fontWeight: 700 }}>
                        {claim.riskTier?.toUpperCase()} RISK
                      </span>
                      <span style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono" }}>
                        {new Date(claim.time).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Escalation detail — show who it was escalated to */}
                  {isEscalated && claim.escalateTo && (
                    <div style={{
                      marginTop: 8, padding: "6px 10px", borderRadius: 6,
                      background: "rgba(239, 68, 68, 0.06)",
                      border: "1px solid rgba(239, 68, 68, 0.15)",
                      fontSize: 10, color: "#fca5a5", fontFamily: "IBM Plex Mono",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{ fontSize: 12 }}>⤴</span>
                      Escalated to: <strong style={{ color: "#f87171" }}>{claim.escalateTo}</strong>
                    </div>
                  )}

                  {/* Pending docs detail */}
                  {isPendingDocs && (
                    <div style={{
                      marginTop: 8, padding: "6px 10px", borderRadius: 6,
                      background: "rgba(167, 139, 250, 0.06)",
                      border: "1px solid rgba(167, 139, 250, 0.15)",
                      fontSize: 10, color: "#c4b5fd", fontFamily: "IBM Plex Mono",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{ fontSize: 12 }}>📄</span>
                      Waiting for additional documentation
                    </div>
                  )}

                  {claim.reviewTriggers?.length > 0 && !isEscalated && !isPendingDocs && (
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {claim.reviewTriggers.slice(0, 2).map((t, i) => (
                        <span key={i} style={{
                          fontSize: 9, padding: "2px 7px", borderRadius: 4, fontFamily: "IBM Plex Mono",
                          background: "rgba(245,158,11,0.08)", color: "#fcd34d",
                          border: "1px solid rgba(245,158,11,0.15)",
                        }}>{t}</span>
                      ))}
                      {claim.reviewTriggers.length > 2 && (
                        <span style={{ fontSize: 9, color: colors.muted, fontFamily: "IBM Plex Mono", padding: "2px 4px" }}>
                          +{claim.reviewTriggers.length - 2} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Right: Detail Panel ── */}
      {selected && (
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {/* Detail Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${colors.border}`,
          }}>
            <div>
              <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.1em", marginBottom: 6 }}>
                CLAIM DETAIL
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: colors.text, marginBottom: 4 }}>
                {selected.claimant}
              </div>
              <div style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.muted }}>
                {selected.claim} · {selected.claimType} · {selected.amount != null ? `$${Number(selected.amount).toLocaleString()}` : "—"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {/* View Document */}
              {selected.blob_uri ? (
                <a
                  href={selected.blob_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 16px", borderRadius: 9, fontSize: 12, fontWeight: 700,
                    fontFamily: "'Barlow', sans-serif", textDecoration: "none",
                    background: "rgba(147,197,253,0.08)", border: "1px solid rgba(147,197,253,0.3)",
                    color: "#93c5fd", transition: "all 0.2s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(147,197,253,0.18)"; e.currentTarget.style.borderColor = "#93c5fd"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(147,197,253,0.08)"; e.currentTarget.style.borderColor = "rgba(147,197,253,0.3)"; }}
                >
                  📄 View Document
                </a>
              ) : (
                <span style={{ fontSize: 11, color: colors.muted, fontFamily: "IBM Plex Mono" }}>No document</span>
              )}
              <button onClick={() => setSelected(null)} style={{
                ...btnBase, padding: "8px 14px", fontSize: 18, lineHeight: 1,
                background: "transparent", border: `1px solid ${colors.border}`,
                color: colors.muted,
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#6b7280"}
                onMouseLeave={e => e.currentTarget.style.borderColor = colors.border}
              >×</button>
            </div>
          </div>

          {/* Status + Risk row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(17,24,39,0.8)", border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: 9, fontFamily: "IBM Plex Mono", color: colors.muted, fontWeight: 700, marginBottom: 5, letterSpacing: "0.08em" }}>STATUS</div>
              <StatusPill status={selected.review_status} />
            </div>
            <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(17,24,39,0.8)", border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: 9, fontFamily: "IBM Plex Mono", color: colors.muted, fontWeight: 700, marginBottom: 5, letterSpacing: "0.08em" }}>RISK TIER</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: RISK_COLOR[selected.riskTier] || colors.muted }}>
                {selected.riskTier === "high" ? "🔴 HIGH" : selected.riskTier === "medium" ? "🟡 MEDIUM" : "🟢 LOW"}
              </div>
            </div>
            <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(17,24,39,0.8)", border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: 9, fontFamily: "IBM Plex Mono", color: colors.muted, fontWeight: 700, marginBottom: 5, letterSpacing: "0.08em" }}>ROUTING</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: selected.routing === "STP" ? "#10b981" : "#ef4444" }}>
                {selected.routing === "STP" ? "✓ STP" : "⚠ ESCALATE"}
              </div>
            </div>
            <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(17,24,39,0.8)", border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: 9, fontFamily: "IBM Plex Mono", color: colors.muted, fontWeight: 700, marginBottom: 5, letterSpacing: "0.08em" }}>CONFIDENCE</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>{selected.confidence}%</div>
            </div>
            {selected.escalateTo && (
              <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(239,68,68,0.06)", border: `1px solid rgba(239,68,68,0.25)` }}>
                <div style={{ fontSize: 9, fontFamily: "IBM Plex Mono", color: "#ef4444", fontWeight: 700, marginBottom: 5, letterSpacing: "0.08em" }}>ESCALATED TO</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5" }}>{selected.escalateTo}</div>
              </div>
            )}
          </div>

          {/* ── Mark Docs Received (Fix 4) ── */}
          {selected.review_status === "pending_documentation" && (
            <div style={{
              padding: "16px 20px", borderRadius: 12, marginBottom: 20,
              background: "linear-gradient(135deg, rgba(167, 139, 250, 0.06), rgba(99, 102, 241, 0.06))",
              border: "1.5px solid rgba(167, 139, 250, 0.3)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              animation: "slideIn 0.3s ease",
            }}>
              <div>
                <div style={{ fontSize: 11, fontFamily: "IBM Plex Mono", color: "#a78bfa", fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>
                  📄 AWAITING DOCUMENTATION
                </div>
                <div style={{ fontSize: 13, color: "#c4b5fd", lineHeight: 1.5 }}>
                  This claim is on hold until the requested documents are received.
                </div>
              </div>
              <button
                onClick={() => handleMarkDocsReceived(selected.id)}
                disabled={markingDocsReceived === selected.id}
                style={{
                  padding: "10px 20px", borderRadius: 10, border: "none",
                  background: markingDocsReceived === selected.id
                    ? "rgba(167, 139, 250, 0.3)"
                    : "linear-gradient(135deg, #a78bfa, #8b5cf6)",
                  color: "#fff", fontSize: 13, fontWeight: 700,
                  cursor: markingDocsReceived === selected.id ? "wait" : "pointer",
                  fontFamily: "'Barlow', sans-serif",
                  transition: "all 0.2s ease",
                  boxShadow: "0 4px 16px rgba(167, 139, 250, 0.3)",
                  whiteSpace: "nowrap",
                  display: "flex", alignItems: "center", gap: 8,
                }}
                onMouseEnter={e => {
                  if (markingDocsReceived !== selected.id) {
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 6px 20px rgba(167, 139, 250, 0.4)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 16px rgba(167, 139, 250, 0.3)";
                }}
              >
                {markingDocsReceived === selected.id ? (
                  <>
                    <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}></span>
                    Processing...
                  </>
                ) : (
                  "📬 Mark Docs Received"
                )}
              </button>
            </div>
          )}

          {/* Escalated Detail Banner */}
          {selected.review_status === "escalated" && (
            <div style={{
              padding: "16px 20px", borderRadius: 12, marginBottom: 20,
              background: "linear-gradient(135deg, rgba(239, 68, 68, 0.06), rgba(185, 28, 28, 0.06))",
              border: "1.5px solid rgba(239, 68, 68, 0.3)",
              animation: "slideIn 0.3s ease",
            }}>
              <div style={{
                fontSize: 11, fontFamily: "IBM Plex Mono", color: "#ef4444",
                fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em",
              }}>
                ⤴ ESCALATED TO HIGHER OFFICIAL
              </div>
              <div style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.5 }}>
                This claim has been escalated {selected.escalateTo ? `to ${selected.escalateTo}` : "for senior review"}.
                It requires attention from a higher authority before it can be resolved.
              </div>
            </div>
          )}

          {/* Review Triggers */}
          {selected.reviewTriggers?.length > 0 && (
            <div style={{
              padding: "14px 18px", borderRadius: 12, marginBottom: 20,
              background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)",
            }}>
              <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.accent, fontWeight: 700, marginBottom: 10, letterSpacing: "0.08em" }}>⚠ REVIEW TRIGGERS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selected.reviewTriggers.map((t, i) => (
                  <span key={i} style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: "rgba(245,158,11,0.1)", color: "#fcd34d",
                    border: "1px solid rgba(245,158,11,0.2)", fontFamily: "IBM Plex Mono",
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Review Console or Done Banner */}
          {reviewDone[selected.id] ? (
            <div style={{
              padding: "20px 24px", borderRadius: 14, textAlign: "center",
              background: reviewDone[selected.id] === "request_docs"
                ? "rgba(167,139,250,0.08)"
                : "rgba(16,185,129,0.08)",
              border: `1px solid ${reviewDone[selected.id] === "request_docs"
                ? "rgba(167,139,250,0.25)"
                : "rgba(16,185,129,0.25)"}`,
              animation: "slideIn 0.3s ease",
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>
                {reviewDone[selected.id] === "request_docs" ? "📄" : "✓"}
              </div>
              <div style={{
                fontSize: 15, fontWeight: 700, marginBottom: 4,
                color: reviewDone[selected.id] === "request_docs" ? "#a78bfa" : "#10b981",
              }}>
                {reviewDone[selected.id] === "request_docs"
                  ? "Documents Requested"
                  : "Review Submitted"}
              </div>
              <div style={{ fontSize: 12, color: colors.muted }}>
                Action: <span style={{
                  color: reviewDone[selected.id] === "request_docs" ? "#a78bfa" : "#10b981",
                  fontWeight: 700,
                }}>{reviewDone[selected.id]}</span>
              </div>
            </div>
          ) : (
            <HumanReviewConsole
              claim={{ id: selected.id }}
              evaluation={selected.evaluation}
              extracted={selected.extracted}
              colors={colors}
              getToken={getToken}
              onReviewComplete={(action) => handleReviewComplete(selected.id, action)}
            />
          )}
        </div>
      )}
    </div>
  );
}

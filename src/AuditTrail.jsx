import { useState, useEffect } from "react";

/**
 * AuditTrail — Chronological timeline component
 * Fetches and displays the full audit trail for a claim.
 */
export default function AuditTrail({ claimId, colors, getToken }) {
  const [trail, setTrail] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (claimId) loadTrail();
  }, [claimId]);

  const loadTrail = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";
      const res = await fetch(`${apiUrl}/claims/${claimId}/audit-trail`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTrail(data.audit_trail || []);
      } else {
        setError("Failed to load audit trail");
      }
    } catch (err) {
      console.error("[AuditTrail] Error:", err);
      setError("Error loading audit trail");
    } finally {
      setLoading(false);
    }
  };

  const actionIcons = {
    document_scanned: "📄",
    fields_extracted: "🔍",
    recommendation_generated: "💡",
    approve: "✅",
    edit_field: "✏️",
    reject_field: "❌",
    confirm_field: "✓",
    request_docs: "📋",
    escalate: "⤴️",
    override: "⚠️",
    add_note: "📝",
    status_changed: "🔄",
  };

  const actorColors = {
    ai_engine: "#8b5cf6",
    reviewer: "#f59e0b",
    system: "#6b7280",
  };

  if (!claimId) {
    return (
      <div style={{ padding: 24, fontSize: 14, color: colors.muted, textAlign: "center" }}>
        Select a claim to view its audit trail.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <div style={{
          width: 28, height: 28, border: `3px solid ${colors.dim}`,
          borderTopColor: colors.accent, borderRadius: "50%",
          animation: "spin 0.9s linear infinite"
        }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#ef4444", textAlign: "center" }}>
        {error}
        <button onClick={loadTrail} style={{
          marginLeft: 8, padding: "4px 10px", borderRadius: 6, border: `1px solid ${colors.border}`,
          background: "transparent", color: colors.muted, fontSize: 12, cursor: "pointer",
        }}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{
      padding: "20px", borderRadius: 14,
      background: "rgba(17, 24, 39, 0.9)",
      border: `1px solid ${colors.border}`,
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
      animation: "fadeIn 0.3s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.accent, letterSpacing: "0.1em", fontWeight: 700 }}>📜 AUDIT TRAIL</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: colors.muted }}>{trail.length} entries</span>
          <button onClick={loadTrail} style={{
            padding: "4px 8px", borderRadius: 4, border: `1px solid ${colors.border}`,
            background: "transparent", color: colors.muted, fontSize: 10, cursor: "pointer",
          }}>↻</button>
        </div>
      </div>

      {trail.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: colors.muted }}>
          No audit trail entries yet.
        </div>
      ) : (
        <div style={{ position: "relative", paddingLeft: 28 }}>
          {/* Vertical line */}
          <div style={{
            position: "absolute", left: 10, top: 6, bottom: 6,
            width: 2, background: `linear-gradient(180deg, ${colors.accent}, ${colors.border})`,
            borderRadius: 2,
          }} />

          {trail.map((entry, i) => {
            const icon = actionIcons[entry.action] || "•";
            const actorColor = actorColors[entry.actor_type] || colors.muted;
            const isLast = i === trail.length - 1;

            return (
              <div key={entry.id} style={{
                display: "flex", gap: 12, marginBottom: isLast ? 0 : 16,
                position: "relative",
                animation: "slideIn 0.3s ease",
                animationDelay: `${i * 0.05}s`,
              }}>
                {/* Timeline Dot */}
                <div style={{
                  position: "absolute", left: -22, top: 4,
                  width: 18, height: 18, borderRadius: "50%",
                  background: "rgba(3, 7, 18, 0.9)",
                  border: `2px solid ${actorColor}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, zIndex: 1,
                }}>
                  {icon}
                </div>

                <div style={{
                  flex: 1, padding: "10px 14px", borderRadius: 10,
                  background: entry.actor_type === "reviewer" ? "rgba(245, 158, 11, 0.04)" : "rgba(17, 24, 39, 0.6)",
                  border: `1px solid ${entry.actor_type === "reviewer" ? "rgba(245, 158, 11, 0.15)" : colors.border}`,
                  transition: "all 0.2s ease",
                }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = actorColor + "66";
                    e.currentTarget.style.transform = "translateX(4px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = entry.actor_type === "reviewer" ? "rgba(245, 158, 11, 0.15)" : colors.border;
                    e.currentTarget.style.transform = "translateX(0)";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, fontFamily: "IBM Plex Mono", fontWeight: 700,
                      color: actorColor, letterSpacing: "0.06em",
                    }}>
                      {entry.actor_type === "ai_engine" ? "AI ENGINE" :
                       entry.actor_type === "reviewer" ? "HUMAN REVIEWER" : "SYSTEM"}
                    </span>
                    <span style={{ fontSize: 10, color: colors.muted, fontFamily: "IBM Plex Mono" }}>
                      {entry.created_at ? new Date(entry.created_at).toLocaleString([], {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
                      }) : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.5 }}>
                    {entry.details || entry.action}
                  </div>
                  {/* Show metadata details for edits */}
                  {entry.metadata?.field_name && entry.metadata?.new_value && (
                    <div style={{
                      marginTop: 6, padding: "6px 10px", borderRadius: 6,
                      background: "rgba(245, 158, 11, 0.06)",
                      border: "1px solid rgba(245, 158, 11, 0.1)",
                      fontSize: 11, color: "#fcd34d",
                    }}>
                      <span style={{ color: colors.muted }}>{entry.metadata.field_name}:</span>{" "}
                      <span style={{ textDecoration: "line-through", color: "#6b7280" }}>{entry.metadata.old_value}</span>{" "}
                      → <span style={{ fontWeight: 600 }}>{entry.metadata.new_value}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

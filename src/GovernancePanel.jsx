import { useState, useEffect } from "react";

export default function GovernancePanel({ colors, getToken }) {
  const [metrics, setMetrics] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGovernanceData();
  }, []);

  const loadGovernanceData = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const apiUrl = import.meta.env.PROD ? "" : "http://localhost:8000";
      const headers = { Authorization: `Bearer ${token}` };

      const [metricsRes, policyRes] = await Promise.all([
        fetch(`${apiUrl}/governance/metrics`, { headers }),
        fetch(`${apiUrl}/governance/policy`, { headers }),
      ]);

      if (metricsRes.ok) {
        const metricsData = await metricsRes.json();
        setMetrics(metricsData.metrics);
      }
      if (policyRes.ok) {
        const policyData = await policyRes.json();
        setPolicy(policyData.policy);
      }
    } catch (err) {
      console.error("[Governance] Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400 }}>
        <div style={{
          width: 40, height: 40, border: `3px solid ${colors.dim}`,
          borderTopColor: colors.accent, borderRadius: "50%",
          animation: "spin 0.9s linear infinite"
        }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", animation: "fadeIn 0.4s ease" }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.accent, letterSpacing: "0.12em", marginBottom: 8, fontWeight: 700 }}>GOVERNANCE & FAIRNESS</div>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: colors.text, margin: 0, marginBottom: 8 }}>AI Governance Controls</h2>
        <p style={{ fontSize: 14, color: colors.muted, margin: 0, lineHeight: 1.6 }}>
          ClaimsIQ enforces policy-relevant, explainable, and auditable decision-making at every stage of the claims pipeline.
        </p>
      </div>

      {/* 5 Governance Control Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
        {(policy?.controls || [
          { id: "policy_decisioning", title: "Policy-Relevant Decisioning Only", description: "Automated recommendations are based only on policy, claim evidence, and business rules.", status: "active" },
          { id: "protected_features", title: "Protected Features Excluded", description: "Sensitive or irrelevant claimant attributes are excluded from automated decision logic.", status: "active" },
          { id: "confidence_escalation", title: "Confidence-Based Human Escalation", description: "Low-confidence or high-risk claims are automatically routed for human validation.", status: "active" },
          { id: "explainability", title: "Explainability for Every Recommendation", description: "Every recommendation includes traceable reasoning, evidence references, and triggered rules.", status: "active" },
          { id: "drift_monitoring", title: "Override & Drift Monitoring", description: "Human overrides and claim outcome patterns are monitored to identify model drift and inconsistent decision behavior.", status: "active" },
        ]).map((control, i) => (
          <div key={control.id} style={{
            padding: "18px 22px", borderRadius: 14,
            background: "rgba(17, 24, 39, 0.8)",
            border: `1px solid ${colors.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            transition: "all 0.3s ease",
            boxShadow: "0 2px 12px rgba(0, 0, 0, 0.2)",
          }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.accent;
              e.currentTarget.style.boxShadow = `0 4px 20px rgba(245, 158, 11, 0.12)`;
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.boxShadow = "0 2px 12px rgba(0, 0, 0, 0.2)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
                {["🛡️", "🚫", "📊", "💡", "🔄"][i]} {control.title}
              </div>
              <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.5 }}>{control.description}</div>
            </div>
            <span style={{
              padding: "4px 12px", borderRadius: 6, fontSize: 10, fontWeight: 800,
              fontFamily: "IBM Plex Mono", letterSpacing: "0.08em",
              background: "rgba(16, 185, 129, 0.15)", color: "#10b981",
              border: "1px solid rgba(16, 185, 129, 0.3)",
            }}>ACTIVE</span>
          </div>
        ))}
      </div>

      {/* Live Metrics Dashboard */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.accent, letterSpacing: "0.08em", marginBottom: 14, fontWeight: 700 }}>📈 LIVE GOVERNANCE METRICS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { label: "Total Claims", value: metrics?.total_claims || 0, color: colors.text, suffix: "" },
            { label: "Auto-Approved", value: metrics?.pct_auto_approved || 0, color: "#10b981", suffix: "%" },
            { label: "Sent to Review", value: metrics?.pct_sent_to_review || 0, color: "#f59e0b", suffix: "%" },
            { label: "Human Overrides", value: metrics?.pct_human_overrides || 0, color: "#8b5cf6", suffix: "%" },
            { label: "Avg Confidence", value: metrics?.avg_extraction_confidence || 0, color: "#06b6d4", suffix: "%" },
            { label: "High-Risk Rate", value: metrics?.high_risk_routing_rate || 0, color: "#ef4444", suffix: "%" },
            { label: "Escalated", value: metrics?.pct_escalated || 0, color: "#ec4899", suffix: "%" },
            { label: "Fraud Flag Rate", value: metrics?.fraud_flag_rate || 0, color: "#f97316", suffix: "%" },
          ].map((m, i) => (
            <div key={i} style={{
              padding: "16px", borderRadius: 12,
              background: "rgba(17, 24, 39, 0.8)",
              border: `1px solid ${colors.border}`,
              textAlign: "center",
              transition: "all 0.3s ease",
            }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = m.color;
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = `0 8px 20px ${m.color}22`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted, fontWeight: 700, marginBottom: 8, letterSpacing: "0.06em" }}>{m.label.toUpperCase()}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: m.color }}>{m.value}{m.suffix}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Decision Feature Whitelist */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.accent, letterSpacing: "0.08em", marginBottom: 14, fontWeight: 700 }}>🧬 DECISION FEATURE WHITELIST</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Allowed */}
          <div style={{
            padding: "18px 20px", borderRadius: 14,
            background: "rgba(16, 185, 129, 0.05)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
          }}>
            <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: "#10b981", fontWeight: 700, marginBottom: 12, letterSpacing: "0.08em" }}>✅ ALLOWED FOR DECISIONING</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(policy?.allowed_features || [
                "claimAmount", "claimNumber", "claimType", "claimantId", "completeness",
                "contactNumber", "currency", "filingDate", "fraudScore", "incidentDate",
                "isDuplicate", "missingFields", "policyNumber", "policyStatus", "providerName", "supportingDocuments"
              ]).map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#d1d5db" }}>
                  <span style={{ color: "#10b981", fontSize: 14, minWidth: 16 }}>✓</span>
                  <span style={{ fontFamily: "IBM Plex Mono", fontSize: 11 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Excluded */}
          <div style={{
            padding: "18px 20px", borderRadius: 14,
            background: "rgba(239, 68, 68, 0.04)",
            border: "1px solid rgba(239, 68, 68, 0.15)",
          }}>
            <div style={{ fontSize: 10, fontFamily: "IBM Plex Mono", color: "#ef4444", fontWeight: 700, marginBottom: 12, letterSpacing: "0.08em" }}>🚫 EXCLUDED FROM DECISIONING</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(policy?.excluded_features || [
                "Claimant name", "Claimant address / region", "Language of submission",
                "Handwriting style", "Document formatting style", "Provider location",
                "Contact number", "Claimant demographics"
              ]).map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#9ca3af" }}>
                  <span style={{ color: "#ef4444", fontSize: 12, minWidth: 16, opacity: 0.7 }}>✗</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Refresh Button */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button onClick={loadGovernanceData} style={{
          padding: "10px 24px", borderRadius: 10, border: `1px solid ${colors.accent}`,
          background: "transparent", color: colors.accent, fontSize: 13, fontWeight: 700,
          cursor: "pointer", fontFamily: "'Barlow', sans-serif", transition: "all 0.2s ease",
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(245, 158, 11, 0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >↻ Refresh Metrics</button>
      </div>
    </div>
  );
}

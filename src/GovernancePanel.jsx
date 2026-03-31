import { useState, useEffect, useRef } from "react";

/* ─── Animated Counter Hook ──────────────────────────────────────────────── */
function useAnimatedValue(target, duration = 1200) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) ref.current = requestAnimationFrame(step);
    };
    ref.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(ref.current);
  }, [target, duration]);
  return value;
}

/* ─── Radial Gauge Component ─────────────────────────────────────────────── */
function RadialGauge({ value, max = 100, size = 110, strokeWidth = 8, color, label, suffix = "%", colors }) {
  const animVal = useAnimatedValue(value, 1400);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animVal / max) * circumference;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="rgba(55, 65, 81, 0.4)" strokeWidth={strokeWidth} />
          <circle cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column",
        }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: color, lineHeight: 1 }}>
            {animVal}{suffix}
          </span>
        </div>
      </div>
      <span style={{
        fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted,
        fontWeight: 700, letterSpacing: "0.06em", textAlign: "center", lineHeight: 1.3,
        maxWidth: 100,
      }}>{label}</span>
    </div>
  );
}

/* ─── Progress Bar Component ─────────────────────────────────────────────── */
function ProgressBar({ value, color, height = 6 }) {
  return (
    <div style={{
      width: "100%", height, borderRadius: height, background: "rgba(55, 65, 81, 0.4)",
      overflow: "hidden",
    }}>
      <div style={{
        width: `${Math.min(value, 100)}%`, height: "100%", borderRadius: height,
        background: `linear-gradient(90deg, ${color}, ${color}cc)`,
        transition: "width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        boxShadow: `0 0 8px ${color}44`,
      }} />
    </div>
  );
}

/* ─── Stat Card Component ────────────────────────────────────────────────── */
function StatCard({ label, value, suffix, color, icon, colors, delay = 0 }) {
  const animVal = useAnimatedValue(value, 1200 + delay * 100);
  return (
    <div style={{
      padding: "20px 18px", borderRadius: 16,
      background: "rgba(17, 24, 39, 0.7)",
      backdropFilter: "blur(12px)",
      border: `1px solid ${colors.border}`,
      transition: "all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      cursor: "default",
      animation: `fadeIn 0.5s ease ${delay * 0.08}s backwards`,
      position: "relative",
      overflow: "hidden",
    }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = color;
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow = `0 12px 28px ${color}18`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Subtle top accent line */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${color}66, transparent)`,
        opacity: 0.6,
      }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{
          fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted,
          fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.4, maxWidth: "70%",
        }}>{label.toUpperCase()}</div>
        <span style={{ fontSize: 18, opacity: 0.8 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: color, lineHeight: 1, marginBottom: 10 }}>
        {animVal}{suffix}
      </div>
      <ProgressBar value={value} color={color} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
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

  /* ─── Loading State ──────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{
        display: "flex", justifyContent: "center", alignItems: "center", minHeight: "70vh",
        flexDirection: "column", gap: 20,
      }}>
        <div style={{
          width: 48, height: 48, border: `3px solid ${colors.dim}`,
          borderTopColor: colors.accent, borderRadius: "50%",
          animation: "spin 0.9s linear infinite",
          boxShadow: `0 0 20px ${colors.accent}33`,
        }} />
        <span style={{ fontSize: 12, fontFamily: "IBM Plex Mono", color: colors.muted, letterSpacing: "0.1em" }}>
          LOADING GOVERNANCE DATA...
        </span>
      </div>
    );
  }

  /* ─── Derived Values ─────────────────────────────────────────────────── */
  const totalClaims = metrics?.total_claims || 0;
  const autoApproved = metrics?.pct_auto_approved || 0;
  const sentToReview = metrics?.pct_sent_to_review || 0;
  const humanOverrides = metrics?.pct_human_overrides || 0;
  const avgConfidence = metrics?.avg_extraction_confidence || 0;
  const highRiskRate = metrics?.high_risk_routing_rate || 0;
  const escalated = metrics?.pct_escalated || 0;
  const fraudFlagRate = metrics?.fraud_flag_rate || 0;

  // Compute a governance health score
  const healthScore = Math.round(
    Math.min(100, Math.max(0,
      (avgConfidence * 0.35) +
      ((100 - highRiskRate) * 0.25) +
      ((100 - fraudFlagRate) * 0.2) +
      (autoApproved * 0.2)
    ))
  );
  const healthColor = healthScore >= 75 ? "#10b981" : healthScore >= 50 ? "#f59e0b" : "#ef4444";
  const healthLabel = healthScore >= 75 ? "EXCELLENT" : healthScore >= 50 ? "MODERATE" : "NEEDS ATTENTION";

  const controls = policy?.controls || [
    { id: "policy_decisioning", title: "Policy-Relevant Decisioning Only", description: "Automated recommendations are based only on policy, claim evidence, and business rules.", status: "active" },
    { id: "protected_features", title: "Protected Features Excluded", description: "Sensitive or irrelevant claimant attributes are excluded from automated decision logic.", status: "active" },
    { id: "confidence_escalation", title: "Confidence-Based Human Escalation", description: "Low-confidence or high-risk claims are automatically routed for human validation.", status: "active" },
    { id: "explainability", title: "Explainability for Every Recommendation", description: "Every recommendation includes traceable reasoning, evidence references, and triggered rules.", status: "active" },
    { id: "drift_monitoring", title: "Override & Drift Monitoring", description: "Human overrides and claim outcome patterns are monitored to identify model drift and inconsistent decision behavior.", status: "active" },
  ];

  const controlIcons = ["🛡️", "🚫", "📊", "💡", "🔄"];
  const controlColors = ["#06b6d4", "#ef4444", "#f59e0b", "#8b5cf6", "#10b981"];

  const allowedFeatures = policy?.allowed_features || [
    "claimAmount", "claimNumber", "claimType", "claimantId", "completeness",
    "contactNumber", "currency", "filingDate", "fraudScore", "incidentDate",
    "isDuplicate", "missingFields", "policyNumber", "policyStatus", "providerName", "supportingDocuments",
  ];

  const excludedFeatures = policy?.excluded_features || [
    "Claimant name", "Claimant address / region", "Language of submission",
    "Handwriting style", "Document formatting style", "Provider location",
    "Contact number", "Claimant demographics",
  ];

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <div style={{ animation: "fadeIn 0.4s ease", width: "100%" }}>

      {/* ═══════════ HERO HEADER ═══════════ */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr auto", gap: 40,
        alignItems: "center",
        padding: "28px 32px",
        borderRadius: 20,
        background: "linear-gradient(135deg, rgba(17, 24, 39, 0.9) 0%, rgba(30, 20, 8, 0.6) 50%, rgba(17, 24, 39, 0.9) 100%)",
        border: `1px solid ${colors.border}`,
        marginBottom: 24,
        position: "relative",
        overflow: "hidden",
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
      }}>
        {/* Animated gradient line */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${colors.accent}88, #8b5cf688, #06b6d488, transparent)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 4s linear infinite",
        }} />

        <div>
          <div style={{
            fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.accent,
            letterSpacing: "0.14em", marginBottom: 8, fontWeight: 700,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: "#10b981",
              animation: "pulse 2s infinite", boxShadow: "0 0 8px rgba(16, 185, 129, 0.5)",
            }} />
            GOVERNANCE & FAIRNESS ENGINE
          </div>
          <h2 style={{
            fontSize: 26, fontWeight: 800, color: colors.text, margin: 0, marginBottom: 8,
            letterSpacing: "-0.02em",
          }}>AI Governance Controls</h2>
          <p style={{
            fontSize: 14, color: colors.muted, margin: 0, lineHeight: 1.7, maxWidth: 600,
          }}>
            ClaimsIQ enforces policy-relevant, explainable, and auditable decision-making at every stage of the claims pipeline.
            All controls are continuously monitored and enforced in real-time.
          </p>
        </div>

        {/* Governance Health Score */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          padding: "8px 20px",
        }}>
          <RadialGauge
            value={healthScore} max={100} size={120} strokeWidth={10}
            color={healthColor} label="" colors={colors}
          />
          <span style={{
            fontSize: 10, fontFamily: "IBM Plex Mono", fontWeight: 800,
            letterSpacing: "0.1em", color: healthColor,
            padding: "3px 10px", borderRadius: 6,
            background: `${healthColor}15`, border: `1px solid ${healthColor}33`,
          }}>{healthLabel}</span>
          <span style={{
            fontSize: 9, fontFamily: "IBM Plex Mono", color: colors.muted,
            letterSpacing: "0.08em",
          }}>GOVERNANCE HEALTH</span>
        </div>
      </div>

      {/* ═══════════ LIVE METRICS GRID (full width) ═══════════ */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.accent,
          letterSpacing: "0.1em", marginBottom: 14, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>📈</span> LIVE GOVERNANCE METRICS
          <div style={{
            marginLeft: "auto", fontSize: 10, color: colors.muted,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%", background: "#10b981",
              animation: "pulse 2s infinite",
            }} />
            REAL-TIME
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <StatCard label="Total Claims" value={totalClaims} suffix="" color={colors.text} icon="📂" colors={colors} delay={0} />
          <StatCard label="Auto-Approved" value={autoApproved} suffix="%" color="#10b981" icon="✅" colors={colors} delay={1} />
          <StatCard label="Sent to Review" value={sentToReview} suffix="%" color="#f59e0b" icon="⚑" colors={colors} delay={2} />
          <StatCard label="Human Overrides" value={humanOverrides} suffix="%" color="#8b5cf6" icon="👤" colors={colors} delay={3} />
          <StatCard label="Avg Confidence" value={avgConfidence} suffix="%" color="#06b6d4" icon="🎯" colors={colors} delay={4} />
          <StatCard label="High-Risk Rate" value={highRiskRate} suffix="%" color="#ef4444" icon="🔴" colors={colors} delay={5} />
          <StatCard label="Escalated" value={escalated} suffix="%" color="#ec4899" icon="↗" colors={colors} delay={6} />
          <StatCard label="Fraud Flag Rate" value={fraudFlagRate} suffix="%" color="#f97316" icon="🚨" colors={colors} delay={7} />
        </div>
      </div>

      {/* ═══════════ GOVERNANCE CONTROLS + PIPELINE (2-col) ═══════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 24 }}>

        {/* ─── Controls Column ─── */}
        <div>
          <div style={{
            fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.accent,
            letterSpacing: "0.1em", marginBottom: 14, fontWeight: 700,
          }}>🛡️ ACTIVE GOVERNANCE CONTROLS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {controls.map((control, i) => (
              <div key={control.id} style={{
                padding: "16px 20px", borderRadius: 14,
                background: "rgba(17, 24, 39, 0.7)",
                backdropFilter: "blur(12px)",
                border: `1px solid ${colors.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                transition: "all 0.35s ease",
                animation: `fadeIn 0.4s ease ${i * 0.06}s backwards`,
                position: "relative",
                overflow: "hidden",
              }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = controlColors[i];
                  e.currentTarget.style.boxShadow = `0 6px 20px ${controlColors[i]}12`;
                  e.currentTarget.style.transform = "translateX(4px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = colors.border;
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "translateX(0)";
                }}
              >
                {/* Left accent bar */}
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                  background: controlColors[i], borderRadius: "3px 0 0 3px",
                  opacity: 0.7,
                }} />
                <div style={{ flex: 1, paddingLeft: 8 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 4,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span style={{ fontSize: 16 }}>{controlIcons[i]}</span>
                    {control.title}
                  </div>
                  <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.5 }}>
                    {control.description}
                  </div>
                </div>
                <span style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 9, fontWeight: 800,
                  fontFamily: "IBM Plex Mono", letterSpacing: "0.08em",
                  background: "rgba(16, 185, 129, 0.12)", color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  whiteSpace: "nowrap",
                }}>ACTIVE</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Pipeline Visualization Column ─── */}
        <div>
          <div style={{
            fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.accent,
            letterSpacing: "0.1em", marginBottom: 14, fontWeight: 700,
          }}>⚡ GOVERNANCE ENFORCEMENT PIPELINE</div>
          <div style={{
            padding: "24px", borderRadius: 16,
            background: "rgba(17, 24, 39, 0.7)",
            backdropFilter: "blur(12px)",
            border: `1px solid ${colors.border}`,
            height: "calc(100% - 34px)",
            boxSizing: "border-box",
          }}>
            {[
              { stage: "Document Ingestion", desc: "OCR + content extraction with confidence scoring", icon: "📄", color: "#06b6d4" },
              { stage: "Feature Gate", desc: "Protected features stripped; only whitelisted fields pass", icon: "🔒", color: "#8b5cf6" },
              { stage: "Policy Engine", desc: "Business rules evaluated against extracted context", icon: "⚙️", color: "#f59e0b" },
              { stage: "Risk Assessment", desc: "Fraud score, completeness, anomaly detection", icon: "🎯", color: "#ef4444" },
              { stage: "Routing Decision", desc: "STP auto-approve or escalate with full reasoning", icon: "🔀", color: "#10b981" },
              { stage: "Audit & Monitor", desc: "Decision logged with evidence trail; drift monitored", icon: "📊", color: "#ec4899" },
            ].map((step, i, arr) => (
              <div key={i} style={{
                display: "flex", gap: 14, alignItems: "flex-start",
                marginBottom: i < arr.length - 1 ? 4 : 0,
                position: "relative",
              }}>
                {/* Timeline connector */}
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  minWidth: 32,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: `${step.color}18`,
                    border: `2px solid ${step.color}55`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, zIndex: 1,
                    transition: "all 0.3s ease",
                  }}>{step.icon}</div>
                  {i < arr.length - 1 && (
                    <div style={{
                      width: 2, height: 22, background: `linear-gradient(180deg, ${step.color}44, ${arr[i + 1].color}44)`,
                    }} />
                  )}
                </div>
                <div style={{ paddingTop: 2, flex: 1 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 2,
                  }}>{step.stage}</div>
                  <div style={{
                    fontSize: 11, color: colors.muted, lineHeight: 1.5, marginBottom: i < arr.length - 1 ? 8 : 0,
                  }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════ DECISION FEATURE WHITELIST (full width, 3-columns) ═══════════ */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 11, fontFamily: "IBM Plex Mono", color: colors.accent,
          letterSpacing: "0.1em", marginBottom: 14, fontWeight: 700,
        }}>🧬 DECISION FEATURE WHITELIST</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>

          {/* Allowed Features */}
          <div style={{
            padding: "22px 24px", borderRadius: 16,
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.04), rgba(17, 24, 39, 0.7))",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(16, 185, 129, 0.18)",
            gridColumn: "span 1",
          }}>
            <div style={{
              fontSize: 10, fontFamily: "IBM Plex Mono", color: "#10b981", fontWeight: 700,
              marginBottom: 14, letterSpacing: "0.1em",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: 6, background: "rgba(16, 185, 129, 0.15)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
              }}>✓</span>
              ALLOWED FOR DECISIONING
              <span style={{
                marginLeft: "auto", padding: "2px 8px", borderRadius: 4,
                background: "rgba(16, 185, 129, 0.1)", fontSize: 9, color: "#10b981",
                border: "1px solid rgba(16, 185, 129, 0.2)",
              }}>{allowedFeatures.length}</span>
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px",
            }}>
              {allowedFeatures.map((f, i) => (
                <div key={i} style={{
                  display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "#d1d5db",
                  padding: "5px 8px", borderRadius: 6,
                  transition: "all 0.2s ease",
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(16, 185, 129, 0.06)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ color: "#10b981", fontSize: 12, minWidth: 14 }}>✓</span>
                  <span style={{ fontFamily: "IBM Plex Mono", fontSize: 10 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Excluded Features */}
          <div style={{
            padding: "22px 24px", borderRadius: 16,
            background: "linear-gradient(135deg, rgba(239, 68, 68, 0.03), rgba(17, 24, 39, 0.7))",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(239, 68, 68, 0.12)",
          }}>
            <div style={{
              fontSize: 10, fontFamily: "IBM Plex Mono", color: "#ef4444", fontWeight: 700,
              marginBottom: 14, letterSpacing: "0.1em",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: 6, background: "rgba(239, 68, 68, 0.1)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
              }}>✗</span>
              EXCLUDED FROM DECISIONING
              <span style={{
                marginLeft: "auto", padding: "2px 8px", borderRadius: 4,
                background: "rgba(239, 68, 68, 0.08)", fontSize: 9, color: "#ef4444",
                border: "1px solid rgba(239, 68, 68, 0.15)",
              }}>{excludedFeatures.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {excludedFeatures.map((f, i) => (
                <div key={i} style={{
                  display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#9ca3af",
                  padding: "6px 8px", borderRadius: 6,
                  transition: "all 0.2s ease",
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239, 68, 68, 0.04)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{
                    color: "#ef4444", fontSize: 11, minWidth: 14, opacity: 0.7,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✗</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Compliance Summary */}
          <div style={{
            padding: "22px 24px", borderRadius: 16,
            background: "linear-gradient(135deg, rgba(139, 92, 246, 0.04), rgba(17, 24, 39, 0.7))",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(139, 92, 246, 0.15)",
          }}>
            <div style={{
              fontSize: 10, fontFamily: "IBM Plex Mono", color: "#8b5cf6", fontWeight: 700,
              marginBottom: 14, letterSpacing: "0.1em",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: 6, background: "rgba(139, 92, 246, 0.12)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
              }}>⚖</span>
              COMPLIANCE SUMMARY
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { label: "Feature Isolation", desc: "Protected attributes fully separated from decision path", status: "ENFORCED", statusColor: "#10b981" },
                { label: "Audit Trail", desc: "Every decision logged with evidence and reasoning", status: "ACTIVE", statusColor: "#10b981" },
                { label: "Bias Detection", desc: "Ongoing monitoring for demographic and regional bias", status: "MONITORING", statusColor: "#f59e0b" },
                { label: "Explainability", desc: "AI reasoning provided for every claim recommendation", status: "ENFORCED", statusColor: "#10b981" },
                { label: "Data Retention", desc: "Compliant storage per regulatory requirements", status: "COMPLIANT", statusColor: "#06b6d4" },
              ].map((item, i) => (
                <div key={i} style={{
                  padding: "10px 12px", borderRadius: 10,
                  background: "rgba(0, 0, 0, 0.2)",
                  border: `1px solid ${colors.border}`,
                  transition: "all 0.2s ease",
                }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#8b5cf644";
                    e.currentTarget.style.background = "rgba(139, 92, 246, 0.04)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = colors.border;
                    e.currentTarget.style.background = "rgba(0, 0, 0, 0.2)";
                  }}
                >
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{item.label}</span>
                    <span style={{
                      fontSize: 8, fontWeight: 800, fontFamily: "IBM Plex Mono",
                      padding: "2px 8px", borderRadius: 4, letterSpacing: "0.06em",
                      background: `${item.statusColor}12`, color: item.statusColor,
                      border: `1px solid ${item.statusColor}30`,
                    }}>{item.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: colors.muted, lineHeight: 1.4 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ FOOTER — Refresh + Timestamp ═══════════ */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 20px", borderRadius: 14,
        background: "rgba(17, 24, 39, 0.5)",
        border: `1px solid ${colors.border}`,
      }}>
        <div style={{
          fontSize: 10, fontFamily: "IBM Plex Mono", color: colors.muted,
          letterSpacing: "0.06em",
        }}>
          Last refreshed: {new Date().toLocaleString("en-US", {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            month: "short", day: "numeric", hour12: true,
          })}
        </div>
        <button onClick={loadGovernanceData} style={{
          padding: "8px 22px", borderRadius: 10,
          border: `1px solid ${colors.accent}`,
          background: "transparent", color: colors.accent,
          fontSize: 12, fontWeight: 700, cursor: "pointer",
          fontFamily: "'Barlow', sans-serif",
          transition: "all 0.25s ease",
          display: "flex", alignItems: "center", gap: 8,
        }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(245, 158, 11, 0.1)";
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 4px 16px rgba(245, 158, 11, 0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <span style={{ display: "inline-block", transition: "transform 0.3s ease" }}>↻</span>
          Refresh Metrics
        </button>
      </div>
    </div>
  );
}

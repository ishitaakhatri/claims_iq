import React from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";

const colors = {
  bg: "#030712",
  surface: "#0d1117",
  card: "#111827",
  border: "#1f2937",
  accent: "#f59e0b",
  accentDim: "#78350f",
  text: "#f9fafb",
  muted: "#6b7280",
  dim: "#374151",
};

const clerkAppearance = {
  variables: {
    colorPrimary: colors.accent,
    colorBackground: colors.card,
    colorText: colors.text,
    colorTextSecondary: colors.muted,
    colorInputBackground: colors.bg,
    colorInputText: colors.text,
    colorTextOnPrimaryBackground: colors.bg,
    borderRadius: "12px",
    fontFamily: "'Barlow', sans-serif",
  },
  elements: {
    card: {
      border: `1px solid ${colors.border}`,
      background: "rgba(17, 24, 39, 0.95)",
      backdropFilter: "blur(12px)",
      boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px rgba(245, 158, 11, 0.1)",
    },
    headerTitle: { color: colors.text, fontWeight: 800, fontSize: "1.5rem" },
    headerSubtitle: { color: colors.muted },
    socialButtonsBlockButton: {
      backgroundColor: colors.surface,
      border: `2px solid ${colors.border}`,
      color: colors.text,
      transition: "all 0.3s ease",
      "&:hover": { backgroundColor: colors.dim, color: colors.text, borderColor: colors.accent },
    },
    formButtonPrimary: {
      backgroundColor: colors.accent,
      color: colors.bg,
      fontWeight: 700,
      textTransform: "none",
      fontSize: "0.95rem",
      transition: "all 0.3s ease",
      "&:hover": { backgroundColor: "#fbbf24", color: colors.bg, boxShadow: "0 8px 20px rgba(245, 158, 11, 0.3)" },
    },
    footerActionLink: {
      color: colors.accent,
      fontWeight: 600,
      transition: "all 0.2s ease",
      "&:hover": { color: "#fbbf24", textDecoration: "underline" }
    },
    dividerLine: { background: colors.border },
    dividerText: { color: colors.muted, fontSize: "0.75rem" },
    formFieldLabel: { color: colors.text, fontWeight: 500 },
    formFieldInput: {
      border: `1px solid ${colors.border}`,
      backgroundColor: "rgba(3, 7, 18, 0.9)",
      transition: "all 0.3s ease",
      "&:focus": { border: `2px solid ${colors.accent}`, boxShadow: `0 0 20px ${colors.accent}33` }
    }
  }
};

export default function AuthPage({ mode = "sign-in" }) {
  const css = `
    @keyframes float {
      0% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-24px) rotate(2deg); }
      100% { transform: translateY(0px) rotate(0deg); }
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 20px rgba(245, 158, 11, 0.3); }
      50% { box-shadow: 0 0 40px rgba(245, 158, 11, 0.6); }
    }
    @keyframes bgGradient {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .auth-container {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      background: #02040a;
      font-family: 'Barlow', sans-serif;
      overflow: hidden;
    }
    @media (max-width: 1024px) {
      .auth-container { grid-template-columns: 1fr; }
      .brand-side { display: none; }
    }
    .brand-side {
      position: relative;
      background: linear-gradient(-45deg, #02040a, #0a0f1e, #02040a, #080c14);
      background-size: 400% 400%;
      animation: bgGradient 15s ease infinite;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 80px;
      overflow: hidden;
    }
    .brand-side::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.05) 0%, transparent 70%);
      pointer-events: none;
      z-index: 1;
    }
    .form-side {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      position: relative;
      z-index: 10;
      background: rgba(3, 7, 18, 0.5);
    }
    .floating-shape {
      position: absolute;
      width: 300px;
      height: 300px;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(124, 58, 237, 0.12));
      border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%;
      filter: blur(50px);
      animation: float 12s ease-in-out infinite;
      z-index: -1;
      opacity: 0.8;
    }
    .logo-container {
      margin-bottom: 48px;
      display: flex;
      align-items: center;
      gap: 16px;
      animation: slideIn 0.8s ease-out;
      position: relative;
      z-index: 2;
    }
    .brand-title {
      font-size: 3.5rem;
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1;
      margin-bottom: 24px;
      background: linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.7));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: slideIn 0.9s ease-out 0.1s backwards;
      position: relative;
      z-index: 2;
    }
    .brand-subtitle {
      font-size: 1.25rem;
      color: #9ca3af;
      max-width: 480px;
      line-height: 1.6;
      margin-bottom: 48px;
      animation: slideIn 1s ease-out 0.2s backwards;
      position: relative;
      z-index: 2;
    }
    .feature-list {
      display: flex;
      flex-direction: column;
      gap: 28px;
      position: relative;
      z-index: 2;
    }
    .feature-item {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      animation: slideIn 1.1s ease-out 0.3s backwards;
      opacity: 0;
      animation-fill-mode: forwards;
    }
    .feature-item:nth-child(2) {
      animation-delay: 0.4s;
    }
    .feature-item:nth-child(3) {
      animation-delay: 0.5s;
    }
    .feature-icon {
      width: 44px;
      height: 44px;
      background: rgba(245, 158, 11, 0.1);
      border: 2px solid rgba(245, 158, 11, 0.3);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f59e0b;
      font-size: 1.3rem;
      flex-shrink: 0;
      transition: all 0.3s ease;
    }
    .feature-item:hover .feature-icon {
      background: rgba(245, 158, 11, 0.2);
      border-color: rgba(245, 158, 11, 0.6);
      transform: scale(1.1);
    }
    .feature-text div:first-child {
      font-weight: 700;
      color: #fff;
      margin-bottom: 4px;
      font-size: 0.95rem;
    }
    .feature-text div:last-child {
      font-size: 0.9rem;
      color: #71717a;
      line-height: 1.5;
    }
  `;

  return (
    <div className="auth-container">
      <style>{css}</style>

      {/* Left Side: Branding */}
      <div className="brand-side">
        <div className="logo-container">
          <svg width="50" height="50" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="25" width="35" height="12" rx="6" fill="#a78bfa" />
            <rect x="5" y="44" width="35" height="12" rx="6" fill="#7c3aed" />
            <rect x="5" y="63" width="35" height="12" rx="6" fill="#5b21b6" />
            <path d="M55 75L72.5 25L90 75" stroke="#34d399" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontWeight: 800, fontSize: "1.5rem", color: "#fff", letterSpacing: "0.05em" }}>CLAIMSIQ</div>
        </div>

        <h1 className="brand-title">Agentic Claims Intelligence for Modern Insurance</h1>
        <p className="brand-subtitle">Automate extraction, evaluation, and routing with state-of-the-art AI. Experience the future of claims processing today.</p>

        <div className="feature-list">
          <div className="feature-item">
            <div className="feature-icon">⚡</div>
            <div className="feature-text">
              <div>Straight-Through Processing</div>
              <div>Automate high-confidence claims in seconds.</div>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon">🔍</div>
            <div className="feature-text">
              <div>Precision Extraction</div>
              <div>Leverage LangGraph and Azure AI for 99% accuracy.</div>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon">🛡️</div>
            <div className="feature-text">
              <div>Fraud Detection</div>
              <div>Integrated risk scoring and anomaly detection.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side: Form */}
      <div className="form-side">
        <div className="floating-shape" style={{ top: '10%', right: '10%' }}></div>
        <div className="floating-shape" style={{ bottom: '15%', left: '10%', animationDelay: '-5s', width: '250px', height: '250px' }}></div>

        {mode === "sign-in" ? (
          <SignIn appearance={clerkAppearance} signUpUrl="/?mode=sign-up" />
        ) : (
          <SignUp appearance={clerkAppearance} signInUrl="/?mode=sign-in" />
        )}
      </div>
    </div>
  );
}

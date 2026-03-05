import React, { useState, useEffect, useRef } from 'react';

// ─── Constants ───
const RULE_TYPES = [
    {
        id: 'threshold',
        name: 'Threshold Rule',
        description: 'Compares a numeric field against a specific value (e.g., Amount <= $5000).',
        fields: ['fieldName', 'operator', 'value']
    },
    {
        id: 'comparison',
        name: 'Comparison Rule',
        description: 'Matches a field value exactly (e.g., Policy Status = "Active").',
        fields: ['fieldName', 'operator', 'value']
    },
    {
        id: 'cross_field',
        name: 'Cross-Field Analysis',
        description: 'Validates relationships between multiple fields (e.g., duplicate checks).',
        fields: ['fieldName', 'dependencyField', 'logic']
    },
    {
        id: 'extraction_quality',
        name: 'Extraction Quality',
        description: 'Ensures data completeness and OCR confidence scores.',
        fields: ['minConfidence', 'requiredFields']
    }
];

const INITIAL_RULES = [
    { id: "BR001", name: "Claim Amount Threshold", description: "Claims ≤ $5,000 auto-approved", rule_type: "threshold", field: "claimAmount", operator: "lte", value: 5000, enabled: true },
    { id: "BR002", name: "High-Value Escalation", description: "Claims > $25,000 require senior review", rule_type: "threshold", field: "claimAmount", operator: "gt", value: 25000, enabled: true },
    { id: "BR003", name: "Document Completeness", description: "All required fields must be present", rule_type: "comparison", field: "completeness", operator: "gte", value: 80, enabled: true },
];

export default function RulesManagement({ colors }) {
    const [activeTab, setActiveTab] = useState('chatbot'); // chatbot | registry | configurator
    const [rules, setRules] = useState(INITIAL_RULES);
    const [selectedType, setSelectedType] = useState(null);

    // Chatbot State
    const [messages, setMessages] = useState([
        { role: 'ai', content: 'Hello! I am your AI Claims Intelligence Assistant. How can I help you optimize your business rules today?' }
    ]);
    const [inputValue, setInputValue] = useState('');
    const chatEndRef = useRef(null);

    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (!inputValue.trim()) return;

        const userMsg = { role: 'user', content: inputValue };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');

        // Mock AI Response
        setTimeout(() => {
            setMessages(prev => [...prev, {
                role: 'ai',
                content: `I've analyzed your request: "${userMsg.content}". I can update the Claim Amount Threshold to $6,000 for you. Should I proceed with this change?`
            }]);
        }, 1000);
    };

    const deleteRule = (id) => {
        setRules(rules.filter(r => r.id !== id));
    };

    const toggleRule = (id) => {
        setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    };

    return (
        <div style={{ animation: 'fadeIn 0.5s ease', height: '100%', display: 'flex', flexDirection: 'column' }}>

            {/* ── Tabs ── */}
            <div style={{ display: 'flex', gap: 32, borderBottom: `1px solid ${colors.border}`, marginBottom: 24, padding: '0 8px' }}>
                {[
                    { id: 'chatbot', label: 'AI INTELLIGENCE', icon: '🤖' },
                    { id: 'configurator', label: 'RULE CONFIGURATOR', icon: '🛠️' },
                    { id: 'registry', label: 'RULE REGISTRY', icon: '📋' },
                ].map(t => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        style={{
                            padding: '16px 0', background: 'none', border: 'none', cursor: 'pointer',
                            color: activeTab === t.id ? colors.accent : colors.muted,
                            fontSize: 12, fontWeight: 800, fontFamily: 'IBM Plex Mono', letterSpacing: '0.1em',
                            borderBottom: activeTab === t.id ? `2px solid ${colors.accent}` : '2px solid transparent',
                            transition: 'all 0.3s ease', display: 'flex', alignItems: 'center', gap: 10,
                            opacity: activeTab === t.id ? 1 : 0.6
                        }}
                    >
                        <span style={{ fontSize: 16 }}>{t.icon}</span>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── Content Area ── */}
            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>

                {/* Section 1: Chatbot */}
                {activeTab === 'chatbot' && (
                    <div style={{
                        height: '600px', display: 'flex', flexDirection: 'column',
                        background: 'rgba(13, 17, 23, 0.4)', borderRadius: 20, border: `1px solid ${colors.border}`,
                        overflow: 'hidden', backdropFilter: 'blur(10px)', animation: 'slideIn 0.4s ease'
                    }}>
                        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${colors.border}`, background: 'rgba(245, 158, 11, 0.03)' }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: colors.accent }}>AI RULES ASSISTANT</div>
                            <div style={{ fontSize: 11, color: colors.muted }}>Natural Language Configuration Engine</div>
                        </div>

                        <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {messages.map((m, i) => (
                                <div key={i} style={{
                                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                                    maxWidth: '80%', display: 'flex', flexDirection: 'column',
                                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start'
                                }}>
                                    <div style={{
                                        padding: '12px 18px', borderRadius: m.role === 'user' ? '18px 18px 2px 18px' : '18px 18px 18px 2px',
                                        background: m.role === 'user' ? colors.accent : 'rgba(31, 41, 55, 0.6)',
                                        color: m.role === 'user' ? '#000' : '#e5e7eb',
                                        fontSize: 14, lineHeight: 1.5, fontWeight: 500,
                                        boxShadow: m.role === 'user' ? `0 4px 15px ${colors.accent}33` : 'none',
                                        border: m.role === 'user' ? 'none' : `1px solid ${colors.border}`
                                    }}>
                                        {m.content}
                                    </div>
                                    <div style={{ fontSize: 10, color: colors.muted, marginTop: 6, fontFamily: 'IBM Plex Mono' }}>
                                        {m.role === 'user' ? 'YOU' : 'AI ASSISTANT'}
                                    </div>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>

                        <form onSubmit={handleSendMessage} style={{ padding: 20, background: 'rgba(3, 7, 18, 0.4)', borderTop: `1px solid ${colors.border}` }}>
                            <div style={{ position: 'relative', display: 'flex', gap: 12 }}>
                                <input
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    placeholder="Ask me to 'Create a rule for claims over $10k'..."
                                    style={{
                                        flex: 1, background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.border}`,
                                        borderRadius: 12, padding: '14px 20px', color: '#fff', fontSize: 14,
                                        outline: 'none', transition: 'all 0.3s ease'
                                    }}
                                    onFocus={(e) => e.target.style.borderColor = colors.accent}
                                    onBlur={(e) => e.target.style.borderColor = colors.border}
                                />
                                <button type="submit" style={{
                                    background: colors.accent, color: '#000', border: 'none', borderRadius: 12,
                                    padding: '0 24px', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                                    transition: 'all 0.3s ease', boxShadow: `0 4px 15px ${colors.accent}44`
                                }}>
                                    SEND
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* Section 2: Configurator */}
                {activeTab === 'configurator' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, animation: 'slideIn 0.4s ease' }}>
                        {/* Type Selector */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, fontFamily: 'IBM Plex Mono', marginBottom: 8 }}>SELECT RULE TYPE</div>
                            {RULE_TYPES.map(type => (
                                <div
                                    key={type.id}
                                    onClick={() => setSelectedType(type)}
                                    style={{
                                        padding: '16px 20px', borderRadius: 12, cursor: 'pointer',
                                        background: selectedType?.id === type.id ? 'rgba(245, 158, 11, 0.1)' : 'rgba(17, 24, 39, 0.4)',
                                        border: `1.5px solid ${selectedType?.id === type.id ? colors.accent : colors.border}`,
                                        transition: 'all 0.3s ease',
                                        transform: selectedType?.id === type.id ? 'translateX(8px)' : 'none'
                                    }}
                                >
                                    <div style={{ fontWeight: 700, color: selectedType?.id === type.id ? colors.accent : colors.text, marginBottom: 4 }}>{type.name}</div>
                                    <div style={{ fontSize: 11, color: colors.muted, lineHeight: 1.4 }}>{type.description}</div>
                                </div>
                            ))}
                        </div>

                        {/* Form Area */}
                        <div style={{
                            background: 'rgba(13, 17, 23, 0.4)', borderRadius: 20, border: `1px solid ${colors.border}`,
                            padding: 32, backdropFilter: 'blur(10px)'
                        }}>
                            {!selectedType ? (
                                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: colors.muted }}>
                                    <div style={{ fontSize: 40, marginBottom: 20 }}>🏗️</div>
                                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Ready to Build</div>
                                    <div style={{ fontSize: 13 }}>Select a rule architecture from the left to begin configuration.</div>
                                </div>
                            ) : (
                                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
                                        <div>
                                            <div style={{ fontSize: 18, fontWeight: 800, color: colors.text }}>Configure {selectedType.name}</div>
                                            <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Define the logic and parameters for this automated rule.</div>
                                        </div>
                                        <div style={{ padding: '4px 12px', background: 'rgba(245, 158, 11, 0.1)', border: `1px solid ${colors.accent}`, borderRadius: 6, fontSize: 10, color: colors.accent, fontWeight: 700 }}>NEW RULE</div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 10 }}>RULE NAME</label>
                                            <input type="text" placeholder="e.g. Audit Large Medical Claims" style={{
                                                width: '100%', background: 'rgba(17, 24, 39, 0.6)', border: `1px solid ${colors.border}`,
                                                borderRadius: 8, padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none'
                                            }} />
                                        </div>
                                        {selectedType.fields.map(f => (
                                            <div key={f}>
                                                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 10 }}>{f.toUpperCase()}</label>
                                                <input type="text" style={{
                                                    width: '100%', background: 'rgba(17, 24, 39, 0.6)', border: `1px solid ${colors.border}`,
                                                    borderRadius: 8, padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none'
                                                }} />
                                            </div>
                                        ))}
                                    </div>

                                    <div style={{ marginTop: 40, display: 'flex', gap: 16 }}>
                                        <button style={{
                                            flex: 1, background: colors.accent, color: '#000', border: 'none', borderRadius: 10,
                                            padding: '14px 0', fontWeight: 800, cursor: 'pointer', transition: 'all 0.3s ease'
                                        }}>DEPLOY RULE</button>
                                        <button
                                            onClick={() => setSelectedType(null)}
                                            style={{
                                                padding: '0 24px', background: 'transparent', color: colors.muted,
                                                border: `1px solid ${colors.border}`, borderRadius: 10, fontWeight: 700, cursor: 'pointer'
                                            }}
                                        >CANCEL</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Section 3: Registry */}
                {activeTab === 'registry' && (
                    <div style={{ animation: 'slideIn 0.4s ease' }}>
                        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 20, overflow: 'hidden', background: 'rgba(13, 17, 23, 0.4)', backdropFilter: 'blur(10px)' }}>
                            <div style={{ padding: '24px 32px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontSize: 16, fontWeight: 800 }}>ACTIVE RULESET</div>
                                    <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Managing {rules.length} automated decision nodes</div>
                                </div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 10, color: colors.muted, fontWeight: 700 }}>SYSTEM STATUS</div>
                                        <div style={{ fontSize: 12, color: '#10b981', fontWeight: 800 }}>OPTIMIZED</div>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {rules.map((rule, idx) => (
                                    <div key={rule.id} style={{
                                        padding: '24px 32px', borderBottom: idx === rules.length - 1 ? 'none' : `1px solid ${colors.border}`,
                                        display: 'grid', gridTemplateColumns: '60px 1fr 180px 140px 100px', alignItems: 'center', gap: 24,
                                        transition: 'all 0.3s ease', opacity: rule.enabled ? 1 : 0.4
                                    }}>
                                        <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: colors.accent, fontSize: 13 }}>{rule.id}</div>

                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{rule.name}</div>
                                            <div style={{ fontSize: 12, color: colors.muted }}>{rule.description}</div>
                                        </div>

                                        <div>
                                            <div style={{ fontSize: 10, color: colors.muted, fontWeight: 700, marginBottom: 8, fontFamily: 'IBM Plex Mono' }}>THRESHOLD</div>
                                            {rule.rule_type === 'threshold' ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                    <input
                                                        type="range"
                                                        min="0" max="50000" step="500"
                                                        value={rule.value}
                                                        style={{ flex: 1, accentColor: colors.accent }}
                                                        onChange={(e) => setRules(rules.map(r => r.id === rule.id ? { ...r, value: parseInt(e.target.value) } : r))}
                                                    />
                                                    <span style={{ fontSize: 12, fontWeight: 800, minWidth: 60, textAlign: 'right' }}>${rule.value.toLocaleString()}</span>
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: 13, fontWeight: 700 }}>VALUE: {rule.value}%</div>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                                            <button
                                                onClick={() => toggleRule(rule.id)}
                                                style={{
                                                    background: rule.enabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(31, 41, 55, 0.4)',
                                                    color: rule.enabled ? '#10b981' : colors.muted,
                                                    border: `1px solid ${rule.enabled ? '#10b981' : colors.border}`,
                                                    padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                                                    transition: 'all 0.3s ease'
                                                }}
                                            >
                                                {rule.enabled ? 'ENABLED' : 'DISABLED'}
                                            </button>
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                                            <button
                                                onClick={() => deleteRule(rule.id)}
                                                style={{
                                                    background: 'none', border: 'none', color: '#ef4444',
                                                    fontSize: 18, cursor: 'pointer', opacity: 0.6, transition: '0.2s'
                                                }}
                                                onMouseEnter={(e) => e.target.style.opacity = 1}
                                                onMouseLeave={(e) => e.target.style.opacity = 0.6}
                                            >🗑️</button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div style={{ padding: '20px 32px', background: 'rgba(31, 41, 55, 0.2)', display: 'flex', justifyContent: 'center' }}>
                                <button
                                    onClick={() => setActiveTab('configurator')}
                                    style={{
                                        background: 'none', border: `1px dashed ${colors.border}`, color: colors.muted,
                                        padding: '8px 24px', borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                        transition: 'all 0.3s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.borderColor = colors.accent;
                                        e.target.style.color = colors.text;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.borderColor = colors.border;
                                        e.target.style.color = colors.muted;
                                    }}
                                >
                                    + ADD NEW BUSINESS RULE
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

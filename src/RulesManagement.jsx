import React, { useState, useEffect, useRef } from 'react';

// ─── Constants ───
const RULE_TYPES = [
    {
        id: 'threshold',
        name: 'Threshold Rule',
        description: 'Compares a numeric field against a specific value (e.g., Amount ≤ $5000).',
        fields: ['field_name', 'operator', 'value'],
        operators: ['lte', 'lt', 'gte', 'gt'],
        exampleFields: ['claimAmount', 'completeness', 'fraudScore', 'claimNumber', 'policyNumber', 'claimantName', 'claimantId', 'claimType', 'policyStatus', 'incidentDate', 'filingDate', 'providerName', 'contactNumber']
    },
    {
        id: 'comparison',
        name: 'Comparison Rule',
        description: 'Matches a field value exactly (e.g., Policy Status = "Active").',
        fields: ['field_name', 'operator', 'value'],
        operators: ['eq'],
        exampleFields: ['policyStatus', 'claimType', 'providerName', 'claimAmount', 'completeness', 'fraudScore', 'claimNumber', 'policyNumber', 'claimantName', 'claimantId', 'incidentDate', 'filingDate', 'contactNumber']
    },
    {
        id: 'cross_field',
        name: 'Cross-Field Analysis',
        description: 'Validates relationships between multiple fields (e.g., duplicate checks).',
        fields: ['field_name', 'operator'],
        operators: ['not_duplicate'],
        exampleFields: ['claimNumber', 'policyNumber', 'claimantId']
    },
];

const API_URL = import.meta.env.PROD ? "" : "http://localhost:8000";

const OP_LABELS = {
    lte: '≤', lt: '<', gte: '≥', gt: '>', eq: '=', not_duplicate: 'NOT DUPLICATE'
};

// Dynamically generate a human-readable description from rule config
function generateDescription(rule) {
    const config = rule.config || {};
    const val = config.value;
    const op = config.operator || '';
    const field = config.field_name || '';
    if (rule.rule_type === 'cross_field' || op === 'not_duplicate') {
        return rule.description || 'Cross-field validation';
    }
    if (val !== undefined && val !== null && field && op) {
        const opLabel = OP_LABELS[op] || op;
        let formattedVal;
        if (field === 'claimAmount' && !isNaN(val)) {
            formattedVal = `$${Number(val).toLocaleString()}`;
        } else if (['completeness', 'fraudScore'].includes(field) && !isNaN(val)) {
            formattedVal = `${val}%`;
        } else {
            formattedVal = String(val);
        }
        return `${field} ${opLabel} ${formattedVal}`;
    }
    return rule.description || '';
}

// Simple markdown-to-HTML renderer for chat messages
function renderMarkdown(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^(\s*)• /gm, '$1<span style="color:#f59e0b">•</span> ')
        .replace(/^(\s*)✅/gm, '$1<span style="color:#10b981">✅</span>')
        .replace(/^(\s*)⚠️/gm, '$1<span style="color:#f59e0b">⚠️</span>')
        .replace(/^(\s*)🔍/gm, '$1<span style="color:#93c5fd">🔍</span>')
        .replace(/^(\s*)📋/gm, '$1<span style="color:#f59e0b">📋</span>')
        .replace(/^(\s*)📝/gm, '$1<span style="color:#93c5fd">📝</span>')
        .replace(/^(\s*)📊/gm, '$1<span style="color:#10b981">📊</span>')
        .replace(/^(\s*)1️⃣/gm, '$1<span style="color:#f59e0b">1️⃣</span>')
        .replace(/^(\s*)2️⃣/gm, '$1<span style="color:#f59e0b">2️⃣</span>')
        .replace(/^(\s*)3️⃣/gm, '$1<span style="color:#f59e0b">3️⃣</span>')
        .replace(/\n/g, '<br/>');
}

export default function RulesManagement({ colors, getToken }) {
    const [activeTab, setActiveTab] = useState('registry');
    const [rules, setRules] = useState([]);
    const [deletingRuleId, setDeletingRuleId] = useState(null);
    const [editingRule, setEditingRule] = useState(null);
    const [editForm, setEditForm] = useState({});
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
    const [savingEditId, setSavingEditId] = useState(null);
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
    const [loading, setLoading] = useState(true);
    const [selectedType, setSelectedType] = useState(null);
    const [saving, setSaving] = useState(false);

    // Configurator form state
    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formWeight, setFormWeight] = useState(30);
    const [formConfig, setFormConfig] = useState({});

    // Chatbot State
    const [messages, setMessages] = useState([
        { role: 'ai', content: 'Hello! I\'m your AI Rules Assistant. I can help you create new business rules step by step.\n\nTry saying something like:\n• "Create a rule for claims over $10,000"\n• "I need a rule to check policy status"\n• "Add a duplicate detection rule"\n\nOr just say "I want to add a new rule" and I\'ll guide you!' }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [chatStep, setChatStep] = useState('initial');
    const [chatCollected, setChatCollected] = useState({});
    const [chatFieldIndex, setChatFieldIndex] = useState(0);
    const [chatLoading, setChatLoading] = useState(false);
    const chatEndRef = useRef(null);

    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // ─── Fetch Rules from DB ───
    const fetchRules = async () => {
        setLoading(true);
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/rules`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.status === "success") {
                setRules(data.rules);
            }
        } catch (err) {
            console.error("❌ [Rules] Error fetching:", err);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchRules();
    }, []);

    // ─── Rule Actions ───
    const updateRule = async (rule) => {
        try {
            const token = await getToken();
            await fetch(`${API_URL}/rules/${rule.id}`, {
                method: "PUT",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(rule)
            });
        } catch (err) {
            console.error("❌ [Rules] Error updating:", err);
        }
    };

    const deleteRuleById = async (id) => {
        try {
            setDeletingRuleId(id);
            const token = await getToken();
            const fetchPromise = fetch(`${API_URL}/rules/${id}`, {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${token}` }
            });
            // Ensure the deleting state is shown for at least 2.5 seconds
            const delayPromise = new Promise(res => setTimeout(res, 2500));
            await Promise.all([fetchPromise, delayPromise]);

            setRules(prev => prev.filter(r => r.id !== id));
        } catch (err) {
            console.error("❌ [Rules] Error deleting:", err);
        } finally {
            setDeletingRuleId(null);
        }
    };

    const toggleRule = async (id) => {
        const rule = rules.find(r => r.id === id);
        if (!rule) return;
        const updated = { ...rule, is_active: !rule.is_active };
        setRules(prev => prev.map(r => r.id === id ? updated : r));
        await updateRule(updated);
    };

    const updateThreshold = async (id, newValue) => {
        const rule = rules.find(r => r.id === id);
        if (!rule) return;
        const updated = { ...rule, config: { ...rule.config, value: newValue } };
        // Also update the description dynamically
        updated.description = generateDescription(updated);
        setRules(prev => prev.map(r => r.id === id ? updated : r));
        return updated;
    };

    const persistThreshold = async (rule) => {
        // Ensure description is up-to-date before persisting
        const withDesc = { ...rule, description: generateDescription(rule) };
        await updateRule(withDesc);
    };

    const startEditing = (rule) => {
        setEditingRule(rule.id);
        setEditForm({
            name: rule.name,
            description: rule.description || '',
            config: { ...rule.config },
        });
    };

    const cancelEditing = () => {
        setEditingRule(null);
        setEditForm({});
    };

    const saveEdit = async (rule) => {
        setSavingEditId(rule.id);
        try {
            const updated = { ...rule, name: editForm.name, description: editForm.description, config: editForm.config };
            // Regenerate description from new config
            updated.description = generateDescription(updated);
            setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
            await updateRule(updated);
        } finally {
            setSavingEditId(null);
            setEditingRule(null);
            setEditForm({});
        }
    };

    const startEditing = (rule) => {
        setEditingRule(rule.id);
        setEditForm({
            name: rule.name,
            description: rule.description || '',
            config: { ...rule.config },
        });
    };

    const cancelEditing = () => {
        setEditingRule(null);
        setEditForm({});
    };

    const saveEdit = async (rule) => {
        const updated = { ...rule, name: editForm.name, description: editForm.description, config: editForm.config };
        setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
        await updateRule(updated);
        setEditingRule(null);
        setEditForm({});
    };

    const startEditing = (rule) => {
        setEditingRule(rule.id);
        setEditForm({
            name: rule.name,
            description: rule.description || '',
            config: { ...rule.config },
        });
    };

    const cancelEditing = () => {
        setEditingRule(null);
        setEditForm({});
    };

    const saveEdit = async (rule) => {
        const updated = { ...rule, name: editForm.name, description: editForm.description, config: editForm.config };
        setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
        await updateRule(updated);
        setEditingRule(null);
        setEditForm({});
    };

    const startEditing = (rule) => {
        setEditingRule(rule.id);
        setEditForm({
            name: rule.name,
            description: rule.description || '',
            config: { ...rule.config },
        });
    };

    const cancelEditing = () => {
        setEditingRule(null);
        setEditForm({});
    };

    const saveEdit = async (rule) => {
        const updated = { ...rule, name: editForm.name, description: editForm.description, config: editForm.config };
        setRules(prev => prev.map(r => r.id === rule.id ? updated : r));
        await updateRule(updated);
        setEditingRule(null);
        setEditForm({});
    };

    // ─── Deploy Rule from Configurator ───
    const deployRule = async () => {
        if (!selectedType || !formName.trim()) return;
        setSaving(true);
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/rules`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: formName,
                    description: formDescription,
                    rule_type: selectedType.id,
                    weight: formWeight,
                    config: formConfig,
                })
            });
            const data = await res.json();
            if (data.status === "success") {
                await fetchRules();
                setSelectedType(null);
                setFormName('');
                setFormDescription('');
                setFormWeight(30);
                setFormConfig({});
                setActiveTab('registry');
            }
        } catch (err) {
            console.error("❌ [Rules] Error deploying:", err);
        }
        setSaving(false);
    };

    // ─── Chatbot ───
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputValue.trim() || chatLoading) return;

        const userMsg = { role: 'user', content: inputValue };
        setMessages(prev => [...prev, userMsg]);
        const currentInput = inputValue;
        setInputValue('');
        setChatLoading(true);

        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/rules/ai-assist`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: currentInput,
                    context: {
                        step: chatStep,
                        collected: chatCollected,
                        current_field_index: chatFieldIndex,
                    }
                })
            });
            const data = await res.json();

            if (data.status === "success") {
                setMessages(prev => [...prev, { role: 'ai', content: data.response }]);
                setChatStep(data.next_step || 'initial');
                setChatCollected(data.collected || {});
                setChatFieldIndex(data.current_field_index || 0);

                if (data.rule) {
                    // Rule deployed! Refresh registry
                    await fetchRules();
                    setChatCollected({});
                    setChatFieldIndex(0);
                    setChatStep('initial');
                }
            }
        } catch (err) {
            console.error("❌ [Chat] Error:", err);
            setMessages(prev => [...prev, { role: 'ai', content: 'Sorry, something went wrong. Please try again.' }]);
        }
        setChatLoading(false);
    };

    const inputStyle = {
        width: '100%', background: 'rgba(17, 24, 39, 0.6)', border: `1px solid ${colors.border}`,
        borderRadius: 8, padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none',
        transition: 'border-color 0.2s ease'
    };

    const selectStyle = {
        ...inputStyle, cursor: 'pointer', appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%236b7280' viewBox='0 0 16 16'%3E%3Cpath d='M8 12L2 6h12z'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 32
    };

    return (
        <div style={{ animation: 'fadeIn 0.5s ease', height: '100%', display: 'flex', flexDirection: 'column' }}>

            {/* ── Tabs ── */}
            <div style={{ display: 'flex', gap: 32, borderBottom: `1px solid ${colors.border}`, marginBottom: 24, padding: '0 8px' }}>
                {[
                    { id: 'registry', label: 'RULE REGISTRY', icon: '📋' },
                    { id: 'configurator', label: 'RULE CONFIGURATOR', icon: '🛠️' },
                    { id: 'chatbot', label: 'AI INTELLIGENCE', icon: '🤖' },
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

                {/* ══════════════════════════════════════════════════════════ */}
                {/* Section 1: Registry (with Analysis Settings merged in)   */}
                {/* ══════════════════════════════════════════════════════════ */}
                {activeTab === 'registry' && (
                    <div style={{ animation: 'slideIn 0.4s ease' }}>
                        {loading ? (
                            <div style={{ textAlign: 'center', padding: '60px 0', color: colors.muted }}>
                                <div style={{ width: 40, height: 40, border: `3px solid ${colors.dim}`, borderTopColor: colors.accent, borderRadius: '50%', animation: 'spin 0.9s linear infinite', margin: '0 auto 16px' }} />
                                Loading rules...
                            </div>
                        ) : (
                            <div style={{ border: `1px solid ${colors.border}`, borderRadius: 20, overflow: 'hidden', background: 'rgba(13, 17, 23, 0.4)', backdropFilter: 'blur(10px)' }}>
                                <div style={{ padding: '24px 32px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: 16, fontWeight: 800 }}>ACTIVE RULESET</div>
                                        <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Managing {rules.length} automated decision nodes — changes persist to database</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 12 }}>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 10, color: colors.muted, fontWeight: 700 }}>SYSTEM STATUS</div>
                                            <div style={{ fontSize: 12, color: '#10b981', fontWeight: 800 }}>OPTIMIZED</div>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    {rules.map((rule, idx) => {
                                        const isThreshold = rule.rule_type === 'threshold';
                                        const configValue = rule.config?.value;
                                        const fieldName = rule.config?.field_name || '';
                                        const isAmount = fieldName === 'claimAmount';

                                        return (
                                            <div key={rule.id} style={{
                                                padding: editingRule === rule.id ? '0' : '24px 32px',
                                                borderBottom: idx === rules.length - 1 ? 'none' : `1px solid ${colors.border}`,
                                                transition: 'all 0.3s ease', opacity: rule.is_active ? 1 : 0.4
                                            }}>
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
                                                {editingRule === rule.id ? (
                                                    /* ── Edit Mode: Expanded Card ── */
                                                    <div style={{
                                                        background: 'rgba(245, 158, 11, 0.04)',
                                                        border: `1.5px solid ${colors.accent}44`,
                                                        borderRadius: 14,
                                                        padding: '24px 28px',
                                                        margin: '12px 0',
                                                        animation: 'fadeIn 0.25s ease',
                                                        boxShadow: `0 0 24px ${colors.accent}11`
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                                <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: colors.accent, fontSize: 14 }}>{rule.id}</span>
                                                                <span style={{ fontSize: 10, color: colors.accent, background: `${colors.accent}18`, padding: '3px 10px', borderRadius: 6, fontWeight: 800, letterSpacing: '0.05em' }}>EDITING</span>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: 10 }}>
                                                                <button
                                                                    onClick={() => saveEdit(rule)}
                                                                    disabled={savingEditId === rule.id}
                                                                    style={{
                                                                        background: 'rgba(16, 185, 129, 0.12)', border: '1.5px solid rgba(16, 185, 129, 0.5)', color: '#10b981',
                                                                        fontSize: 12, fontWeight: 800, cursor: savingEditId === rule.id ? 'wait' : 'pointer',
                                                                        borderRadius: 8, padding: '7px 18px', transition: '0.2s',
                                                                        display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Barlow', sans-serif"
                                                                    }}
                                                                    onMouseEnter={(e) => { if (savingEditId !== rule.id) e.currentTarget.style.background = 'rgba(16, 185, 129, 0.22)'; }}
                                                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.12)'; }}
                                                                >
                                                                    {savingEditId === rule.id ? (
                                                                        <><div style={{ width: 12, height: 12, border: '2px solid rgba(16,185,129,0.3)', borderTopColor: '#10b981', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />SAVING...</>
                                                                    ) : '✓ SAVE'}
                                                                </button>
                                                                <button
                                                                    onClick={cancelEditing}
                                                                    style={{
                                                                        background: 'rgba(107, 114, 128, 0.1)', border: '1.5px solid rgba(107, 114, 128, 0.3)', color: '#9ca3af',
                                                                        fontSize: 12, fontWeight: 800, cursor: 'pointer',
                                                                        borderRadius: 8, padding: '7px 18px', transition: '0.2s', fontFamily: "'Barlow', sans-serif"
                                                                    }}
                                                                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(107, 114, 128, 0.2)'; }}
                                                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(107, 114, 128, 0.1)'; }}
                                                                >✗ CANCEL</button>
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: colors.muted, fontFamily: 'IBM Plex Mono', marginBottom: 8, letterSpacing: '0.06em' }}>RULE NAME</label>
                                                                <input
                                                                    type="text"
                                                                    value={editForm.name || ''}
                                                                    onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                                                    style={{
                                                                        width: '100%', background: 'rgba(17, 24, 39, 0.7)', border: `1.5px solid ${colors.border}`,
                                                                        borderRadius: 8, padding: '10px 14px', color: '#fff', fontSize: 14, fontWeight: 600,
                                                                        outline: 'none', fontFamily: "'Barlow', sans-serif", transition: 'border-color 0.2s',
                                                                        boxSizing: 'border-box'
                                                                    }}
                                                                    onFocus={(e) => e.target.style.borderColor = colors.accent}
                                                                    onBlur={(e) => e.target.style.borderColor = colors.border}
                                                                    placeholder="Rule name"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: colors.muted, fontFamily: 'IBM Plex Mono', marginBottom: 8, letterSpacing: '0.06em' }}>
                                                                    {isThreshold ? 'THRESHOLD VALUE' : 'CONFIG VALUE'}
                                                                </label>
                                                                <input
                                                                    type={isThreshold ? 'number' : 'text'}
                                                                    value={isThreshold ? (editForm.config?.value || 0) : (editForm.config?.value || '')}
                                                                    onChange={e => {
                                                                        const v = e.target.value;
                                                                        setEditForm(prev => ({ ...prev, config: { ...prev.config, value: isThreshold ? (parseInt(v) || 0) : (isNaN(v) ? v : Number(v)) } }));
                                                                    }}
                                                                    style={{
                                                                        width: '100%', background: 'rgba(17, 24, 39, 0.7)', border: `1.5px solid ${colors.border}`,
                                                                        borderRadius: 8, padding: '10px 14px', color: '#fff', fontSize: 14, fontWeight: 700,
                                                                        outline: 'none', fontFamily: 'IBM Plex Mono', transition: 'border-color 0.2s',
                                                                        boxSizing: 'border-box'
                                                                    }}
                                                                    onFocus={(e) => e.target.style.borderColor = colors.accent}
                                                                    onBlur={(e) => e.target.style.borderColor = colors.border}
                                                                    placeholder={isThreshold ? '5000' : 'active'}
                                                                />
                                                            </div>
                                                            <div style={{ gridColumn: '1 / -1' }}>
                                                                <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: colors.muted, fontFamily: 'IBM Plex Mono', marginBottom: 8, letterSpacing: '0.06em' }}>DESCRIPTION</label>
                                                                <input
                                                                    type="text"
                                                                    value={editForm.description || ''}
                                                                    onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                                                    style={{
                                                                        width: '100%', background: 'rgba(17, 24, 39, 0.7)', border: `1.5px solid ${colors.border}`,
                                                                        borderRadius: 8, padding: '10px 14px', color: '#9ca3af', fontSize: 13,
                                                                        outline: 'none', fontFamily: "'Barlow', sans-serif", transition: 'border-color 0.2s',
                                                                        boxSizing: 'border-box'
                                                                    }}
                                                                    onFocus={(e) => e.target.style.borderColor = colors.accent}
                                                                    onBlur={(e) => e.target.style.borderColor = colors.border}
                                                                    placeholder="What does this rule check?"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    /* ── View Mode: Standard Grid Row ── */
                                                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 220px 140px 100px', alignItems: 'center', gap: 24 }}>
                                                        <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: colors.accent, fontSize: 13 }}>{rule.id}</div>

                                                        <div>
                                                            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{rule.name}</div>
                                                            <div style={{ fontSize: 12, color: colors.muted }}>{generateDescription(rule)}</div>
                                                        </div>

                                                        <div>
=======
                                                <div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 220px 140px 100px', alignItems: 'center', gap: 24 }}>
                                                        <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: colors.accent, fontSize: 13 }}>{rule.id}</div>

                                                        <div>
                                                            {editingRule === rule.id ? (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.name || ''}
                                                                        onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                                                        style={{
                                                                            width: '100%', background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.accent}`,
                                                                            borderRadius: 6, padding: '6px 10px', color: '#fff', fontSize: 14, fontWeight: 700,
                                                                            outline: 'none', fontFamily: "'Barlow', sans-serif"
                                                                        }}
                                                                        placeholder="Rule name"
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.description || ''}
                                                                        onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                                                        style={{
                                                                            width: '100%', background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.border}`,
                                                                            borderRadius: 6, padding: '5px 10px', color: '#9ca3af', fontSize: 12,
                                                                            outline: 'none', fontFamily: "'Barlow', sans-serif"
                                                                        }}
                                                                        placeholder="Description"
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{rule.name}</div>
                                                                    <div style={{ fontSize: 12, color: colors.muted }}>{rule.description}</div>
                                                                </>
                                                            )}
                                                        </div>

                                                        <div>
>>>>>>> Stashed changes
=======
                                                <div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 220px 140px 100px', alignItems: 'center', gap: 24 }}>
                                                        <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: colors.accent, fontSize: 13 }}>{rule.id}</div>

                                                        <div>
                                                            {editingRule === rule.id ? (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.name || ''}
                                                                        onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                                                        style={{
                                                                            width: '100%', background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.accent}`,
                                                                            borderRadius: 6, padding: '6px 10px', color: '#fff', fontSize: 14, fontWeight: 700,
                                                                            outline: 'none', fontFamily: "'Barlow', sans-serif"
                                                                        }}
                                                                        placeholder="Rule name"
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.description || ''}
                                                                        onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                                                        style={{
                                                                            width: '100%', background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.border}`,
                                                                            borderRadius: 6, padding: '5px 10px', color: '#9ca3af', fontSize: 12,
                                                                            outline: 'none', fontFamily: "'Barlow', sans-serif"
                                                                        }}
                                                                        placeholder="Description"
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{rule.name}</div>
                                                                    <div style={{ fontSize: 12, color: colors.muted }}>{rule.description}</div>
                                                                </>
                                                            )}
                                                        </div>

                                                        <div>
>>>>>>> Stashed changes
=======
                                                <div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 220px 140px 100px', alignItems: 'center', gap: 24 }}>
                                                        <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: colors.accent, fontSize: 13 }}>{rule.id}</div>

                                                        <div>
                                                            {editingRule === rule.id ? (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.name || ''}
                                                                        onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                                                        style={{
                                                                            width: '100%', background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.accent}`,
                                                                            borderRadius: 6, padding: '6px 10px', color: '#fff', fontSize: 14, fontWeight: 700,
                                                                            outline: 'none', fontFamily: "'Barlow', sans-serif"
                                                                        }}
                                                                        placeholder="Rule name"
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.description || ''}
                                                                        onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                                                        style={{
                                                                            width: '100%', background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.border}`,
                                                                            borderRadius: 6, padding: '5px 10px', color: '#9ca3af', fontSize: 12,
                                                                            outline: 'none', fontFamily: "'Barlow', sans-serif"
                                                                        }}
                                                                        placeholder="Description"
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{rule.name}</div>
                                                                    <div style={{ fontSize: 12, color: colors.muted }}>{rule.description}</div>
                                                                </>
                                                            )}
                                                        </div>

                                                        <div>
>>>>>>> Stashed changes
                                                            <div style={{ fontSize: 10, color: colors.muted, fontWeight: 700, marginBottom: 8, fontFamily: 'IBM Plex Mono' }}>
                                                                {isThreshold ? 'THRESHOLD' : 'CONFIG'}
                                                            </div>
                                                            {isThreshold ? (
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                                    <input
                                                                        type="range"
                                                                        min={isAmount ? 1000 : 0}
                                                                        max={isAmount ? 100000 : 100}
                                                                        step={isAmount ? 1000 : 5}
                                                                        value={configValue || 0}
                                                                        disabled={!rule.is_active}
                                                                        style={{ flex: 1, accentColor: colors.accent, cursor: rule.is_active ? 'pointer' : 'not-allowed' }}
                                                                        onChange={(e) => updateThreshold(rule.id, parseInt(e.target.value))}
                                                                        onMouseUp={() => {
                                                                            const current = rules.find(r => r.id === rule.id);
                                                                            if (current) persistThreshold(current);
                                                                        }}
                                                                    />
                                                                    <span style={{ fontSize: 12, fontWeight: 800, minWidth: 70, textAlign: 'right' }}>
                                                                        {isAmount ? `$${(configValue || 0).toLocaleString()}` : `${configValue || 0}%`}
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <div style={{ fontSize: 13, fontWeight: 700 }}>
                                                                    {rule.config?.operator ? `${OP_LABELS[rule.config.operator] || rule.config.operator} ${rule.config.value || ''}` : '—'}
                                                                </div>
=======
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
                                                                editingRule === rule.id ? (
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                                        <input
                                                                            type="number"
                                                                            value={editForm.config?.value || 0}
                                                                            onChange={e => setEditForm(prev => ({ ...prev, config: { ...prev.config, value: parseInt(e.target.value) || 0 } }))}
                                                                            style={{
                                                                                width: 100, background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.accent}`,
                                                                                borderRadius: 6, padding: '6px 10px', color: '#fff', fontSize: 13, fontWeight: 700,
                                                                                outline: 'none', textAlign: 'right', fontFamily: "IBM Plex Mono"
                                                                            }}
                                                                        />
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                                        <input
                                                                            type="range"
                                                                            min={isAmount ? 1000 : 0}
                                                                            max={isAmount ? 100000 : 100}
                                                                            step={isAmount ? 1000 : 5}
                                                                            value={configValue || 0}
                                                                            disabled={!rule.is_active}
                                                                            style={{ flex: 1, accentColor: colors.accent, cursor: rule.is_active ? 'pointer' : 'not-allowed' }}
                                                                            onChange={(e) => updateThreshold(rule.id, parseInt(e.target.value))}
                                                                            onMouseUp={() => {
                                                                                const current = rules.find(r => r.id === rule.id);
                                                                                if (current) persistThreshold(current);
                                                                            }}
                                                                        />
                                                                        <span style={{ fontSize: 12, fontWeight: 800, minWidth: 70, textAlign: 'right' }}>
                                                                            {isAmount ? `$${(configValue || 0).toLocaleString()}` : `${configValue || 0}%`}
                                                                        </span>
                                                                    </div>
                                                                )
                                                            ) : (
                                                                editingRule === rule.id ? (
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.config?.value || ''}
                                                                        onChange={e => {
                                                                            const v = e.target.value;
                                                                            setEditForm(prev => ({ ...prev, config: { ...prev.config, value: isNaN(v) ? v : Number(v) } }));
                                                                        }}
                                                                        style={{
                                                                            width: '100%', background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.accent}`,
                                                                            borderRadius: 6, padding: '6px 10px', color: '#fff', fontSize: 13, fontWeight: 700,
                                                                            outline: 'none', fontFamily: "IBM Plex Mono"
                                                                        }}
                                                                        placeholder="Value"
                                                                    />
                                                                ) : (
                                                                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                                                                        {rule.config?.operator ? `${OP_LABELS[rule.config.operator] || rule.config.operator} ${rule.config.value || ''}` : '—'}
                                                                    </div>
                                                                )
<<<<<<< Updated upstream
<<<<<<< Updated upstream
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
                                                            )}
                                                        </div>

                                                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                            <button
                                                                onClick={() => toggleRule(rule.id)}
                                                                style={{
                                                                    background: rule.is_active ? 'rgba(16, 185, 129, 0.1)' : 'rgba(31, 41, 55, 0.4)',
                                                                    color: rule.is_active ? '#10b981' : colors.muted,
                                                                    border: `1px solid ${rule.is_active ? '#10b981' : colors.border}`,
                                                                    padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                                                                    transition: 'all 0.3s ease'
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
                                                                }}
                                                            >
                                                                {rule.is_active ? 'ENABLED' : 'DISABLED'}
                                                            </button>
                                                        </div>

                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                                            <button
                                                                onClick={() => startEditing(rule)}
                                                                style={{
                                                                    background: 'none', border: 'none', color: colors.accent,
                                                                    fontSize: 16, cursor: 'pointer', opacity: 0.6, transition: '0.2s'
                                                                }}
                                                                onMouseEnter={(e) => e.target.style.opacity = 1}
                                                                onMouseLeave={(e) => e.target.style.opacity = 0.6}
                                                                title="Edit rule"
                                                            >✏️</button>
                                                            {deletingRuleId === rule.id ? (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontSize: 12, fontWeight: 800 }}>
                                                                    <div style={{ width: 14, height: 14, border: '2px solid rgba(239, 68, 68, 0.3)', borderTopColor: '#ef4444', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                                                    DELETING...
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => deleteRuleById(rule.id)}
                                                                    style={{
                                                                        background: 'none', border: 'none', color: '#ef4444',
                                                                        fontSize: 18, cursor: 'pointer', opacity: 0.6, transition: '0.2s'
                                                                    }}
                                                                    onMouseEnter={(e) => e.target.style.opacity = 1}
                                                                    onMouseLeave={(e) => e.target.style.opacity = 0.6}
                                                                >🗑️</button>
=======
                                                                }}
=======
                                                                }}
>>>>>>> Stashed changes
=======
                                                                }}
>>>>>>> Stashed changes
                                                            >
                                                                {rule.is_active ? 'ENABLED' : 'DISABLED'}
                                                            </button>
                                                        </div>

                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                                            {editingRule === rule.id ? (
                                                                <>
                                                                    <button
                                                                        onClick={() => saveEdit(rule)}
                                                                        style={{
                                                                            background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#10b981',
                                                                            fontSize: 13, cursor: 'pointer', borderRadius: 6, padding: '4px 10px', transition: '0.2s',
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                                        }}
                                                                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)'; }}
                                                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)'; }}
                                                                        title="Save changes"
                                                                    >✓</button>
                                                                    <button
                                                                        onClick={cancelEditing}
                                                                        style={{
                                                                            background: 'rgba(107, 114, 128, 0.15)', border: '1px solid rgba(107, 114, 128, 0.4)', color: '#9ca3af',
                                                                            fontSize: 13, cursor: 'pointer', borderRadius: 6, padding: '4px 10px', transition: '0.2s',
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                                        }}
                                                                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(107, 114, 128, 0.25)'; }}
                                                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(107, 114, 128, 0.15)'; }}
                                                                        title="Cancel"
                                                                    >✗</button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        onClick={() => startEditing(rule)}
                                                                        style={{
                                                                            background: 'none', border: 'none', color: colors.accent,
                                                                            fontSize: 16, cursor: 'pointer', opacity: 0.6, transition: '0.2s'
                                                                        }}
                                                                        onMouseEnter={(e) => e.target.style.opacity = 1}
                                                                        onMouseLeave={(e) => e.target.style.opacity = 0.6}
                                                                        title="Edit rule"
                                                                    >✏️</button>
                                                                    {deletingRuleId === rule.id ? (
                                                                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#ef4444", fontSize: 12, fontWeight: 800 }}>
                                                                            <div style={{ width: 14, height: 14, border: `2px solid rgba(239, 68, 68, 0.3)`, borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                                                                            DELETING...
                                                                        </div>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => deleteRuleById(rule.id)}
                                                                            style={{
                                                                                background: 'none', border: 'none', color: '#ef4444',
                                                                                fontSize: 18, cursor: 'pointer', opacity: 0.6, transition: '0.2s'
                                                                            }}
                                                                            onMouseEnter={(e) => e.target.style.opacity = 1}
                                                                            onMouseLeave={(e) => e.target.style.opacity = 0.6}
                                                                        >🗑️</button>
                                                                    )}
                                                                </>
<<<<<<< Updated upstream
<<<<<<< Updated upstream
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
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
                        )}
                    </div>
                )}

                {/* ══════════════════════════════════════════ */}
                {/* Section 2: Configurator (DB-backed)       */}
                {/* ══════════════════════════════════════════ */}
                {activeTab === 'configurator' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, animation: 'slideIn 0.4s ease' }}>
                        {/* Type Selector */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: colors.muted, fontFamily: 'IBM Plex Mono', marginBottom: 8 }}>SELECT RULE TYPE</div>
                            {RULE_TYPES.map(type => (
                                <div
                                    key={type.id}
                                    onClick={() => {
                                        setSelectedType(type);
                                        setFormConfig({});
                                    }}
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
                                            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 10 }}>RULE NAME *</label>
                                            <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Audit Large Medical Claims" style={inputStyle} />
                                        </div>
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 10 }}>DESCRIPTION</label>
                                            <input type="text" value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="What does this rule check?" style={inputStyle} />
                                        </div>

                                        {selectedType.fields.includes('field_name') && (
                                            <div>
                                                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 10 }}>FIELD NAME</label>
                                                <select
                                                    value={formConfig.field_name || ''}
                                                    onChange={e => setFormConfig(prev => ({ ...prev, field_name: e.target.value }))}
                                                    style={selectStyle}
                                                >
                                                    <option value="">Select field...</option>
                                                    {selectedType.exampleFields.map(f => <option key={f} value={f}>{f}</option>)}
                                                </select>
                                            </div>
                                        )}

                                        {selectedType.fields.includes('operator') && (
                                            <div>
                                                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 10 }}>OPERATOR</label>
                                                <select
                                                    value={formConfig.operator || ''}
                                                    onChange={e => setFormConfig(prev => ({ ...prev, operator: e.target.value }))}
                                                    style={selectStyle}
                                                >
                                                    <option value="">Select operator...</option>
                                                    {selectedType.operators.map(op => <option key={op} value={op}>{OP_LABELS[op] || op} ({op})</option>)}
                                                </select>
                                            </div>
                                        )}

                                        {selectedType.fields.includes('value') && (
                                            <div>
                                                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 10 }}>VALUE</label>
                                                <input
                                                    type="text"
                                                    value={formConfig.value || ''}
                                                    onChange={e => {
                                                        const v = e.target.value;
                                                        setFormConfig(prev => ({ ...prev, value: isNaN(v) ? v : Number(v) }));
                                                    }}
                                                    placeholder="e.g. 5000 or active"
                                                    style={inputStyle}
                                                />
                                            </div>
                                        )}

                                        <div>
                                            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: colors.muted, marginBottom: 10 }}>WEIGHT</label>
                                            <input type="number" min={1} max={100} value={formWeight} onChange={e => setFormWeight(parseInt(e.target.value) || 30)} style={inputStyle} />
                                        </div>
                                    </div>

                                    <div style={{ marginTop: 40, display: 'flex', gap: 16 }}>
                                        <button
                                            onClick={deployRule}
                                            disabled={saving || !formName.trim()}
                                            style={{
                                                flex: 1, background: (saving || !formName.trim()) ? colors.dim : colors.accent,
                                                color: (saving || !formName.trim()) ? colors.muted : '#000', border: 'none', borderRadius: 10,
                                                padding: '14px 0', fontWeight: 800, cursor: (saving || !formName.trim()) ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.3s ease'
                                            }}
                                        >{saving ? 'DEPLOYING...' : 'DEPLOY RULE'}</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'chatbot' && (
                    <div style={{
                        height: '600px', display: 'flex', flexDirection: 'column',
                        background: 'rgba(13, 17, 23, 0.4)', borderRadius: 20, border: `1px solid ${colors.border}`,
                        overflow: 'hidden', backdropFilter: 'blur(10px)', animation: 'slideIn 0.4s ease'
                    }}>
                        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${colors.border}`, background: 'rgba(245, 158, 11, 0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: colors.accent }}>AI RULES ASSISTANT</div>
                                <div style={{ fontSize: 11, color: colors.muted }}>Conversational Rule Builder — Powered by LangGraph</div>
                            </div>
                            {chatStep !== 'initial' && (
                                <button
                                    onClick={() => {
                                        setChatStep('initial');
                                        setChatCollected({});
                                        setChatFieldIndex(0);
                                        setMessages(prev => [...prev, { role: 'ai', content: 'Conversation reset. What would you like to do?' }]);
                                    }}
                                    style={{
                                        background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)',
                                        borderRadius: 8, padding: '6px 14px', fontSize: 10, fontWeight: 800, cursor: 'pointer'
                                    }}
                                >RESET</button>
                            )}
                        </div>

                        <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {messages.map((m, i) => (
                                <div key={i} style={{
                                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                                    maxWidth: '80%', display: 'flex', flexDirection: 'column',
                                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                                    animation: 'fadeIn 0.3s ease'
                                }}>
                                    <div style={{
                                        padding: '12px 18px', borderRadius: m.role === 'user' ? '18px 18px 2px 18px' : '18px 18px 18px 2px',
                                        background: m.role === 'user' ? colors.accent : 'rgba(31, 41, 55, 0.6)',
                                        color: m.role === 'user' ? '#000' : '#e5e7eb',
                                        fontSize: 14, lineHeight: 1.6, fontWeight: 500,
                                        boxShadow: m.role === 'user' ? `0 4px 15px ${colors.accent}33` : 'none',
                                        border: m.role === 'user' ? 'none' : `1px solid ${colors.border}`,
                                        whiteSpace: 'pre-wrap'
                                    }}
                                        dangerouslySetInnerHTML={m.role === 'ai' ? { __html: renderMarkdown(m.content) } : undefined}
                                    >
                                        {m.role === 'user' ? m.content : null}
                                    </div>
                                    <div style={{ fontSize: 10, color: colors.muted, marginTop: 4, fontFamily: 'IBM Plex Mono' }}>
                                        {m.role === 'user' ? 'YOU' : '🤖 AI ASSISTANT'}
                                    </div>
                                </div>
                            ))}

                            {chatLoading && (
                                <div style={{
                                    alignSelf: 'flex-start', padding: '12px 18px',
                                    background: 'rgba(31, 41, 55, 0.6)', border: `1px solid ${colors.border}`,
                                    borderRadius: '18px 18px 18px 2px', display: 'flex', gap: 6, alignItems: 'center'
                                }}>
                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.accent, animation: 'pulse 1s infinite' }} />
                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.accent, animation: 'pulse 1s infinite 0.2s' }} />
                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.accent, animation: 'pulse 1s infinite 0.4s' }} />
                                </div>
                            )}

                            <div ref={chatEndRef} />
                        </div>

                        <form onSubmit={handleSendMessage} style={{ padding: 20, background: 'rgba(3, 7, 18, 0.4)', borderTop: `1px solid ${colors.border}` }}>
                            <div style={{ position: 'relative', display: 'flex', gap: 12 }}>
                                <input
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    placeholder={chatStep === 'initial' ? 'Describe the rule you want to create...' : 'Type your answer...'}
                                    disabled={chatLoading}
                                    style={{
                                        flex: 1, background: 'rgba(17, 24, 39, 0.8)', border: `1px solid ${colors.border}`,
                                        borderRadius: 12, padding: '14px 20px', color: '#fff', fontSize: 14,
                                        outline: 'none', transition: 'all 0.3s ease',
                                        opacity: chatLoading ? 0.5 : 1
                                    }}
                                    onFocus={(e) => e.target.style.borderColor = colors.accent}
                                    onBlur={(e) => e.target.style.borderColor = colors.border}
                                />
                                <button type="submit" disabled={chatLoading} style={{
                                    background: chatLoading ? colors.dim : colors.accent, color: chatLoading ? colors.muted : '#000',
                                    border: 'none', borderRadius: 12,
                                    padding: '0 24px', fontWeight: 800, fontSize: 13,
                                    cursor: chatLoading ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.3s ease', boxShadow: chatLoading ? 'none' : `0 4px 15px ${colors.accent}44`
                                }}>
                                    SEND
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}

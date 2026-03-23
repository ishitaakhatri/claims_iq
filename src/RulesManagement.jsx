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

// ─── Percentage Slider Component ───
function PercentageSlider({ label, onSubmit, colors }) {
    const [val, setVal] = React.useState(50);
    return (
        <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 10, fontFamily: 'IBM Plex Mono' }}>
                📊 {label.toUpperCase()} THRESHOLD
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <input
                    type="range" min={0} max={100} step={1} value={val}
                    onChange={e => setVal(Number(e.target.value))}
                    style={{ flex: 1, accentColor: colors.accent, cursor: 'pointer', height: 4 }}
                />
                <span style={{
                    minWidth: 48, textAlign: 'center', fontFamily: 'IBM Plex Mono',
                    fontWeight: 800, fontSize: 15, color: colors.accent
                }}>{val}%</span>
                <button
                    onClick={() => onSubmit(String(val))}
                    style={{
                        background: colors.accent, color: '#000', border: 'none',
                        borderRadius: 8, padding: '7px 16px', fontWeight: 800,
                        fontSize: 12, cursor: 'pointer', fontFamily: "'Barlow', sans-serif",
                        transition: 'opacity 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >Set</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4b5563', marginTop: 4, fontFamily: 'IBM Plex Mono' }}>
                <span>0%</span><span>50%</span><span>100%</span>
            </div>
        </div>
    );
}

// ─── Interactive Message Renderer ───
// Parses AI messages and replaces text prompts with interactive UI elements
function InteractiveMessage({ content, onQuickReply, colors, collectedFieldName }) {
    const [selectedRules, setSelectedRules] = React.useState([]);

    // Detect rule list pattern: lines like "  1. 🟢 **BR001** — Rule Name"
    const hasRuleList = /\d+\.\s+(?:🟢|🔴)\s+\*\*[A-Z0-9]+\*\*\s+—/.test(content);

    // Detect confirm/cancel pattern
    const hasConfirmCancel = /type\s+\*\*confirm\*\*.*\*\*cancel\*\*/i.test(content) ||
        /type\s+\*\*yes\*\*.*\*\*no\*\*/i.test(content) ||
        /type\s+\*\*yes\*\*\s+to\s+confirm/i.test(content);

    // Detect yes/no more changes pattern
    const hasYesNo = /type\s+\*\*yes\*\*\s+or\s+\*\*no\*\*/i.test(content);

    // Detect rule type selection (1️⃣ Threshold / 2️⃣ Comparison / 3️⃣ Cross-Field)
    const hasRuleTypeOptions = /1️⃣\s+Threshold Rule/.test(content);

    // Detect field_name selection (Available fields: 📊 Numeric / 📝 Text / 📅 Date)
    // Only show when explicitly asking for field_name, not for rule name
    const isAskingForFieldName = /please provide \*\*field_name\*\*/i.test(content) ||
        /step\s+\d+.*field_name/i.test(content);
    const hasFieldOptions = isAskingForFieldName && (
        /📊\s+Numeric:/.test(content) ||
        /📝\s+Text:/.test(content) ||
        /📅\s+Date/.test(content)
    );

    // Detect operator selection (Available operators: ≤ (lte), ...)
    const hasOperatorOptions = /Available operators:/i.test(content) && /\(lte\)|\(lt\)|\(gte\)|\(gt\)|\(eq\)|\(not_duplicate\)/.test(content);

    // Detect when asking for a value and the selected field is a date or percentage type
    const DATE_FIELDS = ['incidentDate', 'filingDate'];
    const PERCENTAGE_FIELDS = ['completeness', 'fraudScore'];
    const isValueStep = /please provide \*\*value\*\*/i.test(content);
    const isDateValueStep = isValueStep && DATE_FIELDS.includes(collectedFieldName);
    const isPercentageValueStep = isValueStep && PERCENTAGE_FIELDS.includes(collectedFieldName);

    // Detect deploy confirmation (Type **deploy** to create the rule)
    const hasDeployConfirm = /type\s+\*\*deploy\*\*\s+to\s+create/i.test(content);

    // Detect intent selection (add/delete/edit options)
    const hasIntentOptions = /➕.*\*\*Add\*\*.*\n.*🗑️.*\*\*Delete\*\*.*\n.*✏️.*\*\*Edit\*\*/s.test(content) ||
        /➕\s+add\s*\n.*🗑️\s+delete\s*\n.*✏️\s+edit/is.test(content);

    // Extract rule entries from the list
    const ruleEntries = [];
    if (hasRuleList) {
        const ruleRegex = /\d+\.\s+(🟢|🔴)\s+\*\*([A-Z0-9]+)\*\*\s+—\s+(.+)/g;
        let match;
        while ((match = ruleRegex.exec(content)) !== null) {
            ruleEntries.push({ status: match[1], id: match[2], name: match[3].trim() });
        }
    }

    // Strip the rule list lines and action hint lines from the text body
    let textBody = content;
    if (hasRuleList) {
        textBody = textBody
            .replace(/\d+\.\s+(?:🟢|🔴)\s+\*\*[A-Z0-9]+\*\*\s+—\s+.+/g, '')
            .replace(/💡.*Rule ID.*\n?/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    if (hasConfirmCancel || hasYesNo) {
        textBody = textBody
            .replace(/Please type \*\*confirm\*\* to apply the update or \*\*cancel\*\* to abort\./gi, '')
            .replace(/Type \*\*confirm\*\* to apply or \*\*cancel\*\* to abort\./gi, '')
            .replace(/Type \*\*yes\*\* to confirm or \*\*no\*\* to cancel\./gi, '')
            .replace(/Type \*\*yes\*\* or \*\*no\*\*\./gi, '')
            .replace(/Please confirm:.*\n?/gi, '')
            .trim();
    }
    if (hasFieldOptions) {
        textBody = textBody
            .replace(/Available fields:\s*\n?/gi, '')
            .replace(/📊\s+Numeric:.*\n?/g, '')
            .replace(/📝\s+Text:.*\n?/g, '')
            .replace(/📅\s+Date[^:]*:.*\n?/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    } else if (/📊\s+Numeric:/.test(textBody) || /📝\s+Text:/.test(textBody) || /📅\s+Date/.test(textBody)) {
        // Name step — strip the fields block from body entirely (it's context noise)
        textBody = textBody
            .replace(/📝\s+Available fields for this rule type:\s*\n?/gi, '')
            .replace(/Available fields:\s*\n?/gi, '')
            .replace(/📊\s+Numeric:.*\n?/g, '')
            .replace(/📝\s+Text:.*\n?/g, '')
            .replace(/📅\s+Date[^:]*:.*\n?/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    if (hasOperatorOptions) {
        textBody = textBody
            .replace(/Available operators:.*$/gim, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    if (hasRuleTypeOptions) {
        textBody = textBody
            .replace(/1️⃣\s+Threshold Rule\s+—\s+.+/g, '')
            .replace(/2️⃣\s+Comparison Rule\s+—\s+.+/g, '')
            .replace(/3️⃣\s+Cross-Field Rule\s+—\s+.+/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    if (hasDeployConfirm) {
        textBody = textBody
            .replace(/Type \*\*deploy\*\* to create the rule\s*\nor \*\*edit <field_name>\*\* to change any value\./gi, '')
            .replace(/Type \*\*deploy\*\* to create the rule, or \*\*edit <field>\*\* to change a value\.\s*\nEditable fields:.*$/gim, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    if (hasIntentOptions) {
        textBody = textBody
            .replace(/➕\s+\*\*Add\*\*.*\n?/gi, '')
            .replace(/🗑️\s+\*\*Delete\*\*.*\n?/gi, '')
            .replace(/✏️\s+\*\*Edit\*\*.*\n?/gi, '')
            .replace(/➕\s+add\s*\n?/gi, '')
            .replace(/🗑️\s+delete\s*\n?/gi, '')
            .replace(/✏️\s+edit\s*\n?/gi, '')
            .replace(/Type:\s*\n?/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    const btnBase = {
        border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700,
        cursor: 'pointer', fontFamily: "'Barlow', sans-serif", transition: 'all 0.2s ease',
        display: 'inline-flex', alignItems: 'center', gap: 6,
    };

    return (
        <div>
            {/* Main text body */}
            {textBody && (
                <div
                    style={{ whiteSpace: 'pre-wrap' }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(textBody) }}
                />
            )}

            {/* Multi-select rule list */}
            {ruleEntries.length > 0 && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, color: colors.muted, fontFamily: 'IBM Plex Mono', fontWeight: 700, marginBottom: 8 }}>
                        SELECT ONE OR MORE — CLICK TO TOGGLE
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {ruleEntries.map(rule => {
                            const isSelected = selectedRules.includes(rule.id);
                            return (
                                <button
                                    key={rule.id}
                                    onClick={() => setSelectedRules(prev =>
                                        prev.includes(rule.id)
                                            ? prev.filter(id => id !== rule.id)
                                            : [...prev, rule.id]
                                    )}
                                    style={{
                                        ...btnBase,
                                        background: isSelected ? 'rgba(239, 68, 68, 0.12)' : 'rgba(31, 41, 55, 0.8)',
                                        border: `1.5px solid ${isSelected ? 'rgba(239, 68, 68, 0.6)' : colors.border}`,
                                        color: isSelected ? '#f87171' : '#e5e7eb',
                                        padding: '9px 14px',
                                        textAlign: 'left',
                                        justifyContent: 'flex-start',
                                    }}
                                    onMouseEnter={e => {
                                        if (!isSelected) {
                                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                                            e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                                        }
                                    }}
                                    onMouseLeave={e => {
                                        if (!isSelected) {
                                            e.currentTarget.style.background = 'rgba(31, 41, 55, 0.8)';
                                            e.currentTarget.style.borderColor = colors.border;
                                        }
                                    }}
                                >
                                    <span style={{ fontSize: 14, marginRight: 2 }}>
                                        {isSelected ? '☑' : '☐'}
                                    </span>
                                    <span>{rule.status}</span>
                                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: isSelected ? '#f87171' : colors.accent, fontWeight: 800 }}>{rule.id}</span>
                                    <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                                    <span style={{ fontSize: 13 }}>{rule.name}</span>
                                </button>
                            );
                        })}
                    </div>
                    {selectedRules.length > 0 && (
                        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
                            <button
                                onClick={() => {
                                    onQuickReply(`__BULK_DELETE__:${selectedRules.join(',')}`);
                                    setSelectedRules([]);
                                }}
                                style={{
                                    ...btnBase,
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    border: '1.5px solid rgba(239, 68, 68, 0.5)',
                                    color: '#f87171',
                                    padding: '8px 20px',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
                            >
                                🗑️ Delete {selectedRules.length} rule{selectedRules.length > 1 ? 's' : ''}
                            </button>
                            <button
                                onClick={() => setSelectedRules([])}
                                style={{
                                    ...btnBase,
                                    background: 'transparent',
                                    border: `1px solid ${colors.border}`,
                                    color: colors.muted,
                                    padding: '8px 14px',
                                    fontSize: 12,
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = '#6b7280'}
                                onMouseLeave={e => e.currentTarget.style.borderColor = colors.border}
                            >Clear</button>
                        </div>
                    )}
                </div>
            )}

            {/* Confirm / Cancel buttons */}
            {hasConfirmCancel && !hasYesNo && (
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button
                        onClick={() => onQuickReply('confirm')}
                        style={{ ...btnBase, background: 'rgba(16, 185, 129, 0.12)', border: '1.5px solid rgba(16, 185, 129, 0.5)', color: '#10b981', padding: '8px 20px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.22)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.12)'}
                    >✓ Confirm</button>
                    <button
                        onClick={() => onQuickReply('cancel')}
                        style={{ ...btnBase, background: 'rgba(107, 114, 128, 0.1)', border: '1.5px solid rgba(107, 114, 128, 0.3)', color: '#9ca3af', padding: '8px 20px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(107, 114, 128, 0.2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(107, 114, 128, 0.1)'}
                    >✗ Cancel</button>
                </div>
            )}

            {/* Yes / No buttons */}
            {hasYesNo && (
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button
                        onClick={() => onQuickReply('yes')}
                        style={{ ...btnBase, background: 'rgba(16, 185, 129, 0.12)', border: '1.5px solid rgba(16, 185, 129, 0.5)', color: '#10b981', padding: '8px 20px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.22)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.12)'}
                    >✓ Yes</button>
                    <button
                        onClick={() => onQuickReply('no')}
                        style={{ ...btnBase, background: 'rgba(107, 114, 128, 0.1)', border: '1.5px solid rgba(107, 114, 128, 0.3)', color: '#9ca3af', padding: '8px 20px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(107, 114, 128, 0.2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(107, 114, 128, 0.1)'}
                    >✗ No</button>
                </div>
            )}

            {/* Field name selection buttons */}
            {hasFieldOptions && (() => {
                const numericMatch = content.match(/📊\s+Numeric:\s*([^\n]+)/);
                const textMatch = content.match(/📝\s+Text:\s*([^\n]+)/);
                const dateMatch = content.match(/📅\s+Date[^:]*:\s*([^\n]+)/);
                const numericFields = numericMatch ? numericMatch[1].split(',').map(f => f.trim()).filter(Boolean) : [];
                const textFields = textMatch ? textMatch[1].split(',').map(f => f.trim()).filter(Boolean) : [];
                const dateFields = dateMatch ? dateMatch[1].split(',').map(f => f.trim()).filter(Boolean) : [];
                return (
                    <div style={{ marginTop: 12 }}>
                        {numericFields.length > 0 && (
                            <div style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 6, fontFamily: 'IBM Plex Mono' }}>📊 NUMERIC</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {numericFields.map(f => (
                                        <button key={f} onClick={() => onQuickReply(f)}
                                            style={{ ...btnBase, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981', padding: '5px 12px', fontSize: 12 }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.18)'; e.currentTarget.style.borderColor = '#10b981'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.08)'; e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.3)'; }}
                                        >{f}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {textFields.length > 0 && (
                            <div style={{ marginBottom: dateFields.length > 0 ? 10 : 0 }}>
                                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 6, fontFamily: 'IBM Plex Mono' }}>📝 TEXT</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {textFields.map(f => (
                                        <button key={f} onClick={() => onQuickReply(f)}
                                            style={{ ...btnBase, background: 'rgba(147, 197, 253, 0.08)', border: '1px solid rgba(147, 197, 253, 0.3)', color: '#93c5fd', padding: '5px 12px', fontSize: 12 }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(147, 197, 253, 0.18)'; e.currentTarget.style.borderColor = '#93c5fd'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(147, 197, 253, 0.08)'; e.currentTarget.style.borderColor = 'rgba(147, 197, 253, 0.3)'; }}
                                        >{f}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {dateFields.length > 0 && (
                            <div>
                                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 6, fontFamily: 'IBM Plex Mono' }}>📅 DATE</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {dateFields.map(f => (
                                        <button key={f} onClick={() => onQuickReply(f)}
                                            style={{ ...btnBase, background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.3)', color: '#fbbf24', padding: '5px 12px', fontSize: 12 }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251, 191, 36, 0.18)'; e.currentTarget.style.borderColor = '#fbbf24'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251, 191, 36, 0.08)'; e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.3)'; }}
                                        >{f}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Operator selection buttons */}
            {hasOperatorOptions && (() => {
                const opMatch = content.match(/Available operators:\s*([^\n]+)/i);
                const ops = opMatch
                    ? opMatch[1].split(',').map(s => {
                        const m = s.trim().match(/^(.+?)\s*\((\w+)\)$/);
                        return m ? { label: m[1].trim(), value: m[2].trim() } : null;
                    }).filter(Boolean)
                    : [];
                return ops.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                        {ops.map(op => (
                            <button key={op.value} onClick={() => onQuickReply(op.value)}
                                style={{ ...btnBase, background: 'rgba(245, 158, 11, 0.08)', border: `1px solid ${colors.accent}44`, color: colors.accent, padding: '7px 16px', fontSize: 13 }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245, 158, 11, 0.18)'; e.currentTarget.style.borderColor = colors.accent; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)'; e.currentTarget.style.borderColor = `${colors.accent}44`; }}
                            >
                                <span style={{ fontSize: 15, fontWeight: 800 }}>{op.label}</span>
                                <span style={{ fontSize: 10, opacity: 0.6, fontFamily: 'IBM Plex Mono' }}>{op.value}</span>
                            </button>
                        ))}
                    </div>
                ) : null;
            })()}

            {/* Rule type selection buttons */}
            {hasRuleTypeOptions && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    {[
                        { value: '1', label: 'Threshold Rule', desc: 'compares a numeric field against a value' },
                        { value: '2', label: 'Comparison Rule', desc: 'matches a field value exactly' },
                        { value: '3', label: 'Cross-Field Rule', desc: 'validates relationships between fields' },
                    ].map((opt, i) => (
                        <button
                            key={opt.value}
                            onClick={() => onQuickReply(opt.value)}
                            style={{
                                ...btnBase,
                                background: 'rgba(31, 41, 55, 0.8)',
                                border: `1px solid ${colors.border}`,
                                color: '#e5e7eb',
                                padding: '10px 14px',
                                textAlign: 'left',
                                justifyContent: 'flex-start',
                                gap: 10,
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = `rgba(245, 158, 11, 0.12)`;
                                e.currentTarget.style.borderColor = colors.accent;
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(31, 41, 55, 0.8)';
                                e.currentTarget.style.borderColor = colors.border;
                            }}
                        >
                            <span style={{ fontSize: 16 }}>{['1️⃣', '2️⃣', '3️⃣'][i]}</span>
                            <span>
                                <span style={{ fontWeight: 700, color: '#f9fafb' }}>{opt.label}</span>
                                <span style={{ color: '#6b7280', fontSize: 12 }}> — {opt.desc}</span>
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Percentage slider (completeness / fraudScore) */}
            {isPercentageValueStep && (() => {
                const label = collectedFieldName === 'completeness' ? 'Document Completeness' : 'Fraud Score';
                // Use a local ref-like approach via a wrapper component
                return (
                    <PercentageSlider label={label} onSubmit={onQuickReply} colors={colors} />
                );
            })()}

            {/* Date value picker */}
            {isDateValueStep && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 8, fontFamily: 'IBM Plex Mono' }}>
                        📅 SELECT DATE (YYYY-MM-DD)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                            type="date"
                            style={{
                                background: 'rgba(17, 24, 39, 0.8)',
                                border: `1px solid rgba(251, 191, 36, 0.4)`,
                                borderRadius: 8, padding: '8px 12px',
                                color: '#fbbf24', fontSize: 13, fontFamily: 'IBM Plex Mono',
                                outline: 'none', cursor: 'pointer',
                                colorScheme: 'dark',
                            }}
                            onFocus={e => e.target.style.borderColor = '#fbbf24'}
                            onBlur={e => e.target.style.borderColor = 'rgba(251, 191, 36, 0.4)'}
                            onChange={e => {
                                if (e.target.value) onQuickReply(e.target.value);
                            }}
                        />
                        <span style={{ fontSize: 11, color: '#6b7280' }}>Pick a date to submit automatically</span>
                    </div>
                </div>
            )}

            {/* Deploy confirmation buttons */}
            {hasDeployConfirm && (
                <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                    <button
                        onClick={() => onQuickReply('deploy')}
                        style={{ ...btnBase, background: 'rgba(245, 158, 11, 0.12)', border: `1.5px solid ${colors.accent}88`, color: colors.accent, padding: '8px 20px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.22)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.12)'}
                    >🚀 Deploy Rule</button>
                    <button
                        onClick={() => onQuickReply('cancel')}
                        style={{ ...btnBase, background: 'rgba(107, 114, 128, 0.1)', border: '1.5px solid rgba(107, 114, 128, 0.3)', color: '#9ca3af', padding: '8px 20px' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(107, 114, 128, 0.2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(107, 114, 128, 0.1)'}
                    >✗ Cancel</button>
                </div>
            )}

            {/* Intent action buttons */}
            {hasIntentOptions && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    {[
                        { label: '➕ Add a rule', value: 'add' },
                        { label: '🗑️ Delete a rule', value: 'delete' },
                        { label: '✏️ Edit a rule', value: 'edit' },
                    ].map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => onQuickReply(opt.value)}
                            style={{
                                ...btnBase,
                                background: 'rgba(245, 158, 11, 0.08)',
                                border: `1px solid ${colors.accent}55`,
                                color: colors.accent,
                                padding: '7px 16px',
                                fontSize: 12,
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = `rgba(245, 158, 11, 0.18)`;
                                e.currentTarget.style.borderColor = colors.accent;
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)';
                                e.currentTarget.style.borderColor = `${colors.accent}55`;
                            }}
                        >{opt.label}</button>
                    ))}
                </div>
            )}
        </div>
    );
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
    const [savingEditId, setSavingEditId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedType, setSelectedType] = useState(null);
    const [saving, setSaving] = useState(false);
    const [ruleProcessing, setRuleProcessing] = useState(null); // null | 'updating' | 'deleting' | 'toggling' | 'deploying'

    // Configurator form state
    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formWeight, setFormWeight] = useState(30);
    const [formConfig, setFormConfig] = useState({});

    // Chatbot State
    const [messages, setMessages] = useState([
        { role: 'ai', content: 'Hello! I\'m your AI Rules Assistant. I can help you manage your business rules.\n\nHere\'s what I can do:\n• ➕ **Add** a new rule — \"Create a rule for claims over $10,000\"\n• 🗑️ **Delete** an existing rule — \"Delete rule BR001\"\n• ✏️ **Edit** a rule (coming soon)\n\nWhat would you like to do?' }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [chatStep, setChatStep] = useState('initial');
    const [chatCollected, setChatCollected] = useState({});
    const [chatFieldIndex, setChatFieldIndex] = useState(0);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatIntent, setChatIntent] = useState(null);
    const [chatDeleteRuleId, setChatDeleteRuleId] = useState(null);
    const [chatErrorCount, setChatErrorCount] = useState(0);
    const [chatUpdatePayload, setChatUpdatePayload] = useState(null);
    const [chatUpdateRuleId, setChatUpdateRuleId] = useState(null);
    const chatEndRef = useRef(null);

    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // ─── Fetch Rules (served from backend cache — zero DB calls) ───
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

    // ─── Rule Actions (cache updated instantly on backend, DB persisted async) ───
    const updateRule = async (rule) => {
        setRuleProcessing('updating');
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
        } finally {
            setRuleProcessing(null);
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
        setRuleProcessing('toggling');
        try {
            await updateRule(updated);
        } finally {
            setRuleProcessing(null);
        }
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

    // ─── Deploy Rule from Configurator ───
    const deployRule = async () => {
        if (!selectedType || !formName.trim()) return;
        setSaving(true);
        setRuleProcessing('deploying');
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
        } finally {
            setSaving(false);
            setRuleProcessing(null);
        }
    };

    // ─── Chatbot ───
    const handleSendMessage = async (e, overrideValue) => {
        e.preventDefault();
        const msgValue = overrideValue !== undefined ? overrideValue : inputValue;
        if (!msgValue.trim() || chatLoading) return;

        const userMsg = { role: 'user', content: msgValue };
        setMessages(prev => [...prev, userMsg]);
        if (overrideValue === undefined) setInputValue('');
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
                    message: msgValue,
                    context: {
                        step: chatStep,
                        collected: chatCollected,
                        current_field_index: chatFieldIndex,
                        intent: chatIntent,
                        delete_rule_id: chatDeleteRuleId,
                        error_count: chatErrorCount,
                        update_payload: chatUpdatePayload,
                        update_rule_id: chatUpdateRuleId,
                    }
                })
            });
            const data = await res.json();

            if (data.status === "success") {
                setMessages(prev => [...prev, { role: 'ai', content: data.response }]);

                const nextStep = data.next_step || 'initial';
                setChatStep(nextStep);
                setChatCollected(data.collected || {});
                setChatFieldIndex(data.current_field_index || 0);
                setChatIntent(data.intent || null);
                setChatDeleteRuleId(data.delete_rule_id || null);
                setChatErrorCount(data.error_count || 0);
                setChatUpdatePayload(data.update_payload || null);
                setChatUpdateRuleId(data.update_rule_id || null);

                // Full reset on done or when returning to initial (e.g. after cancel)
                if (nextStep === 'done' || nextStep === 'initial') {
                    if (nextStep === 'done') await fetchRules();
                    setChatCollected({});
                    setChatFieldIndex(0);
                    setChatStep('initial');
                    setChatIntent(null);
                    setChatDeleteRuleId(null);
                    setChatErrorCount(0);
                    setChatUpdatePayload(null);
                    setChatUpdateRuleId(null);
                }
            }
        } catch (err) {
            console.error("❌ [Chat] Error:", err);
            setMessages(prev => [...prev, { role: 'ai', content: 'Sorry, something went wrong. Please try again.' }]);
        }
        setChatLoading(false);
    };

    // Quick reply handler — sends a value directly without needing the text input
    const handleQuickReply = (value) => {
        handleSendMessage({ preventDefault: () => { } }, value);
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

            {/* ── Rules Processing Toast ── */}
            {ruleProcessing && (
                <div style={{
                    padding: '12px 20px',
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: `1px solid ${colors.accent}44`,
                    borderRadius: 12,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    animation: 'fadeIn 0.3s ease'
                }}>
                    <div style={{
                        width: 18, height: 18,
                        border: `2.5px solid ${colors.accent}33`,
                        borderTopColor: colors.accent,
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite'
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.accent }}>
                        {ruleProcessing === 'updating' && 'Processing rule update...'}
                        {ruleProcessing === 'deleting' && 'Removing rule...'}
                        {ruleProcessing === 'toggling' && 'Updating rule status...'}
                        {ruleProcessing === 'deploying' && 'Deploying new rule...'}
                    </span>
                    <span style={{ fontSize: 11, color: colors.muted, marginLeft: 'auto', fontFamily: 'IBM Plex Mono' }}>CACHE + DB SYNC</span>
                </div>
            )}

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
                                                            <div style={{ fontSize: 10, color: colors.muted, fontWeight: 700, marginBottom: 8, fontFamily: 'IBM Plex Mono' }}>
                                                                {isThreshold ? 'THRESHOLD' : 'CONFIG'}
                                                            </div>
                                                            {isThreshold ? (
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
                                        setChatIntent(null);
                                        setChatDeleteRuleId(null);
                                        setChatErrorCount(0);
                                        setChatUpdatePayload(null);
                                        setChatUpdateRuleId(null);
                                        setMessages(prev => [...prev, { role: 'ai', content: 'Conversation reset. What would you like to do?\n\n➕ **Add** a new rule\n🗑️ **Delete** an existing rule\n✏️ **Edit** a rule' }]);
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
                                    }}>
                                        {m.role === 'user' ? m.content : (
                                            <InteractiveMessage
                                                content={m.content}
                                                onQuickReply={handleQuickReply}
                                                colors={colors}
                                                collectedFieldName={chatCollected?.field_name}
                                            />
                                        )}
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

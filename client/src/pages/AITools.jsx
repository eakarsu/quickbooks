import React, { useState, useEffect } from 'react';
import api from '../api';

// Tool catalog matches POST endpoints in routes/ai.js. Each tool defines a
// simple input schema; the page dispatches to the matching endpoint.
const TOOLS = [
  {
    id: 'categorize-transaction',
    label: 'Categorize Transaction',
    icon: '🏷️',
    desc: 'Suggest a chart-of-accounts category and tax treatment for a transaction.',
    fields: [
      { key: 'description', label: 'Description', type: 'text', required: true, placeholder: 'AWS hosting invoice' },
      { key: 'amount', label: 'Amount', type: 'number', required: true, placeholder: '120.50' },
      { key: 'merchant', label: 'Merchant', type: 'text', placeholder: 'Amazon Web Services' },
      { key: 'type', label: 'Type', type: 'select', options: ['', 'income', 'expense'] },
    ],
    build: (v) => ({
      description: v.description,
      amount: Number(v.amount),
      merchant: v.merchant || undefined,
      type: v.type || undefined,
    }),
  },
  {
    id: 'detect-anomalies',
    label: 'Detect Anomalies',
    icon: '🔍',
    desc: 'Scan recent transactions for duplicates, unusual amounts, or possible fraud.',
    fields: [
      { key: 'lookbackDays', label: 'Lookback Days', type: 'number', placeholder: '90', defaultValue: 90 },
      { key: 'limit', label: 'Max Rows', type: 'number', placeholder: '200', defaultValue: 200 },
    ],
    build: (v) => ({
      lookbackDays: Number(v.lookbackDays) || 90,
      limit: Number(v.limit) || 200,
    }),
  },
  {
    id: 'cashflow-forecast',
    label: 'Cash-Flow Forecast',
    icon: '📈',
    desc: 'Forecast cash flow for the next N days, grounded on 180-day history.',
    fields: [
      { key: 'horizonDays', label: 'Horizon (days)', type: 'number', placeholder: '30', defaultValue: 30 },
    ],
    build: (v) => ({ horizonDays: Number(v.horizonDays) || 30 }),
  },
  {
    id: 'invoice-narrative',
    label: 'Invoice Narrative',
    icon: '📝',
    desc: 'Draft polished invoice text from line items.',
    fields: [
      { key: 'customer', label: 'Customer (name)', type: 'text', required: true, placeholder: 'Acme Corp' },
      { key: 'lineItems', label: 'Line Items (JSON array)', type: 'textarea', required: true,
        placeholder: '[{"description":"Consulting","quantity":10,"rate":150}]' },
      { key: 'notes', label: 'Internal Notes', type: 'textarea' },
      { key: 'tone', label: 'Tone', type: 'select', options: ['professional', 'friendly', 'formal', 'concise'] },
    ],
    build: (v) => {
      let items = [];
      try { items = JSON.parse(v.lineItems || '[]'); } catch (_) { throw new Error('Line Items must be valid JSON'); }
      return {
        customer: v.customer,
        lineItems: items,
        notes: v.notes || undefined,
        tone: v.tone || 'professional',
      };
    },
  },
  {
    id: 'expense-explain',
    label: 'Expense Explain',
    icon: '🧾',
    desc: 'Audit-ready memo + GL coding suggestion for an expense.',
    fields: [
      { key: 'expense', label: 'Expense (JSON)', type: 'textarea', required: true,
        placeholder: '{"amount":250,"description":"Client dinner","date":"2026-01-12"}' },
    ],
    build: (v) => {
      let exp;
      try { exp = JSON.parse(v.expense || '{}'); } catch (_) { throw new Error('Expense must be valid JSON'); }
      return { expense: exp };
    },
  },
  {
    id: 'vendor-risk-score',
    label: 'Vendor Risk Score',
    icon: '⚠️',
    desc: 'Score a vendor on payment risk + spend concentration.',
    fields: [
      { key: 'vendorId', label: 'Vendor ID', type: 'number', placeholder: 'e.g. 5' },
    ],
    build: (v) => ({ vendorId: v.vendorId ? Number(v.vendorId) : undefined }),
  },
  {
    id: 'reconcile-suggest',
    label: 'Reconcile Suggest',
    icon: '🔗',
    desc: 'Match a bank-statement line against ledger candidates.',
    fields: [
      { key: 'bankLine', label: 'Bank Line (JSON)', type: 'textarea', required: true,
        placeholder: '{"date":"2026-01-15","amount":-99.50,"description":"NETFLIX"}' },
    ],
    build: (v) => {
      let line;
      try { line = JSON.parse(v.bankLine || '{}'); } catch (_) { throw new Error('Bank Line must be valid JSON'); }
      return { bankLine: line };
    },
  },
  {
    id: 'tax-summary',
    label: 'Tax Summary',
    icon: '🏛️',
    desc: 'Period-based taxable-income / Schedule-C-style summary.',
    fields: [
      { key: 'periodStart', label: 'Period Start (YYYY-MM-DD)', type: 'text', required: true, placeholder: '2026-01-01' },
      { key: 'periodEnd', label: 'Period End (YYYY-MM-DD)', type: 'text', required: true, placeholder: '2026-03-31' },
      { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', placeholder: 'US-Federal', defaultValue: 'US-Federal' },
    ],
    build: (v) => ({
      periodStart: v.periodStart,
      periodEnd: v.periodEnd,
      jurisdiction: v.jurisdiction || 'US-Federal',
    }),
  },
  {
    id: 'customer-insight',
    label: 'Customer Insight',
    icon: '👤',
    desc: 'Payment-behavior profile + collection strategy for a customer.',
    fields: [
      { key: 'customerId', label: 'Customer ID', type: 'number', required: true, placeholder: 'e.g. 3' },
    ],
    build: (v) => ({ customerId: Number(v.customerId) }),
  },
  {
    id: 'financial-qa',
    label: 'Financial Q&A',
    icon: '💬',
    desc: 'Free-form question grounded on your transactions.',
    fields: [
      { key: 'question', label: 'Question', type: 'textarea', required: true,
        placeholder: 'What were my biggest expense categories last quarter?' },
      { key: 'includeRecent', label: 'Recent Rows to Include', type: 'number', placeholder: '50', defaultValue: 50 },
    ],
    build: (v) => ({
      question: v.question,
      includeRecent: Number(v.includeRecent) || 50,
    }),
  },
];

const STYLES = {
  layout: { display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 },
  toolList: { background: '#fff', borderRadius: 8, padding: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', alignSelf: 'start' },
  toolBtn: (active) => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '10px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: active ? '#2563eb' : 'transparent', color: active ? '#fff' : '#1e293b',
    fontSize: '0.85rem', marginBottom: 2, fontWeight: active ? 600 : 500,
  }),
  result: {
    background: '#0f172a', color: '#e2e8f0', borderRadius: 6, padding: 14,
    fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 600,
  },
  alert: (kind) => ({
    padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: '0.85rem',
    background: kind === 'error' ? '#fef2f2' : kind === 'warn' ? '#fff7ed' : '#f0fdf4',
    color: kind === 'error' ? '#b91c1c' : kind === 'warn' ? '#9a3412' : '#166534',
    border: `1px solid ${kind === 'error' ? '#fecaca' : kind === 'warn' ? '#fed7aa' : '#bbf7d0'}`,
  }),
};

export default function AITools() {
  const [activeId, setActiveId] = useState(TOOLS[0].id);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState('');

  const tool = TOOLS.find((t) => t.id === activeId);

  // Reset form state when switching tools; pre-populate defaults.
  useEffect(() => {
    const initial = {};
    (tool.fields || []).forEach((f) => {
      if (f.defaultValue !== undefined) initial[f.key] = String(f.defaultValue);
    });
    setValues(initial);
    setResult(null);
    setError('');
    setWarn('');
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Probe AI service health on mount so users see a hint when key is missing.
  useEffect(() => {
    api.get('/ai/health').then((res) => {
      if (res && res.configured === false) {
        setWarn('AI service is not configured (OPENROUTER_API_KEY missing). Tools will fail until the server has a key.');
      }
    }).catch(() => { /* non-fatal */ });
  }, []);

  const setField = (k, v) => setValues((prev) => ({ ...prev, [k]: v }));

  const handleRun = async () => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      // Validate required fields
      for (const f of tool.fields || []) {
        if (f.required && !values[f.key]) {
          throw new Error(`${f.label} is required`);
        }
      }
      const body = tool.build(values);
      const res = await api.post(`/ai/${tool.id}`, body);
      setResult(res);
    } catch (err) {
      const msg = err && err.message ? err.message : 'AI call failed';
      // Token expired -> bounce to login (mirrors existing api.js convention)
      if (/unauthorized|jwt|token/i.test(msg)) {
        localStorage.removeItem('token');
        window.location.href = '/login';
        return;
      }
      // 503 / no-key handling
      if (/503|not configured|OPENROUTER_API_KEY/i.test(msg)) {
        setError('AI service unavailable: server is missing OPENROUTER_API_KEY. Ask your admin to set it.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>AI Tools</h1>
      </div>

      {warn && <div style={STYLES.alert('warn')}>{warn}</div>}

      <div style={STYLES.layout}>
        {/* Tool list */}
        <div style={STYLES.toolList}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              style={STYLES.toolBtn(activeId === t.id)}
              onClick={() => setActiveId(t.id)}
            >
              <span style={{ fontSize: '1rem' }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Active tool form + result */}
        <div>
          <div className="card">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>
              {tool.icon} {tool.label}
            </h2>
            <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 16 }}>{tool.desc}</p>

            {(tool.fields || []).map((f) => (
              <div className="form-group" key={f.key}>
                <label>{f.label}{f.required ? ' *' : ''}</label>
                {f.type === 'textarea' ? (
                  <textarea
                    rows={4}
                    value={values[f.key] || ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder || ''}
                  />
                ) : f.type === 'select' ? (
                  <select
                    value={values[f.key] || ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                  >
                    {(f.options || []).map((opt) => (
                      <option key={opt} value={opt}>{opt || '—'}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    value={values[f.key] || ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder || ''}
                  />
                )}
              </div>
            ))}

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRun}
              disabled={loading}
            >
              {loading ? 'Running…' : `Run ${tool.label}`}
            </button>
          </div>

          {error && <div style={STYLES.alert('error')}>{error}</div>}

          {result && (
            <div className="card">
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: 10 }}>
                Result {result.model ? <span style={{ fontWeight: 400, color: '#64748b', fontSize: '0.78rem' }}>· {result.model}</span> : null}
                {result.tokens ? <span style={{ fontWeight: 400, color: '#64748b', fontSize: '0.78rem' }}> · {result.tokens} tokens</span> : null}
              </h3>
              <div style={STYLES.result}>{JSON.stringify(result.data || result, null, 2)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);

export default function BrokerOperations() {
  const { user } = useAuth();
  const toast = useToast();
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState({ accountId: '', symbol: '', side: 'BUY', quantityMicros: 1000000, limitPriceMicros: 1000000 });
  const canAdmin = user?.role === 'admin';
  const canApprove = ['admin', 'manager'].includes(user?.role);

  const load = async () => {
    try {
      const result = await api.get('/broker/operations');
      setSnapshot(result.data);
    } catch (error) { toast.error(error.message); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (operation) => {
    setBusy(true);
    try { await operation(); await load(); }
    catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };

  const submitOrder = (event) => {
    event.preventDefault();
    act(async () => {
      const result = await api.post('/broker/orders', {
        idempotencyKey: crypto.randomUUID(), accountId: Number(order.accountId), symbol: order.symbol.toUpperCase(), side: order.side,
        quantityMicros: Number(order.quantityMicros), limitPriceMicros: Number(order.limitPriceMicros),
      });
      toast.success(`Order ${result.data.order.status.toLowerCase().replaceAll('_', ' ')}`);
    });
  };

  const runResilienceScenario = () => act(async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 120000).toISOString();
    const result = await api.post('/broker/scenarios', {
      scenarioName: `resilience-${now.toISOString()}`,
      startingCashCents: 1000000,
      quoteStaleAfterSeconds: 30,
      expectedOutcomes: ['FAIL_CLOSED', 'REJECTED', 'DUPLICATE_REPLAY', 'PARTIALLY_FILLED', 'FILLED'],
      steps: [
        { type: 'PROVIDER_FAILURE', code: 'TIMEOUT' },
        { type: 'QUOTE', symbol: 'TEST', bidPriceMicros: 990000, askPriceMicros: 1000000, sourceOccurredAt: old },
        { type: 'ORDER', orderRef: 'stale', idempotencyKey: 'stale', symbol: 'TEST', side: 'BUY', quantityMicros: 1000000, limitPriceMicros: 1000000, at: now.toISOString() },
        { type: 'QUOTE', symbol: 'TEST', bidPriceMicros: 990000, askPriceMicros: 1000000, sourceOccurredAt: now.toISOString() },
        { type: 'ORDER', orderRef: 'ok', idempotencyKey: 'same', symbol: 'TEST', side: 'BUY', quantityMicros: 2000000, limitPriceMicros: 1000000, at: now.toISOString() },
        { type: 'ORDER', orderRef: 'ok', idempotencyKey: 'same', symbol: 'TEST', side: 'BUY', quantityMicros: 2000000, limitPriceMicros: 1000000, at: now.toISOString() },
        { type: 'FILL', orderRef: 'ok', quantityMicros: 1000000, priceMicros: 1000000 },
        { type: 'FILL', orderRef: 'ok', quantityMicros: 1000000, priceMicros: 1000000 },
      ],
    });
    toast.success(`Scenario ${result.data.status.toLowerCase()}`);
  });

  const exportAudit = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/broker/audit-export', { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } });
      if (!response.ok) throw new Error('Audit export failed');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `paper-ledger-audit-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-header"><div><h1>Paper Broker Controls</h1><p className="text-muted">Licensed data ingestion and reconciled paper custody. Live execution is prohibited.</p></div></div>
      <div className="summary-cards">
        <div className="summary-card"><div className="summary-label">Boundary</div><div className="summary-value" style={{ fontSize: 16 }}>{snapshot?.boundary || 'Loading'}</div></div>
        <div className="summary-card"><div className="summary-label">Audit chain</div><div className="summary-value" style={{ fontSize: 18 }}>{snapshot?.audit?.valid ? `Verified (${snapshot.audit.count})` : 'Unavailable'}</div></div>
        <div className="summary-card"><div className="summary-label">Quarantined</div><div className="summary-value">{snapshot?.quarantined?.length || 0}</div></div>
        <div className="summary-card"><div className="summary-label">Reconciliation variance</div><div className="summary-value">{snapshot?.reconciliations?.filter((item) => item.status === 'VARIANCE').length || 0}</div></div>
      </div>

      <div className="card">
        <h2>Submit governed paper order</h2>
        <form onSubmit={submitOrder} className="form-row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
          <label>Custody account<select value={order.accountId} onChange={(e) => setOrder({ ...order, accountId: e.target.value })} required><option value="">Select</option>{snapshot?.accounts?.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
          <label>Symbol<input value={order.symbol} onChange={(e) => setOrder({ ...order, symbol: e.target.value })} maxLength={16} required /></label>
          <label>Side<select value={order.side} onChange={(e) => setOrder({ ...order, side: e.target.value })}><option>BUY</option><option>SELL</option></select></label>
          <label>Quantity (micro-units)<input type="number" min="1" value={order.quantityMicros} onChange={(e) => setOrder({ ...order, quantityMicros: e.target.value })} required /></label>
          <label>Limit (micro-dollars)<input type="number" min="1" value={order.limitPriceMicros} onChange={(e) => setOrder({ ...order, limitPriceMicros: e.target.value })} required /></label>
          <button className="btn btn-primary" disabled={busy}>Evaluate and submit</button>
        </form>
      </div>

      <div className="card">
        <div className="page-header"><h2>Orders</h2><div><button className="btn btn-secondary" onClick={runResilienceScenario} disabled={!canApprove || busy}>Run resilience scenario</button> <button className="btn btn-secondary" onClick={exportAudit} disabled={busy}>Export verified audit</button></div></div>
        <table className="data-table"><thead><tr><th>ID</th><th>Account</th><th>Instrument</th><th>Side</th><th>Notional</th><th>Source time</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{snapshot?.orders?.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.custody_account_id}</td><td>{item.symbol}</td><td>{item.side}</td><td>{money(item.computed_notional_cents)}</td><td>{item.quote_source_at}</td><td><span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span></td><td>{item.status === 'PENDING_APPROVAL' && canApprove ? <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => api.post(`/broker/orders/${item.id}/approve`, { expectedVersion: item.version }))}>Approve</button> : '—'}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card"><h2>Custody and deterministic limits</h2><table className="data-table"><thead><tr><th>Account</th><th>Mode</th><th>Cash</th><th>Exposure cap</th><th>Min liquidity</th><th>Daily loss cap</th><th>Approval threshold</th><th>Kill switch</th></tr></thead><tbody>{snapshot?.accounts?.map((item) => <tr key={item.id}><td>{item.display_name}</td><td>{item.mode}</td><td>{money(item.cash_cents)}</td><td>{money(item.max_gross_exposure_cents)}</td><td>{item.min_liquidity_bps / 100}%</td><td>{money(item.max_daily_loss_cents)}</td><td>{money(item.approval_threshold_cents)}</td><td>{item.kill_switch ? `ON — ${item.kill_reason}` : 'Off'}{canAdmin ? <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => act(() => api.post(`/broker/accounts/${item.id}/kill-switch`, { enabled: !item.kill_switch, reason: item.kill_switch ? null : 'Enabled from governed operations', expectedVersion: item.version }))}>{item.kill_switch ? 'Disable' : 'Enable'}</button> : null}</td></tr>)}</tbody></table></div>

      <div className="card"><h2>Provider licenses</h2><table className="data-table"><thead><tr><th>Provider</th><th>Scope</th><th>Identity host</th><th>License</th><th>Expires</th><th>Secret reference</th></tr></thead><tbody>{snapshot?.providers?.map((item) => <tr key={item.id}><td>{item.display_name}</td><td>{item.data_scope}</td><td>{item.allowed_host}</td><td>{item.license_reference}</td><td>{item.license_expires_at}</td><td>{item.signing_secret_env}</td></tr>)}</tbody></table></div>
    </div>
  );
}

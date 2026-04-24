import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { CardSkeleton } from '../components/LoadingSkeleton';

const CARDS = [
  { key: 'transactions', label: 'Transactions', icon: '💰', path: '/transactions', color: '#3498db' },
  { key: 'customers', label: 'Customers', icon: '👥', path: '/customers', color: '#2ecc71' },
  { key: 'invoices', label: 'Invoices', icon: '📄', path: '/invoices', color: '#e74c3c' },
  { key: 'vendors', label: 'Vendors', icon: '🏢', path: '/vendors', color: '#9b59b6' },
  { key: 'expenses', label: 'Expenses', icon: '💳', path: '/expenses', color: '#e67e22' },
  { key: 'products', label: 'Products', icon: '📦', path: '/products', color: '#1abc9c' },
  { key: 'accounts', label: 'Accounts', icon: '🏦', path: '/accounts', color: '#34495e' },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const res = await api.get('/dashboard');
      setData(res.data);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

  if (loading) return <div className="page"><CardSkeleton count={7} /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      {/* Financial Summary */}
      <div className="summary-cards">
        <div className="summary-card income">
          <div className="summary-label">Total Income</div>
          <div className="summary-value">{fmt(data?.financials?.totalIncome)}</div>
        </div>
        <div className="summary-card expense">
          <div className="summary-label">Total Expenses</div>
          <div className="summary-value">{fmt(data?.financials?.totalExpenses)}</div>
        </div>
        <div className="summary-card net">
          <div className="summary-label">Net Income</div>
          <div className="summary-value">{fmt(data?.financials?.netIncome)}</div>
        </div>
        <div className="summary-card warning">
          <div className="summary-label">Unpaid Invoices ({data?.financials?.unpaidInvoices?.count || 0})</div>
          <div className="summary-value">{fmt(data?.financials?.unpaidInvoices?.total)}</div>
        </div>
      </div>

      {/* Navigation Cards */}
      <h2 className="section-title">Quick Access</h2>
      <div className="dashboard-cards">
        {CARDS.map(card => (
          <div key={card.key} className="dashboard-card" style={{ borderTopColor: card.color }}
            onClick={() => navigate(card.path)}>
            <div className="dashboard-card-icon">{card.icon}</div>
            <div className="dashboard-card-label">{card.label}</div>
            <div className="dashboard-card-count">{data?.counts?.[card.key] || 0}</div>
          </div>
        ))}
      </div>

      {/* Recent Transactions */}
      <h2 className="section-title">Recent Transactions</h2>
      <div className="card">
        {data?.recentTransactions?.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {data.recentTransactions.map(t => (
                <tr key={t.id} className="data-row" onClick={() => navigate(`/transactions`)}>
                  <td>{t.date}</td>
                  <td>{t.description}</td>
                  <td>{t.category}</td>
                  <td className={t.type === 'income' ? 'text-success' : 'text-danger'}>
                    {t.type === 'income' ? '+' : ''}{fmt(t.amount)}
                  </td>
                  <td><span className={`badge badge-${t.type}`}>{t.type}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">No recent transactions</p>
        )}
      </div>
    </div>
  );
}

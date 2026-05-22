import React, { useEffect, useState } from 'react';

export default function UnappliedPayments() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/unapplied-payments')
      .then((res) => res.json())
      .then(setData)
      .catch(() => setData({ error: 'Unable to load unapplied payments.' }));
  }, []);

  if (!data) return <div className="loading-screen">Loading...</div>;

  return (
    <div className="page">
      <div className="page-header"><h1>Unapplied Payments</h1></div>
      <div className="summary-cards">
        <Metric label="Unapplied Total" value={`$${data.summary?.unappliedTotal?.toLocaleString()}`} />
        <Metric label="Customers Impacted" value={data.summary?.customersImpacted} />
        <Metric label="Oldest Days" value={data.summary?.oldestDays} />
        <Metric label="Auto-Match Candidates" value={data.summary?.autoMatchCandidates} />
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead><tr><th>Customer</th><th>Amount</th><th>Received</th><th>Candidate Invoice</th><th>Confidence</th></tr></thead>
          <tbody>{data.payments?.map((payment) => (
            <tr key={`${payment.customer}-${payment.received}`}>
              <td>{payment.customer}</td><td>${payment.amount.toLocaleString()}</td><td>{payment.received}</td><td>{payment.candidateInvoice}</td><td>{Math.round(payment.confidence * 100)}%</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card"><h3>Actions</h3><ul>{data.actions?.map((action) => <li key={action}>{action}</li>)}</ul></div>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="summary-card"><div className="summary-label">{label}</div><div className="summary-value">{value}</div></div>;
}

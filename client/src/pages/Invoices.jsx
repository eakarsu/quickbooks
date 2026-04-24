import React from 'react';
import CrudPage from './CrudPage';

const fmt = (n) => n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '';

const columns = [
  { key: 'invoice_number', label: 'Invoice #', sortable: true },
  { key: 'customer_name', label: 'Customer', sortable: false },
  { key: 'date', label: 'Date', sortable: true, width: '100px' },
  { key: 'due_date', label: 'Due Date', sortable: true, width: '100px' },
  { key: 'total', label: 'Total', sortable: true, render: (v) => fmt(v) },
  { key: 'status', label: 'Status', sortable: true, render: (v) => <span className={`badge badge-${v}`}>{v}</span> },
];

const formFields = [
  { key: 'invoice_number', label: 'Invoice Number', required: true },
  { key: 'customer_id', label: 'Customer ID', type: 'number' },
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'due_date', label: 'Due Date', type: 'date' },
  { key: 'subtotal', label: 'Subtotal', type: 'number' },
  { key: 'tax_rate', label: 'Tax Rate (%)', type: 'number' },
  { key: 'tax_amount', label: 'Tax Amount', type: 'number' },
  { key: 'total', label: 'Total', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: ['draft', 'sent', 'paid', 'overdue', 'cancelled'] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const filterOptions = [
  { key: 'status', label: 'All Status', options: ['draft', 'sent', 'paid', 'overdue', 'cancelled'] },
];

export default function Invoices() {
  return <CrudPage title="Invoices" apiPath="/invoices" columns={columns} entityName="Invoice"
    emptyIcon="📄" formFields={formFields} defaultSort="date" defaultOrder="desc" filterOptions={filterOptions}
    renderDetail={(item, fmtFn) => (
      <div className="detail-grid">
        <div className="detail-row"><span className="detail-label">Invoice #:</span><span className="detail-value">{item.invoice_number}</span></div>
        <div className="detail-row"><span className="detail-label">Customer:</span><span className="detail-value">{item.customer_name || `ID: ${item.customer_id}`}</span></div>
        <div className="detail-row"><span className="detail-label">Date:</span><span className="detail-value">{item.date}</span></div>
        <div className="detail-row"><span className="detail-label">Due Date:</span><span className="detail-value">{item.due_date}</span></div>
        <div className="detail-row"><span className="detail-label">Subtotal:</span><span className="detail-value">{fmt(item.subtotal)}</span></div>
        <div className="detail-row"><span className="detail-label">Tax ({item.tax_rate}%):</span><span className="detail-value">{fmt(item.tax_amount)}</span></div>
        <div className="detail-row"><span className="detail-label">Total:</span><span className="detail-value font-bold">{fmt(item.total)}</span></div>
        <div className="detail-row"><span className="detail-label">Status:</span><span className="detail-value"><span className={`badge badge-${item.status}`}>{item.status}</span></span></div>
        {item.notes && <div className="detail-row"><span className="detail-label">Notes:</span><span className="detail-value">{item.notes}</span></div>}
        {item.items && item.items.length > 0 && (
          <div className="detail-section">
            <h4>Line Items</h4>
            <table className="data-table mini-table">
              <thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
              <tbody>
                {item.items.map((li, i) => (
                  <tr key={i}><td>{li.description}</td><td>{li.quantity}</td><td>{fmt(li.unit_price)}</td><td>{fmt(li.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )} />;
}

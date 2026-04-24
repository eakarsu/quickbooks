import React from 'react';
import CrudPage from './CrudPage';

const fmt = (n) => n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '';

const columns = [
  { key: 'date', label: 'Date', sortable: true, width: '100px' },
  { key: 'vendor_name', label: 'Vendor', sortable: false },
  { key: 'category', label: 'Category', sortable: true },
  { key: 'description', label: 'Description', sortable: false },
  { key: 'amount', label: 'Amount', sortable: true, render: (v) => <span className="text-danger">{fmt(v)}</span> },
  { key: 'payment_method', label: 'Payment' },
  { key: 'status', label: 'Status', sortable: true, render: (v) => <span className={`badge badge-${v}`}>{v}</span> },
];

const formFields = [
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'vendor_id', label: 'Vendor ID', type: 'number' },
  { key: 'category', label: 'Category' },
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'payment_method', label: 'Payment Method', type: 'select', options: ['credit_card', 'bank_transfer', 'check', 'cash'] },
  { key: 'reference', label: 'Reference' },
  { key: 'status', label: 'Status', type: 'select', options: ['pending', 'approved', 'paid', 'rejected'] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const filterOptions = [
  { key: 'status', label: 'All Status', options: ['pending', 'approved', 'paid', 'rejected'] },
  { key: 'category', label: 'All Categories', options: ['Supplies', 'Rent', 'Software', 'Utilities', 'Insurance', 'Shipping', 'Equipment', 'Marketing'] },
];

export default function Expenses() {
  return <CrudPage title="Expenses" apiPath="/expenses" columns={columns} entityName="Expense"
    emptyIcon="💳" formFields={formFields} defaultSort="date" defaultOrder="desc" filterOptions={filterOptions} />;
}

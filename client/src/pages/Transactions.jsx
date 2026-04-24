import React from 'react';
import CrudPage from './CrudPage';

const fmt = (n) => n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '';

const columns = [
  { key: 'date', label: 'Date', sortable: true, width: '100px' },
  { key: 'description', label: 'Description', sortable: true },
  { key: 'category', label: 'Category', sortable: true },
  { key: 'type', label: 'Type', sortable: true, render: (v) => <span className={`badge badge-${v}`}>{v}</span> },
  { key: 'amount', label: 'Amount', sortable: true, render: (v, row) => <span className={row.type === 'income' ? 'text-success' : 'text-danger'}>{fmt(v)}</span> },
  { key: 'payment_method', label: 'Payment', sortable: false },
  { key: 'status', label: 'Status', sortable: true, render: (v) => <span className={`badge badge-${v}`}>{v}</span> },
];

const formFields = [
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'reference', label: 'Reference' },
  { key: 'type', label: 'Type', type: 'select', options: ['income', 'expense'] },
  { key: 'payment_method', label: 'Payment Method', type: 'select', options: ['bank_transfer', 'credit_card', 'check', 'cash'] },
  { key: 'status', label: 'Status', type: 'select', options: ['pending', 'completed', 'cancelled'] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const filterOptions = [
  { key: 'type', label: 'All Types', options: ['income', 'expense'] },
  { key: 'status', label: 'All Status', options: ['pending', 'completed', 'cancelled'] },
];

export default function Transactions() {
  return <CrudPage title="Transactions" apiPath="/transactions" columns={columns} entityName="Transaction"
    emptyIcon="💰" formFields={formFields} defaultSort="date" defaultOrder="desc" filterOptions={filterOptions} />;
}

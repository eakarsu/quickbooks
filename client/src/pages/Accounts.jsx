import React from 'react';
import CrudPage from './CrudPage';

const fmt = (n) => n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '';

const columns = [
  { key: 'account_number', label: 'Acct #', sortable: true, width: '80px' },
  { key: 'name', label: 'Name', sortable: true },
  { key: 'type', label: 'Type', sortable: true, render: (v) => <span className={`badge badge-${v}`}>{v}</span> },
  { key: 'sub_type', label: 'Sub-Type', sortable: false },
  { key: 'balance', label: 'Balance', sortable: true, render: (v) => <span className={v < 0 ? 'text-danger' : 'text-success'}>{fmt(v)}</span> },
  { key: 'is_active', label: 'Active', render: (v) => v ? 'Yes' : 'No' },
];

const formFields = [
  { key: 'name', label: 'Account Name', required: true },
  { key: 'type', label: 'Type', type: 'select', required: true, options: ['asset', 'liability', 'equity', 'income', 'expense'] },
  { key: 'sub_type', label: 'Sub-Type' },
  { key: 'account_number', label: 'Account Number' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'balance', label: 'Balance', type: 'number' },
];

const filterOptions = [
  { key: 'type', label: 'All Types', options: ['asset', 'liability', 'equity', 'income', 'expense'] },
];

export default function Accounts() {
  return <CrudPage title="Chart of Accounts" apiPath="/accounts" columns={columns} entityName="Account"
    emptyIcon="🏦" formFields={formFields} defaultSort="account_number" defaultOrder="asc" filterOptions={filterOptions} />;
}

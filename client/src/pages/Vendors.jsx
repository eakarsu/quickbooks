import React from 'react';
import CrudPage from './CrudPage';

const fmt = (n) => n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '';

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'email', label: 'Email', sortable: true },
  { key: 'phone', label: 'Phone' },
  { key: 'company', label: 'Company', sortable: true },
  { key: 'city', label: 'City' },
  { key: 'balance', label: 'Balance', sortable: true, render: (v) => fmt(v) },
  { key: 'status', label: 'Status', sortable: true, render: (v) => <span className={`badge badge-${v}`}>{v}</span> },
];

const formFields = [
  { key: 'name', label: 'Name', required: true },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP Code' },
  { key: 'balance', label: 'Balance', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const filterOptions = [
  { key: 'status', label: 'All Status', options: ['active', 'inactive'] },
];

export default function Vendors() {
  return <CrudPage title="Vendors" apiPath="/vendors" columns={columns} entityName="Vendor"
    emptyIcon="🏢" formFields={formFields} defaultSort="name" defaultOrder="asc" filterOptions={filterOptions} />;
}

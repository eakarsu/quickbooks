import React from 'react';
import CrudPage from './CrudPage';

const fmt = (n) => n != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '';

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'type', label: 'Type', sortable: true, render: (v) => <span className={`badge badge-${v}`}>{v}</span> },
  { key: 'category', label: 'Category', sortable: true },
  { key: 'price', label: 'Price', sortable: true, render: (v) => fmt(v) },
  { key: 'cost', label: 'Cost', sortable: false, render: (v) => fmt(v) },
  { key: 'stock', label: 'Stock', sortable: true },
  { key: 'sku', label: 'SKU' },
  { key: 'is_active', label: 'Active', render: (v) => v ? 'Yes' : 'No' },
];

const formFields = [
  { key: 'name', label: 'Name', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'type', label: 'Type', type: 'select', options: ['product', 'service'] },
  { key: 'price', label: 'Price', type: 'number', required: true },
  { key: 'cost', label: 'Cost', type: 'number' },
  { key: 'category', label: 'Category' },
  { key: 'sku', label: 'SKU' },
  { key: 'stock', label: 'Stock', type: 'number' },
  { key: 'unit', label: 'Unit' },
];

const filterOptions = [
  { key: 'type', label: 'All Types', options: ['product', 'service'] },
  { key: 'category', label: 'All Categories', options: ['Design', 'Marketing', 'Consulting', 'Development', 'Content', 'IT Services', 'Hosting', 'Security', 'Training', 'Support'] },
];

export default function Products() {
  return <CrudPage title="Products & Services" apiPath="/products" columns={columns} entityName="Product"
    emptyIcon="📦" formFields={formFields} defaultSort="name" defaultOrder="asc" filterOptions={filterOptions} />;
}

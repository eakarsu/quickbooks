import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import FormModal from '../components/FormModal';
import ErrorBoundary from '../components/ErrorBoundary';

export default function CrudPage({
  title, apiPath, columns, entityName, emptyIcon = '📭',
  formFields, detailFields, defaultSort = 'name', defaultOrder = 'asc',
  filterOptions = [], // [{ key, label, options }]
  renderDetail,
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(defaultSort);
  const [order, setOrder] = useState(defaultOrder);
  const [filters, setFilters] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDetail, setShowDetail] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formData, setFormData] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [bulkAction, setBulkAction] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 10, sort, order });
      if (search) params.set('search', search);
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await api.get(`${apiPath}?${params}`);
      setData(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast.error(`Failed to load ${entityName}s: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [apiPath, page, search, sort, order, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSort = (field, ord) => { setSort(field); setOrder(ord); setPage(1); };
  const handleSearch = (val) => { setSearch(val); setPage(1); };

  const handleRowClick = async (row) => {
    try {
      const res = await api.get(`${apiPath}/${row.id}`);
      setShowDetail(res.data);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleAdd = () => {
    setEditItem(null);
    setFormData({});
    setFormErrors({});
    setShowForm(true);
  };

  const handleEdit = (item) => {
    setEditItem(item);
    setFormData({ ...item });
    setFormErrors({});
    setShowForm(true);
    setShowDetail(null);
  };

  const handleFormSubmit = async () => {
    // Validate required fields
    const errs = {};
    formFields.forEach(f => {
      if (f.required && !formData[f.key] && formData[f.key] !== 0) {
        errs[f.key] = `${f.label} is required`;
      }
    });
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    try {
      if (editItem) {
        await api.put(`${apiPath}/${editItem.id}`, formData);
        toast.success(`${entityName} updated`);
      } else {
        await api.post(apiPath, formData);
        toast.success(`${entityName} created`);
      }
      setShowForm(false);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`${apiPath}/${id}`);
      toast.success(`${entityName} deleted`);
      setConfirmDelete(null);
      setShowDetail(null);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleBulkDelete = async () => {
    try {
      await api.post(`${apiPath}/bulk-delete`, { ids: selectedIds });
      toast.success(`${selectedIds.length} ${entityName}(s) deleted`);
      setSelectedIds([]);
      setBulkAction(null);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleExportPdf = () => {
    const token = localStorage.getItem('token');
    window.open(`/api${apiPath}/export/pdf?token=${token}`, '_blank');
  };

  const fmt = (n) => {
    if (n === null || n === undefined) return '';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  };

  return (
    <ErrorBoundary>
      <div className="page">
        <div className="page-header">
          <h1>{title}</h1>
          <div className="page-actions">
            <button className="btn btn-primary" onClick={handleAdd}>+ Add {entityName}</button>
            <button className="btn btn-secondary" onClick={handleExportPdf}>PDF Export</button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="toolbar">
          <div className="search-box">
            <input type="text" placeholder={`Search ${entityName}s...`} value={search}
              onChange={e => handleSearch(e.target.value)} />
          </div>
          <div className="filter-controls">
            {filterOptions.map(f => (
              <select key={f.key} value={filters[f.key] || ''} onChange={e => { setFilters(prev => ({ ...prev, [f.key]: e.target.value })); setPage(1); }}>
                <option value="">{f.label}</option>
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedIds.length > 0 && (
          <div className="bulk-actions">
            <span>{selectedIds.length} selected</span>
            <button className="btn btn-danger btn-sm" onClick={() => setBulkAction('delete')}>Delete Selected</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedIds([])}>Clear Selection</button>
          </div>
        )}

        {/* Data Table */}
        <DataTable columns={columns} data={data} loading={loading} pagination={pagination}
          selectedIds={selectedIds} onSelectionChange={setSelectedIds}
          onRowClick={handleRowClick} onSort={handleSort} sortField={sort} sortOrder={order}
          onPageChange={setPage} onAdd={handleAdd} entityName={entityName} emptyIcon={emptyIcon} />

        {/* Detail Modal */}
        {showDetail && (
          <div className="modal-overlay" onClick={() => setShowDetail(null)}>
            <div className="modal modal-detail" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{entityName} Details</h3>
                <button className="modal-close" onClick={() => setShowDetail(null)}>✕</button>
              </div>
              <div className="modal-body">
                {renderDetail ? renderDetail(showDetail, fmt) : (
                  <div className="detail-grid">
                    {(detailFields || columns).map(f => (
                      <div key={f.key} className="detail-row">
                        <span className="detail-label">{f.label}:</span>
                        <span className="detail-value">
                          {f.render ? f.render(showDetail[f.key], showDetail) : (showDetail[f.key] ?? '-')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowDetail(null)}>Close</button>
                <button className="btn btn-primary" onClick={() => handleEdit(showDetail)}>Edit</button>
                <button className="btn btn-danger" onClick={() => { setConfirmDelete(showDetail.id); }}>Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Form Modal */}
        <FormModal open={showForm} title={editItem ? `Edit ${entityName}` : `Add ${entityName}`}
          onClose={() => setShowForm(false)} onSubmit={handleFormSubmit}
          submitLabel={editItem ? 'Update' : 'Create'}>
          {formFields && formFields.map(f => (
            <div key={f.key} className="form-group">
              <label>{f.label}{f.required ? ' *' : ''}</label>
              {f.type === 'select' ? (
                <select value={formData[f.key] || ''} onChange={e => setFormData(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className={formErrors[f.key] ? 'input-error' : ''}>
                  <option value="">Select...</option>
                  {f.options?.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea value={formData[f.key] || ''} onChange={e => setFormData(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className={formErrors[f.key] ? 'input-error' : ''} rows={3} />
              ) : (
                <input type={f.type || 'text'} value={formData[f.key] ?? ''} step={f.type === 'number' ? '0.01' : undefined}
                  onChange={e => setFormData(prev => ({ ...prev, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || '' : e.target.value }))}
                  className={formErrors[f.key] ? 'input-error' : ''} placeholder={f.placeholder || ''} />
              )}
              {formErrors[f.key] && <span className="field-error">{formErrors[f.key]}</span>}
            </div>
          ))}
        </FormModal>

        {/* Confirm Delete */}
        <ConfirmDialog open={!!confirmDelete} title="Delete Item"
          message={`Are you sure you want to delete this ${entityName}? This action cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />

        {/* Bulk Delete Confirm */}
        <ConfirmDialog open={bulkAction === 'delete'} title="Bulk Delete"
          message={`Are you sure you want to delete ${selectedIds.length} ${entityName}(s)? This action cannot be undone.`}
          onConfirm={handleBulkDelete} onCancel={() => setBulkAction(null)} />
      </div>
    </ErrorBoundary>
  );
}

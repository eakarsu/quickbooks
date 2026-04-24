import React, { useState } from 'react';
import Pagination from './Pagination';
import EmptyState from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';

export default function DataTable({
  columns, data, loading, pagination, selectedIds, onSelectionChange,
  onRowClick, onSort, sortField, sortOrder, onPageChange, onAdd,
  entityName = 'item', emptyIcon = '📭',
}) {
  const allSelected = data.length > 0 && selectedIds.length === data.length;

  const toggleAll = () => {
    if (allSelected) onSelectionChange([]);
    else onSelectionChange(data.map(r => r.id));
  };

  const toggleOne = (id) => {
    if (selectedIds.includes(id)) onSelectionChange(selectedIds.filter(x => x !== id));
    else onSelectionChange([...selectedIds, id]);
  };

  const handleSort = (field) => {
    if (onSort) {
      const newOrder = sortField === field && sortOrder === 'asc' ? 'desc' : 'asc';
      onSort(field, newOrder);
    }
  };

  if (loading) return <LoadingSkeleton rows={8} cols={columns.length} />;

  if (!data || data.length === 0) {
    return <EmptyState title={`No ${entityName}s found`} message={`There are no ${entityName}s to display.`} icon={emptyIcon} action={onAdd} actionLabel={`Add ${entityName}`} />;
  }

  return (
    <div className="data-table-wrapper">
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th className="checkbox-col">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              {columns.map(col => (
                <th key={col.key} className={col.sortable ? 'sortable' : ''} onClick={() => col.sortable && handleSort(col.key)}
                  style={col.width ? { width: col.width } : {}}>
                  {col.label}
                  {col.sortable && sortField === col.key && (
                    <span className="sort-indicator">{sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr key={row.id} className={`data-row ${selectedIds.includes(row.id) ? 'selected' : ''}`} onClick={() => onRowClick && onRowClick(row)}>
                <td className="checkbox-col" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleOne(row.id)} />
                </td>
                {columns.map(col => (
                  <td key={col.key}>{col.render ? col.render(row[col.key], row) : row[col.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={onPageChange} />
      )}
    </div>
  );
}

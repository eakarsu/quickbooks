import React from 'react';

export default function Pagination({ page, totalPages, total, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);

  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="pagination">
      <span className="pagination-info">Page {page} of {totalPages} ({total} items)</span>
      <div className="pagination-buttons">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPageChange(1)}>First</button>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Prev</button>
        {start > 1 && <span className="pagination-dots">...</span>}
        {pages.map(p => (
          <button key={p} className={`btn btn-sm ${p === page ? 'btn-primary' : ''}`} onClick={() => onPageChange(p)}>{p}</button>
        ))}
        {end < totalPages && <span className="pagination-dots">...</span>}
        <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
        <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>Last</button>
      </div>
    </div>
  );
}

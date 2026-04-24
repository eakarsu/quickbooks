import React from 'react';

export function LoadingSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="skeleton-container">
      <div className="skeleton-header">
        <div className="skeleton-line skeleton-title"></div>
        <div className="skeleton-line skeleton-subtitle"></div>
      </div>
      <div className="skeleton-table">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton-row">
            {Array.from({ length: cols }).map((_, j) => (
              <div key={j} className="skeleton-cell"></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ count = 6 }) {
  return (
    <div className="skeleton-cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-line skeleton-card-icon"></div>
          <div className="skeleton-line skeleton-card-title"></div>
          <div className="skeleton-line skeleton-card-value"></div>
        </div>
      ))}
    </div>
  );
}

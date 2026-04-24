import React from 'react';

export default function EmptyState({ title = 'No data found', message = 'There are no items to display.', icon = '📭', action, actionLabel }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && (
        <button className="btn btn-primary" onClick={action}>{actionLabel || 'Add New'}</button>
      )}
    </div>
  );
}

const { all, get, run } = require('./database');
const { canonicalize, sha256 } = require('./security');

function auditMaterial(event) {
  return canonicalize({
    actorType: event.actorType,
    actorId: String(event.actorId),
    action: event.action,
    entityType: event.entityType,
    entityId: String(event.entityId),
    sourceOccurredAt: event.sourceOccurredAt || null,
    details: event.details,
    previousHash: event.previousHash,
    createdAt: event.createdAt,
  });
}

async function appendAudit(db, event) {
  const previous = await get(db, 'SELECT event_hash FROM audit_events ORDER BY sequence DESC LIMIT 1');
  const row = {
    ...event,
    actorId: String(event.actorId),
    entityId: String(event.entityId),
    previousHash: previous ? previous.event_hash : '0'.repeat(64),
    createdAt: event.createdAt || new Date().toISOString(),
  };
  const eventHash = sha256(auditMaterial(row));
  const result = await run(db, `INSERT INTO audit_events
    (actor_type, actor_id, action, entity_type, entity_id, source_occurred_at, details_json, previous_hash, event_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [row.actorType, row.actorId, row.action, row.entityType, row.entityId,
    row.sourceOccurredAt || null, canonicalize(row.details), row.previousHash, eventHash, row.createdAt]);
  return { sequence: result.lastID, eventHash };
}

async function verifyAudit(db) {
  const events = await all(db, 'SELECT * FROM audit_events ORDER BY sequence');
  let previousHash = '0'.repeat(64);
  for (const row of events) {
    const material = {
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      sourceOccurredAt: row.source_occurred_at,
      details: JSON.parse(row.details_json),
      previousHash: row.previous_hash,
      createdAt: row.created_at,
    };
    if (row.previous_hash !== previousHash || sha256(auditMaterial(material)) !== row.event_hash) {
      return { valid: false, sequence: row.sequence };
    }
    previousHash = row.event_hash;
  }
  return { valid: true, count: events.length, headHash: previousHash };
}

module.exports = { appendAudit, verifyAudit };

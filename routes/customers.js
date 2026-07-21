const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { sanitizeInputs, validate, paginationValidation } = require('../middleware/validator');
const { bulkLimiter } = require('../middleware/rateLimiter');
const { openDatabase } = require('../lib/database');
const PDFDocument = require('pdfkit');

const router = express.Router();

function getDb() { return openDatabase(); }
function dbAll(db, sql, p = []) { return new Promise((res, rej) => { db.all(sql, p, (e, r) => e ? rej(e) : res(r)); }); }
function dbGet(db, sql, p = []) { return new Promise((res, rej) => { db.get(sql, p, (e, r) => e ? rej(e) : res(r)); }); }
function dbRun(db, sql, p = []) { return new Promise((res, rej) => { db.run(sql, p, function(e) { e ? rej(e) : res(this); }); }); }

// GET /api/customers
router.get('/', authenticateToken, paginationValidation, validate, async (req, res) => {
  const db = getDb();
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sort = req.query.sort || 'name';
    const order = req.query.order === 'desc' ? 'DESC' : 'ASC';
    const filterStatus = req.query.status || '';

    let where = [], params = [];
    if (search) { where.push('(name LIKE ? OR email LIKE ? OR company LIKE ? OR city LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`); }
    if (filterStatus) { where.push('status = ?'); params.push(filterStatus); }
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const allowedSorts = ['name','email','company','balance','city','status','created_at'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'name';

    const count = await dbGet(db, `SELECT COUNT(*) as total FROM customers ${whereClause}`, params);
    const rows = await dbAll(db, `SELECT * FROM customers ${whereClause} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    db.close();
    res.json({ success: true, data: rows, pagination: { page, limit, total: count.total, totalPages: Math.ceil(count.total / limit) } });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// GET /api/customers/export/pdf - MUST be before /:id
router.get('/export/pdf', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const rows = await dbAll(db, 'SELECT * FROM customers ORDER BY name');
    db.close();
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Customer Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()}  |  Total: ${rows.length}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica-Bold');
    const x = 40; let y = doc.y;
    doc.text('Name', x, y, { width: 100 }); doc.text('Email', x+100, y, { width: 120 });
    doc.text('Phone', x+220, y, { width: 80 }); doc.text('Company', x+300, y, { width: 100 });
    doc.text('Balance', x+400, y, { width: 60, align: 'right' }); doc.text('Status', x+460, y, { width: 50 });
    y += 15; doc.moveTo(x, y).lineTo(x+510, y).stroke(); y += 5;
    doc.font('Helvetica').fontSize(7);
    for (const r of rows) {
      if (y > 750) { doc.addPage(); y = 40; }
      doc.text(r.name||'', x, y, { width: 100 }); doc.text(r.email||'', x+100, y, { width: 120 });
      doc.text(r.phone||'', x+220, y, { width: 80 }); doc.text(r.company||'', x+300, y, { width: 100 });
      doc.text(`$${(r.balance||0).toFixed(2)}`, x+400, y, { width: 60, align: 'right' }); doc.text(r.status||'', x+460, y, { width: 50 });
      y += 14;
    }
    doc.end();
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// POST /api/customers/bulk-delete - MUST be before /:id
router.post('/bulk-delete', authenticateToken, authorize('delete'), bulkLimiter, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Array of ids required' });
  const db = getDb();
  try {
    const placeholders = ids.map(() => '?').join(',');
    const result = await dbRun(db, `DELETE FROM customers WHERE id IN (${placeholders})`, ids);
    db.close();
    res.json({ success: true, deleted: result.changes });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// POST /api/customers/bulk-update - MUST be before /:id
router.post('/bulk-update', authenticateToken, authorize('write'), bulkLimiter, sanitizeInputs, async (req, res) => {
  const { ids, updates } = req.body;
  if (!Array.isArray(ids) || !updates) return res.status(400).json({ error: 'ids and updates required' });
  const db = getDb();
  try {
    const fields = [], values = [];
    for (const [key, val] of Object.entries(updates)) {
      if (['status','city','state'].includes(key)) { fields.push(`${key}=?`); values.push(val); }
    }
    if (fields.length === 0) { db.close(); return res.status(400).json({ error: 'No valid fields' }); }
    fields.push('updated_at=datetime("now")');
    const placeholders = ids.map(() => '?').join(',');
    const result = await dbRun(db, `UPDATE customers SET ${fields.join(',')} WHERE id IN (${placeholders})`, [...values, ...ids]);
    db.close();
    res.json({ success: true, updated: result.changes });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// POST /api/customers
router.post('/', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const { name, email, phone, company, address, city, state, zip, notes, balance, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const db = getDb();
  try {
    const result = await dbRun(db, `INSERT INTO customers (name,email,phone,company,address,city,state,zip,notes,balance,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [name, email, phone, company, address, city, state, zip, notes, balance || 0, status || 'active']);
    const row = await dbGet(db, 'SELECT * FROM customers WHERE id = ?', [result.lastID]);
    db.close();
    res.status(201).json({ success: true, data: row });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// GET /api/customers/:id
router.get('/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const row = await dbGet(db, 'SELECT * FROM customers WHERE id = ?', [req.params.id]);
    db.close();
    if (!row) return res.status(404).json({ error: 'Customer not found' });
    res.json({ success: true, data: row });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// PUT /api/customers/:id
router.put('/:id', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const db = getDb();
  try {
    const existing = await dbGet(db, 'SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (!existing) { db.close(); return res.status(404).json({ error: 'Customer not found' }); }
    const { name, email, phone, company, address, city, state, zip, notes, balance, status } = req.body;
    await dbRun(db, `UPDATE customers SET name=?,email=?,phone=?,company=?,address=?,city=?,state=?,zip=?,notes=?,balance=?,status=?,updated_at=datetime("now") WHERE id=?`,
      [name||existing.name, email!==undefined?email:existing.email, phone!==undefined?phone:existing.phone, company!==undefined?company:existing.company,
       address!==undefined?address:existing.address, city!==undefined?city:existing.city, state!==undefined?state:existing.state, zip!==undefined?zip:existing.zip,
       notes!==undefined?notes:existing.notes, balance!==undefined?balance:existing.balance, status||existing.status, req.params.id]);
    const updated = await dbGet(db, 'SELECT * FROM customers WHERE id = ?', [req.params.id]);
    db.close();
    res.json({ success: true, data: updated });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// DELETE /api/customers/:id
router.delete('/:id', authenticateToken, authorize('delete'), async (req, res) => {
  const db = getDb();
  try {
    const result = await dbRun(db, 'DELETE FROM customers WHERE id = ?', [req.params.id]);
    db.close();
    if (result.changes === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ success: true, message: 'Customer deleted' });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

module.exports = router;

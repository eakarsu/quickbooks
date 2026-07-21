const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { sanitizeInputs, validate, paginationValidation } = require('../middleware/validator');
const { bulkLimiter } = require('../middleware/rateLimiter');
const { openDatabase } = require('../lib/database');
const PDFDocument = require('pdfkit');

const router = express.Router();
function getDb() { return openDatabase(); }
function dbAll(db, sql, p=[]) { return new Promise((res,rej) => { db.all(sql,p,(e,r)=>e?rej(e):res(r)); }); }
function dbGet(db, sql, p=[]) { return new Promise((res,rej) => { db.get(sql,p,(e,r)=>e?rej(e):res(r)); }); }
function dbRun(db, sql, p=[]) { return new Promise((res,rej) => { db.run(sql,p,function(e){e?rej(e):res(this);}); }); }

// GET /api/invoices
router.get('/', authenticateToken, paginationValidation, validate, async (req, res) => {
  const db = getDb();
  try {
    const page = parseInt(req.query.page)||1, limit = parseInt(req.query.limit)||10, offset = (page-1)*limit;
    const search = req.query.search||'', sort = req.query.sort||'date', order = req.query.order==='asc'?'ASC':'DESC';
    const filterStatus = req.query.status||'';

    let where=[], params=[];
    if (search) { where.push('(i.invoice_number LIKE ? OR i.notes LIKE ? OR c.name LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
    if (filterStatus) { where.push('i.status = ?'); params.push(filterStatus); }
    const wc = where.length>0?'WHERE '+where.join(' AND '):'';

    const allowedSorts = ['date','due_date','total','invoice_number','status','created_at'];
    const sortCol = 'i.'+(allowedSorts.includes(sort)?sort:'date');

    const count = await dbGet(db, `SELECT COUNT(*) as total FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id ${wc}`, params);
    const rows = await dbAll(db, `SELECT i.*, c.name as customer_name, c.email as customer_email FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id ${wc} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    db.close();
    res.json({ success: true, data: rows, pagination: { page, limit, total: count.total, totalPages: Math.ceil(count.total/limit) } });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// GET /api/invoices/export/pdf - MUST be before /:id
router.get('/export/pdf', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const rows = await dbAll(db, 'SELECT i.*, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id ORDER BY i.date DESC');
    db.close();
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=invoices.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Invoice Report', { align: 'center' }); doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()} | Total: ${rows.length}`, { align: 'center' }); doc.moveDown(2);
    const x=40; let y=doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Invoice #', x, y, {width:70}); doc.text('Customer', x+70, y, {width:100}); doc.text('Date', x+170, y, {width:70});
    doc.text('Due Date', x+240, y, {width:70}); doc.text('Total', x+310, y, {width:70,align:'right'}); doc.text('Status', x+390, y, {width:60});
    y+=15; doc.moveTo(x,y).lineTo(x+450,y).stroke(); y+=5;
    doc.font('Helvetica').fontSize(7);
    for (const r of rows) {
      if (y>750) { doc.addPage(); y=40; }
      doc.text(r.invoice_number||'', x, y, {width:70}); doc.text(r.customer_name||'', x+70, y, {width:100});
      doc.text(r.date||'', x+170, y, {width:70}); doc.text(r.due_date||'', x+240, y, {width:70});
      doc.text(`$${(r.total||0).toFixed(2)}`, x+310, y, {width:70,align:'right'}); doc.text(r.status||'', x+390, y, {width:60});
      y+=14;
    }
    doc.end();
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// POST /api/invoices/bulk-delete - MUST be before /:id
router.post('/bulk-delete', authenticateToken, authorize('delete'), bulkLimiter, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)||ids.length===0) return res.status(400).json({ error: 'Array of ids required' });
  const db = getDb();
  try {
    const ph = ids.map(()=>'?').join(',');
    await dbRun(db, `DELETE FROM invoice_items WHERE invoice_id IN (${ph})`, ids);
    const result = await dbRun(db, `DELETE FROM invoices WHERE id IN (${ph})`, ids);
    db.close();
    res.json({ success: true, deleted: result.changes });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// POST /api/invoices/bulk-update - MUST be before /:id
router.post('/bulk-update', authenticateToken, authorize('write'), bulkLimiter, sanitizeInputs, async (req, res) => {
  const { ids, updates } = req.body;
  if (!Array.isArray(ids)||!updates) return res.status(400).json({ error: 'ids and updates required' });
  const db = getDb();
  try {
    const fields=[], values=[];
    for (const [k,v] of Object.entries(updates)) {
      if (['status'].includes(k)) { fields.push(`${k}=?`); values.push(v); }
    }
    if (fields.length===0) { db.close(); return res.status(400).json({ error: 'No valid fields' }); }
    fields.push('updated_at=datetime("now")');
    const ph = ids.map(()=>'?').join(',');
    const result = await dbRun(db, `UPDATE invoices SET ${fields.join(',')} WHERE id IN (${ph})`, [...values,...ids]);
    db.close();
    res.json({ success: true, updated: result.changes });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// POST /api/invoices
router.post('/', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const { customer_id, invoice_number, date, due_date, status, subtotal, tax_rate, tax_amount, total, notes, items } = req.body;
  if (!invoice_number || !date) return res.status(400).json({ error: 'Invoice number and date required' });
  const db = getDb();
  try {
    const result = await dbRun(db, `INSERT INTO invoices (customer_id,invoice_number,date,due_date,status,subtotal,tax_rate,tax_amount,total,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [customer_id, invoice_number, date, due_date, status||'draft', subtotal||0, tax_rate||0, tax_amount||0, total||0, notes]);
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await dbRun(db, 'INSERT INTO invoice_items (invoice_id,description,quantity,unit_price,amount) VALUES (?,?,?,?,?)',
          [result.lastID, item.description, item.quantity||1, item.unit_price, item.amount]);
      }
    }
    const row = await dbGet(db, 'SELECT * FROM invoices WHERE id=?', [result.lastID]);
    db.close();
    res.status(201).json({ success: true, data: row });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// GET /api/invoices/:id (with items)
router.get('/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const invoice = await dbGet(db, 'SELECT i.*, c.name as customer_name, c.email as customer_email FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id WHERE i.id=?', [req.params.id]);
    if (!invoice) { db.close(); return res.status(404).json({ error: 'Invoice not found' }); }
    const items = await dbAll(db, 'SELECT * FROM invoice_items WHERE invoice_id=?', [req.params.id]);
    db.close();
    res.json({ success: true, data: { ...invoice, items } });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// PUT /api/invoices/:id
router.put('/:id', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const db = getDb();
  try {
    const existing = await dbGet(db, 'SELECT * FROM invoices WHERE id=?', [req.params.id]);
    if (!existing) { db.close(); return res.status(404).json({ error: 'Invoice not found' }); }
    const { customer_id, invoice_number, date, due_date, status, subtotal, tax_rate, tax_amount, total, notes, items } = req.body;
    await dbRun(db, `UPDATE invoices SET customer_id=?,invoice_number=?,date=?,due_date=?,status=?,subtotal=?,tax_rate=?,tax_amount=?,total=?,notes=?,updated_at=datetime("now") WHERE id=?`,
      [customer_id!==undefined?customer_id:existing.customer_id, invoice_number||existing.invoice_number, date||existing.date,
       due_date!==undefined?due_date:existing.due_date, status||existing.status, subtotal!==undefined?subtotal:existing.subtotal,
       tax_rate!==undefined?tax_rate:existing.tax_rate, tax_amount!==undefined?tax_amount:existing.tax_amount,
       total!==undefined?total:existing.total, notes!==undefined?notes:existing.notes, req.params.id]);
    if (items && Array.isArray(items)) {
      await dbRun(db, 'DELETE FROM invoice_items WHERE invoice_id=?', [req.params.id]);
      for (const item of items) {
        await dbRun(db, 'INSERT INTO invoice_items (invoice_id,description,quantity,unit_price,amount) VALUES (?,?,?,?,?)',
          [req.params.id, item.description, item.quantity||1, item.unit_price, item.amount]);
      }
    }
    const updated = await dbGet(db, 'SELECT * FROM invoices WHERE id=?', [req.params.id]);
    db.close();
    res.json({ success: true, data: updated });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

// DELETE /api/invoices/:id
router.delete('/:id', authenticateToken, authorize('delete'), async (req, res) => {
  const db = getDb();
  try {
    const result = await dbRun(db, 'DELETE FROM invoices WHERE id=?', [req.params.id]);
    db.close();
    if (result.changes===0) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) { db.close(); res.status(500).json({ error: err.message }); }
});

module.exports = router;

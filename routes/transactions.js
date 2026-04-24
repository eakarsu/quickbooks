const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { sanitizeInputs, validate, body, paginationValidation } = require('../middleware/validator');
const { bulkLimiter } = require('../middleware/rateLimiter');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const PDFDocument = require('pdfkit');

const router = express.Router();

function getDb() {
  return new sqlite3.Database(path.join(__dirname, '..', 'data', 'cashflow.db'));
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
  });
}

// GET /api/transactions - with pagination, search, filter, sort
router.get('/', authenticateToken, paginationValidation, validate, async (req, res) => {
  const db = getDb();
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sort = req.query.sort || 'date';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
    const filterType = req.query.type || '';
    const filterCategory = req.query.category || '';
    const filterStatus = req.query.status || '';
    const dateFrom = req.query.dateFrom || '';
    const dateTo = req.query.dateTo || '';
    const amountMin = req.query.amountMin || '';
    const amountMax = req.query.amountMax || '';

    let where = [];
    let params = [];

    if (search) {
      where.push('(description LIKE ? OR category LIKE ? OR reference LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filterType) { where.push('type = ?'); params.push(filterType); }
    if (filterCategory) { where.push('category = ?'); params.push(filterCategory); }
    if (filterStatus) { where.push('status = ?'); params.push(filterStatus); }
    if (dateFrom) { where.push('date >= ?'); params.push(dateFrom); }
    if (dateTo) { where.push('date <= ?'); params.push(dateTo); }
    if (amountMin) { where.push('absoluteAmount >= ?'); params.push(parseFloat(amountMin)); }
    if (amountMax) { where.push('absoluteAmount <= ?'); params.push(parseFloat(amountMax)); }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const allowedSorts = ['date', 'amount', 'category', 'description', 'type', 'created_at', 'absoluteAmount'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'date';

    const countRow = await dbGet(db, `SELECT COUNT(*) as total FROM transactions ${whereClause}`, params);
    const rows = await dbAll(db, `SELECT * FROM transactions ${whereClause} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);

    // Get distinct categories for filter options
    const categories = await dbAll(db, 'SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL ORDER BY category');

    db.close();
    res.json({
      success: true,
      data: rows,
      pagination: {
        page, limit,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limit),
      },
      filters: { categories: categories.map(c => c.category) },
    });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transactions/export/pdf - MUST be before /:id
router.get('/export/pdf', authenticateToken, authorize('export'), async (req, res) => {
  const db = getDb();
  try {
    const rows = await dbAll(db, 'SELECT * FROM transactions ORDER BY date DESC');
    db.close();

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=transactions.pdf');
    doc.pipe(res);

    doc.fontSize(20).text('Transaction Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table header
    const startX = 40;
    let y = doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Date', startX, y, { width: 70 });
    doc.text('Description', startX + 70, y, { width: 160 });
    doc.text('Category', startX + 230, y, { width: 80 });
    doc.text('Type', startX + 310, y, { width: 50 });
    doc.text('Amount', startX + 360, y, { width: 80, align: 'right' });
    doc.text('Status', startX + 440, y, { width: 60 });

    y += 15;
    doc.moveTo(startX, y).lineTo(startX + 500, y).stroke();
    y += 5;

    doc.font('Helvetica').fontSize(7);
    for (const row of rows) {
      if (y > 750) {
        doc.addPage();
        y = 40;
      }
      doc.text(row.date || '', startX, y, { width: 70 });
      doc.text((row.description || '').substring(0, 35), startX + 70, y, { width: 160 });
      doc.text(row.category || '', startX + 230, y, { width: 80 });
      doc.text(row.type || '', startX + 310, y, { width: 50 });
      doc.text(`$${(row.amount || 0).toFixed(2)}`, startX + 360, y, { width: 80, align: 'right' });
      doc.text(row.status || '', startX + 440, y, { width: 60 });
      y += 14;
    }

    // Summary
    doc.moveDown(2);
    const totalIncome = rows.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const totalExpense = rows.filter(r => r.type === 'expense').reduce((s, r) => s + Math.abs(r.amount), 0);
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text(`Total Income: $${totalIncome.toFixed(2)}`);
    doc.text(`Total Expenses: $${totalExpense.toFixed(2)}`);
    doc.text(`Net: $${(totalIncome - totalExpense).toFixed(2)}`);

    doc.end();
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions/bulk-delete - MUST be before /:id
router.post('/bulk-delete', authenticateToken, authorize('delete'), bulkLimiter, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Array of ids required' });

  const db = getDb();
  try {
    const placeholders = ids.map(() => '?').join(',');
    const result = await dbRun(db, `DELETE FROM transactions WHERE id IN (${placeholders})`, ids);
    db.close();
    res.json({ success: true, deleted: result.changes });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions/bulk-update - MUST be before /:id
router.post('/bulk-update', authenticateToken, authorize('write'), bulkLimiter, sanitizeInputs, async (req, res) => {
  const { ids, updates } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || !updates) {
    return res.status(400).json({ error: 'Array of ids and updates object required' });
  }

  const db = getDb();
  try {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      if (['category', 'status', 'type', 'payment_method'].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) { db.close(); return res.status(400).json({ error: 'No valid fields to update' }); }

    fields.push('updated_at = datetime("now")');
    const placeholders = ids.map(() => '?').join(',');
    const result = await dbRun(db, `UPDATE transactions SET ${fields.join(',')} WHERE id IN (${placeholders})`, [...values, ...ids]);
    db.close();
    res.json({ success: true, updated: result.changes });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions
router.post('/', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const { date, description, amount, category, subcategory, reference, type, payment_method, status, notes } = req.body;
  if (!date || amount === undefined) return res.status(400).json({ error: 'Date and amount required' });

  const db = getDb();
  try {
    const txnType = type || (parseFloat(amount) >= 0 ? 'income' : 'expense');
    const result = await dbRun(db,
      `INSERT INTO transactions (date,description,amount,category,subcategory,reference,type,absoluteAmount,payment_method,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [date, description, parseFloat(amount), category, subcategory, reference, txnType, Math.abs(parseFloat(amount)), payment_method, status || 'completed', notes]
    );
    const newRow = await dbGet(db, 'SELECT * FROM transactions WHERE id = ?', [result.lastID]);
    db.close();
    res.status(201).json({ success: true, data: newRow });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transactions/:id
router.get('/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const row = await dbGet(db, 'SELECT * FROM transactions WHERE id = ?', [req.params.id]);
    db.close();
    if (!row) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ success: true, data: row });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/transactions/:id
router.put('/:id', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const { date, description, amount, category, subcategory, reference, type, payment_method, status, notes } = req.body;
  const db = getDb();
  try {
    const existing = await dbGet(db, 'SELECT * FROM transactions WHERE id = ?', [req.params.id]);
    if (!existing) { db.close(); return res.status(404).json({ error: 'Transaction not found' }); }

    const newAmount = amount !== undefined ? parseFloat(amount) : existing.amount;
    const newType = type || (newAmount >= 0 ? 'income' : 'expense');

    await dbRun(db,
      `UPDATE transactions SET date=?,description=?,amount=?,category=?,subcategory=?,reference=?,type=?,absoluteAmount=?,payment_method=?,status=?,notes=?,updated_at=datetime("now") WHERE id=?`,
      [date || existing.date, description !== undefined ? description : existing.description, newAmount,
       category !== undefined ? category : existing.category, subcategory !== undefined ? subcategory : existing.subcategory,
       reference !== undefined ? reference : existing.reference, newType, Math.abs(newAmount),
       payment_method !== undefined ? payment_method : existing.payment_method,
       status || existing.status, notes !== undefined ? notes : existing.notes, req.params.id]
    );
    const updated = await dbGet(db, 'SELECT * FROM transactions WHERE id = ?', [req.params.id]);
    db.close();
    res.json({ success: true, data: updated });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', authenticateToken, authorize('delete'), async (req, res) => {
  const db = getDb();
  try {
    const result = await dbRun(db, 'DELETE FROM transactions WHERE id = ?', [req.params.id]);
    db.close();
    if (result.changes === 0) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ success: true, message: 'Transaction deleted' });
  } catch (err) {
    db.close();
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

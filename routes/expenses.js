const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { sanitizeInputs, validate, paginationValidation } = require('../middleware/validator');
const { bulkLimiter } = require('../middleware/rateLimiter');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const PDFDocument = require('pdfkit');

const router = express.Router();
function getDb() { return new sqlite3.Database(path.join(__dirname, '..', 'data', 'cashflow.db')); }
function dbAll(db, sql, p=[]) { return new Promise((res,rej)=>{db.all(sql,p,(e,r)=>e?rej(e):res(r));}); }
function dbGet(db, sql, p=[]) { return new Promise((res,rej)=>{db.get(sql,p,(e,r)=>e?rej(e):res(r));}); }
function dbRun(db, sql, p=[]) { return new Promise((res,rej)=>{db.run(sql,p,function(e){e?rej(e):res(this);});}); }

router.get('/', authenticateToken, paginationValidation, validate, async (req, res) => {
  const db = getDb();
  try {
    const page=parseInt(req.query.page)||1, limit=parseInt(req.query.limit)||10, offset=(page-1)*limit;
    const search=req.query.search||'', sort=req.query.sort||'date', order=req.query.order==='asc'?'ASC':'DESC';
    const filterStatus=req.query.status||'', filterCategory=req.query.category||'';
    let where=[], params=[];
    if (search) { where.push('(e.description LIKE ? OR e.category LIKE ? OR e.reference LIKE ? OR v.name LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`); }
    if (filterStatus) { where.push('e.status=?'); params.push(filterStatus); }
    if (filterCategory) { where.push('e.category=?'); params.push(filterCategory); }
    const wc = where.length>0?'WHERE '+where.join(' AND '):'';
    const allowedSorts=['date','amount','category','status','created_at'];
    const sortCol='e.'+(allowedSorts.includes(sort)?sort:'date');
    const count = await dbGet(db, `SELECT COUNT(*) as total FROM expenses e LEFT JOIN vendors v ON e.vendor_id=v.id ${wc}`, params);
    const rows = await dbAll(db, `SELECT e.*, v.name as vendor_name FROM expenses e LEFT JOIN vendors v ON e.vendor_id=v.id ${wc} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`, [...params,limit,offset]);
    const categories = await dbAll(db, 'SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL ORDER BY category');
    db.close();
    res.json({ success:true, data:rows, pagination:{page,limit,total:count.total,totalPages:Math.ceil(count.total/limit)}, filters:{categories:categories.map(c=>c.category)} });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// GET /api/expenses/export/pdf - MUST be before /:id
router.get('/export/pdf', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const rows = await dbAll(db, 'SELECT e.*, v.name as vendor_name FROM expenses e LEFT JOIN vendors v ON e.vendor_id=v.id ORDER BY e.date DESC');
    db.close();
    const doc = new PDFDocument({margin:40,size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=expenses.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Expense Report',{align:'center'}); doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()} | Total: ${rows.length}`,{align:'center'}); doc.moveDown(2);
    const x=40; let y=doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Date',x,y,{width:60}); doc.text('Vendor',x+60,y,{width:100}); doc.text('Category',x+160,y,{width:70});
    doc.text('Description',x+230,y,{width:120}); doc.text('Amount',x+350,y,{width:60,align:'right'}); doc.text('Status',x+420,y,{width:50});
    y+=15; doc.moveTo(x,y).lineTo(x+470,y).stroke(); y+=5;
    doc.font('Helvetica').fontSize(7);
    let totalAmount = 0;
    for (const r of rows) {
      if(y>750){doc.addPage();y=40;}
      doc.text(r.date||'',x,y,{width:60}); doc.text(r.vendor_name||'',x+60,y,{width:100});
      doc.text(r.category||'',x+160,y,{width:70}); doc.text((r.description||'').substring(0,25),x+230,y,{width:120});
      doc.text(`$${(r.amount||0).toFixed(2)}`,x+350,y,{width:60,align:'right'}); doc.text(r.status||'',x+420,y,{width:50});
      totalAmount += r.amount||0; y+=14;
    }
    doc.moveDown(2); doc.fontSize(10).font('Helvetica-Bold').text(`Total Expenses: $${totalAmount.toFixed(2)}`);
    doc.end();
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// POST /api/expenses/bulk-delete - MUST be before /:id
router.post('/bulk-delete', authenticateToken, authorize('delete'), bulkLimiter, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)||ids.length===0) return res.status(400).json({error:'Array of ids required'});
  const db = getDb();
  try {
    const ph=ids.map(()=>'?').join(',');
    const result = await dbRun(db, `DELETE FROM expenses WHERE id IN (${ph})`, ids);
    db.close();
    res.json({ success:true, deleted:result.changes });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// POST /api/expenses/bulk-update - MUST be before /:id
router.post('/bulk-update', authenticateToken, authorize('write'), bulkLimiter, sanitizeInputs, async (req, res) => {
  const { ids, updates } = req.body;
  if (!Array.isArray(ids)||!updates) return res.status(400).json({error:'ids and updates required'});
  const db = getDb();
  try {
    const fields=[], values=[];
    for (const [k,v] of Object.entries(updates)) { if (['status','category'].includes(k)) { fields.push(`${k}=?`); values.push(v); } }
    if (fields.length===0){db.close();return res.status(400).json({error:'No valid fields'});}
    fields.push('updated_at=datetime("now")');
    const ph=ids.map(()=>'?').join(',');
    const result = await dbRun(db, `UPDATE expenses SET ${fields.join(',')} WHERE id IN (${ph})`, [...values,...ids]);
    db.close();
    res.json({ success:true, updated:result.changes });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.post('/', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const { vendor_id,date,category,amount,description,payment_method,reference,status,notes } = req.body;
  if (!date||amount===undefined) return res.status(400).json({error:'Date and amount required'});
  const db = getDb();
  try {
    const result = await dbRun(db, 'INSERT INTO expenses (vendor_id,date,category,amount,description,payment_method,reference,status,notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [vendor_id,date,category,parseFloat(amount),description,payment_method,reference,status||'pending',notes]);
    const row = await dbGet(db, 'SELECT e.*, v.name as vendor_name FROM expenses e LEFT JOIN vendors v ON e.vendor_id=v.id WHERE e.id=?', [result.lastID]);
    db.close();
    res.status(201).json({ success:true, data:row });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.get('/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const row = await dbGet(db, 'SELECT e.*, v.name as vendor_name FROM expenses e LEFT JOIN vendors v ON e.vendor_id=v.id WHERE e.id=?', [req.params.id]);
    db.close();
    if (!row) return res.status(404).json({error:'Expense not found'});
    res.json({ success:true, data:row });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.put('/:id', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const db = getDb();
  try {
    const existing = await dbGet(db, 'SELECT * FROM expenses WHERE id=?', [req.params.id]);
    if (!existing){db.close();return res.status(404).json({error:'Expense not found'});}
    const { vendor_id,date,category,amount,description,payment_method,reference,status,notes } = req.body;
    await dbRun(db, 'UPDATE expenses SET vendor_id=?,date=?,category=?,amount=?,description=?,payment_method=?,reference=?,status=?,notes=?,updated_at=datetime("now") WHERE id=?',
      [vendor_id!==undefined?vendor_id:existing.vendor_id,date||existing.date,category!==undefined?category:existing.category,
       amount!==undefined?parseFloat(amount):existing.amount,description!==undefined?description:existing.description,
       payment_method!==undefined?payment_method:existing.payment_method,reference!==undefined?reference:existing.reference,
       status||existing.status,notes!==undefined?notes:existing.notes,req.params.id]);
    const updated = await dbGet(db, 'SELECT e.*, v.name as vendor_name FROM expenses e LEFT JOIN vendors v ON e.vendor_id=v.id WHERE e.id=?', [req.params.id]);
    db.close();
    res.json({ success:true, data:updated });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.delete('/:id', authenticateToken, authorize('delete'), async (req, res) => {
  const db = getDb();
  try {
    const result = await dbRun(db, 'DELETE FROM expenses WHERE id=?', [req.params.id]);
    db.close();
    if (result.changes===0) return res.status(404).json({error:'Expense not found'});
    res.json({ success:true, message:'Expense deleted' });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

module.exports = router;

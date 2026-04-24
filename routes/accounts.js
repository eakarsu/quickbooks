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
    const search=req.query.search||'', sort=req.query.sort||'account_number', order=req.query.order==='desc'?'DESC':'ASC';
    const filterType=req.query.type||'';
    let where=[], params=[];
    if (search) { where.push('(name LIKE ? OR description LIKE ? OR account_number LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
    if (filterType) { where.push('type=?'); params.push(filterType); }
    const wc = where.length>0?'WHERE '+where.join(' AND '):'';
    const allowedSorts=['name','type','account_number','balance','created_at'];
    const sortCol=allowedSorts.includes(sort)?sort:'account_number';
    const count = await dbGet(db, `SELECT COUNT(*) as total FROM accounts ${wc}`, params);
    const rows = await dbAll(db, `SELECT * FROM accounts ${wc} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`, [...params,limit,offset]);
    db.close();
    res.json({ success:true, data:rows, pagination:{page,limit,total:count.total,totalPages:Math.ceil(count.total/limit)} });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// GET /api/accounts/export/pdf - MUST be before /:id
router.get('/export/pdf', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const rows = await dbAll(db, 'SELECT * FROM accounts ORDER BY account_number');
    db.close();
    const doc = new PDFDocument({margin:40,size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=chart-of-accounts.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Chart of Accounts',{align:'center'}); doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()} | Total: ${rows.length}`,{align:'center'}); doc.moveDown(2);
    const x=40; let y=doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Acct #',x,y,{width:50}); doc.text('Name',x+50,y,{width:130}); doc.text('Type',x+180,y,{width:60});
    doc.text('Sub-Type',x+240,y,{width:80}); doc.text('Balance',x+320,y,{width:80,align:'right'});
    y+=15; doc.moveTo(x,y).lineTo(x+400,y).stroke(); y+=5;
    doc.font('Helvetica').fontSize(7);
    let totalAssets=0, totalLiabilities=0, totalEquity=0, totalIncome=0, totalExpenses=0;
    for (const r of rows) {
      if(y>750){doc.addPage();y=40;}
      doc.text(r.account_number||'',x,y,{width:50}); doc.text(r.name||'',x+50,y,{width:130});
      doc.text(r.type||'',x+180,y,{width:60}); doc.text(r.sub_type||'',x+240,y,{width:80});
      doc.text(`$${(r.balance||0).toFixed(2)}`,x+320,y,{width:80,align:'right'}); y+=14;
      if(r.type==='asset') totalAssets+=r.balance||0;
      if(r.type==='liability') totalLiabilities+=r.balance||0;
      if(r.type==='equity') totalEquity+=r.balance||0;
      if(r.type==='income') totalIncome+=r.balance||0;
      if(r.type==='expense') totalExpenses+=r.balance||0;
    }
    doc.moveDown(2); doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`Assets: $${totalAssets.toFixed(2)}  |  Liabilities: $${totalLiabilities.toFixed(2)}  |  Equity: $${totalEquity.toFixed(2)}`);
    doc.text(`Income: $${totalIncome.toFixed(2)}  |  Expenses: $${totalExpenses.toFixed(2)}`);
    doc.end();
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// POST /api/accounts/bulk-delete - MUST be before /:id
router.post('/bulk-delete', authenticateToken, authorize('delete'), bulkLimiter, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)||ids.length===0) return res.status(400).json({error:'Array of ids required'});
  const db = getDb();
  try {
    const ph=ids.map(()=>'?').join(',');
    const result = await dbRun(db, `DELETE FROM accounts WHERE id IN (${ph})`, ids);
    db.close();
    res.json({ success:true, deleted:result.changes });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// POST /api/accounts/bulk-update - MUST be before /:id
router.post('/bulk-update', authenticateToken, authorize('write'), bulkLimiter, sanitizeInputs, async (req, res) => {
  const { ids, updates } = req.body;
  if (!Array.isArray(ids)||!updates) return res.status(400).json({error:'ids and updates required'});
  const db = getDb();
  try {
    const fields=[], values=[];
    for (const [k,v] of Object.entries(updates)) { if (['type','is_active'].includes(k)) { fields.push(`${k}=?`); values.push(v); } }
    if (fields.length===0){db.close();return res.status(400).json({error:'No valid fields'});}
    fields.push('updated_at=datetime("now")');
    const ph=ids.map(()=>'?').join(',');
    const result = await dbRun(db, `UPDATE accounts SET ${fields.join(',')} WHERE id IN (${ph})`, [...values,...ids]);
    db.close();
    res.json({ success:true, updated:result.changes });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.post('/', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const { name,type,sub_type,account_number,description,balance,is_active,parent_id } = req.body;
  if (!name||!type) return res.status(400).json({error:'Name and type required'});
  const db = getDb();
  try {
    const result = await dbRun(db, 'INSERT INTO accounts (name,type,sub_type,account_number,description,balance,is_active,parent_id) VALUES (?,?,?,?,?,?,?,?)',
      [name,type,sub_type,account_number,description,balance||0,is_active!==undefined?is_active:1,parent_id||null]);
    const row = await dbGet(db, 'SELECT * FROM accounts WHERE id=?', [result.lastID]);
    db.close();
    res.status(201).json({ success:true, data:row });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.get('/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const row = await dbGet(db, 'SELECT * FROM accounts WHERE id=?', [req.params.id]);
    db.close();
    if (!row) return res.status(404).json({error:'Account not found'});
    res.json({ success:true, data:row });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.put('/:id', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const db = getDb();
  try {
    const existing = await dbGet(db, 'SELECT * FROM accounts WHERE id=?', [req.params.id]);
    if (!existing){db.close();return res.status(404).json({error:'Account not found'});}
    const { name,type,sub_type,account_number,description,balance,is_active,parent_id } = req.body;
    await dbRun(db, 'UPDATE accounts SET name=?,type=?,sub_type=?,account_number=?,description=?,balance=?,is_active=?,parent_id=?,updated_at=datetime("now") WHERE id=?',
      [name||existing.name,type||existing.type,sub_type!==undefined?sub_type:existing.sub_type,
       account_number!==undefined?account_number:existing.account_number,description!==undefined?description:existing.description,
       balance!==undefined?balance:existing.balance,is_active!==undefined?is_active:existing.is_active,
       parent_id!==undefined?parent_id:existing.parent_id,req.params.id]);
    const updated = await dbGet(db, 'SELECT * FROM accounts WHERE id=?', [req.params.id]);
    db.close();
    res.json({ success:true, data:updated });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.delete('/:id', authenticateToken, authorize('delete'), async (req, res) => {
  const db = getDb();
  try {
    const result = await dbRun(db, 'DELETE FROM accounts WHERE id=?', [req.params.id]);
    db.close();
    if (result.changes===0) return res.status(404).json({error:'Account not found'});
    res.json({ success:true, message:'Account deleted' });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

module.exports = router;

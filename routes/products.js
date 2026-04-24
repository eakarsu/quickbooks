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
    const search=req.query.search||'', sort=req.query.sort||'name', order=req.query.order==='desc'?'DESC':'ASC';
    const filterType=req.query.type||'', filterCategory=req.query.category||'';
    let where=[], params=[];
    if (search) { where.push('(name LIKE ? OR description LIKE ? OR sku LIKE ? OR category LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`); }
    if (filterType) { where.push('type=?'); params.push(filterType); }
    if (filterCategory) { where.push('category=?'); params.push(filterCategory); }
    const wc = where.length>0?'WHERE '+where.join(' AND '):'';
    const allowedSorts=['name','price','category','type','stock','created_at'];
    const sortCol=allowedSorts.includes(sort)?sort:'name';
    const count = await dbGet(db, `SELECT COUNT(*) as total FROM products ${wc}`, params);
    const rows = await dbAll(db, `SELECT * FROM products ${wc} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`, [...params,limit,offset]);
    const categories = await dbAll(db, 'SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category');
    db.close();
    res.json({ success:true, data:rows, pagination:{page,limit,total:count.total,totalPages:Math.ceil(count.total/limit)}, filters:{categories:categories.map(c=>c.category)} });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// GET /api/products/export/pdf - MUST be before /:id
router.get('/export/pdf', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const rows = await dbAll(db, 'SELECT * FROM products ORDER BY name');
    db.close();
    const doc = new PDFDocument({margin:40,size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=products.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Product & Service Catalog',{align:'center'}); doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()} | Total: ${rows.length}`,{align:'center'}); doc.moveDown(2);
    const x=40; let y=doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Name',x,y,{width:120}); doc.text('Type',x+120,y,{width:50}); doc.text('Category',x+170,y,{width:70});
    doc.text('Price',x+240,y,{width:60,align:'right'}); doc.text('Cost',x+300,y,{width:60,align:'right'}); doc.text('Stock',x+360,y,{width:40,align:'right'});
    y+=15; doc.moveTo(x,y).lineTo(x+400,y).stroke(); y+=5;
    doc.font('Helvetica').fontSize(7);
    for (const r of rows) {
      if(y>750){doc.addPage();y=40;}
      doc.text(r.name||'',x,y,{width:120}); doc.text(r.type||'',x+120,y,{width:50}); doc.text(r.category||'',x+170,y,{width:70});
      doc.text(`$${(r.price||0).toFixed(2)}`,x+240,y,{width:60,align:'right'}); doc.text(`$${(r.cost||0).toFixed(2)}`,x+300,y,{width:60,align:'right'});
      doc.text(`${r.stock||0}`,x+360,y,{width:40,align:'right'}); y+=14;
    }
    doc.end();
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// POST /api/products/bulk-delete - MUST be before /:id
router.post('/bulk-delete', authenticateToken, authorize('delete'), bulkLimiter, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)||ids.length===0) return res.status(400).json({error:'Array of ids required'});
  const db = getDb();
  try {
    const ph=ids.map(()=>'?').join(',');
    const result = await dbRun(db, `DELETE FROM products WHERE id IN (${ph})`, ids);
    db.close();
    res.json({ success:true, deleted:result.changes });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

// POST /api/products/bulk-update - MUST be before /:id
router.post('/bulk-update', authenticateToken, authorize('write'), bulkLimiter, sanitizeInputs, async (req, res) => {
  const { ids, updates } = req.body;
  if (!Array.isArray(ids)||!updates) return res.status(400).json({error:'ids and updates required'});
  const db = getDb();
  try {
    const fields=[], values=[];
    for (const [k,v] of Object.entries(updates)) { if (['category','type','is_active'].includes(k)) { fields.push(`${k}=?`); values.push(v); } }
    if (fields.length===0){db.close();return res.status(400).json({error:'No valid fields'});}
    fields.push('updated_at=datetime("now")');
    const ph=ids.map(()=>'?').join(',');
    const result = await dbRun(db, `UPDATE products SET ${fields.join(',')} WHERE id IN (${ph})`, [...values,...ids]);
    db.close();
    res.json({ success:true, updated:result.changes });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.post('/', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const { name,description,type,price,cost,category,sku,stock,unit,is_active } = req.body;
  if (!name||price===undefined) return res.status(400).json({error:'Name and price required'});
  const db = getDb();
  try {
    const result = await dbRun(db, 'INSERT INTO products (name,description,type,price,cost,category,sku,stock,unit,is_active) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [name,description,type||'product',parseFloat(price),cost||0,category,sku,stock||0,unit||'each',is_active!==undefined?is_active:1]);
    const row = await dbGet(db, 'SELECT * FROM products WHERE id=?', [result.lastID]);
    db.close();
    res.status(201).json({ success:true, data:row });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.get('/:id', authenticateToken, async (req, res) => {
  const db = getDb();
  try {
    const row = await dbGet(db, 'SELECT * FROM products WHERE id=?', [req.params.id]);
    db.close();
    if (!row) return res.status(404).json({error:'Product not found'});
    res.json({ success:true, data:row });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.put('/:id', authenticateToken, authorize('write'), sanitizeInputs, async (req, res) => {
  const db = getDb();
  try {
    const existing = await dbGet(db, 'SELECT * FROM products WHERE id=?', [req.params.id]);
    if (!existing){db.close();return res.status(404).json({error:'Product not found'});}
    const { name,description,type,price,cost,category,sku,stock,unit,is_active } = req.body;
    await dbRun(db, 'UPDATE products SET name=?,description=?,type=?,price=?,cost=?,category=?,sku=?,stock=?,unit=?,is_active=?,updated_at=datetime("now") WHERE id=?',
      [name||existing.name,description!==undefined?description:existing.description,type||existing.type,
       price!==undefined?parseFloat(price):existing.price,cost!==undefined?cost:existing.cost,
       category!==undefined?category:existing.category,sku!==undefined?sku:existing.sku,
       stock!==undefined?stock:existing.stock,unit||existing.unit,is_active!==undefined?is_active:existing.is_active,req.params.id]);
    const updated = await dbGet(db, 'SELECT * FROM products WHERE id=?', [req.params.id]);
    db.close();
    res.json({ success:true, data:updated });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

router.delete('/:id', authenticateToken, authorize('delete'), async (req, res) => {
  const db = getDb();
  try {
    const result = await dbRun(db, 'DELETE FROM products WHERE id=?', [req.params.id]);
    db.close();
    if (result.changes===0) return res.status(404).json({error:'Product not found'});
    res.json({ success:true, message:'Product deleted' });
  } catch(err){db.close();res.status(500).json({error:err.message});}
});

module.exports = router;

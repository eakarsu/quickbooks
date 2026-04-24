const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'cashflow.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Delete existing DB to start fresh
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function setup() {
  console.log('Setting up database...');

  await run('PRAGMA journal_mode=WAL');
  await run('PRAGMA foreign_keys=ON');

  // ===================== TABLES =====================

  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin','manager','user','viewer')),
    email_verified INTEGER DEFAULT 0,
    verification_token TEXT,
    reset_token TEXT,
    reset_token_expires TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    category TEXT,
    subcategory TEXT,
    reference TEXT,
    type TEXT CHECK(type IN ('income','expense')),
    absoluteAmount REAL,
    payment_method TEXT,
    status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','cancelled')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    notes TEXT,
    balance REAL DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    invoice_number TEXT UNIQUE NOT NULL,
    date TEXT NOT NULL,
    due_date TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','paid','overdue','cancelled')),
    subtotal REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_price REAL NOT NULL,
    amount REAL NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    notes TEXT,
    balance REAL DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER,
    date TEXT NOT NULL,
    category TEXT,
    amount REAL NOT NULL,
    description TEXT,
    payment_method TEXT,
    reference TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','paid','rejected')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'product' CHECK(type IN ('product','service')),
    price REAL NOT NULL,
    cost REAL DEFAULT 0,
    category TEXT,
    sku TEXT,
    stock INTEGER DEFAULT 0,
    unit TEXT DEFAULT 'each',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')),
    sub_type TEXT,
    account_number TEXT,
    description TEXT,
    balance REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    parent_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES accounts(id)
  )`);

  console.log('All tables created.');

  // ===================== SEED DATA =====================

  // --- Users (15) ---
  const passwordHash = await bcrypt.hash('Password123!', 10);
  const users = [
    ['admin', 'admin@company.com', passwordHash, 'admin', 1, 'Sarah', 'Johnson', '555-0101'],
    ['manager1', 'manager1@company.com', passwordHash, 'manager', 1, 'Michael', 'Chen', '555-0102'],
    ['manager2', 'manager2@company.com', passwordHash, 'manager', 1, 'Jessica', 'Williams', '555-0103'],
    ['user1', 'john@company.com', passwordHash, 'user', 1, 'John', 'Smith', '555-0104'],
    ['user2', 'emily@company.com', passwordHash, 'user', 1, 'Emily', 'Davis', '555-0105'],
    ['user3', 'david@company.com', passwordHash, 'user', 1, 'David', 'Brown', '555-0106'],
    ['user4', 'lisa@company.com', passwordHash, 'user', 1, 'Lisa', 'Wilson', '555-0107'],
    ['user5', 'robert@company.com', passwordHash, 'user', 1, 'Robert', 'Taylor', '555-0108'],
    ['user6', 'amanda@company.com', passwordHash, 'user', 1, 'Amanda', 'Anderson', '555-0109'],
    ['user7', 'james@company.com', passwordHash, 'user', 1, 'James', 'Thomas', '555-0110'],
    ['user8', 'jennifer@company.com', passwordHash, 'user', 1, 'Jennifer', 'Jackson', '555-0111'],
    ['viewer1', 'viewer1@company.com', passwordHash, 'viewer', 1, 'Chris', 'Martin', '555-0112'],
    ['viewer2', 'viewer2@company.com', passwordHash, 'viewer', 1, 'Nancy', 'Lee', '555-0113'],
    ['viewer3', 'viewer3@company.com', passwordHash, 'viewer', 1, 'Kevin', 'Harris', '555-0114'],
    ['viewer4', 'viewer4@company.com', passwordHash, 'viewer', 1, 'Maria', 'Clark', '555-0115'],
  ];
  for (const u of users) {
    await run(`INSERT INTO users (username,email,password_hash,role,email_verified,first_name,last_name,phone) VALUES (?,?,?,?,?,?,?,?)`, u);
  }
  console.log('Seeded 15 users (password: Password123!)');

  // --- Transactions (20) ---
  const transactions = [
    ['2025-01-05','Monthly office rent',-2500,'Rent','Office','RNT-001','expense',2500,'bank_transfer','completed'],
    ['2025-01-08','Client payment - Web Design',4500,'Sales','Web Design','INV-1001','income',4500,'bank_transfer','completed'],
    ['2025-01-10','Office supplies purchase',-185.50,'Supplies','Office','SUP-001','expense',185.50,'credit_card','completed'],
    ['2025-01-12','Electricity bill',-320,'Utilities','Electric','UTL-001','expense',320,'bank_transfer','completed'],
    ['2025-01-15','Software subscription - Adobe',-54.99,'Software','Subscriptions','SW-001','expense',54.99,'credit_card','completed'],
    ['2025-01-18','Client payment - Logo Design',1200,'Sales','Design','INV-1002','income',1200,'check','completed'],
    ['2025-01-20','Internet service',-89.99,'Utilities','Internet','UTL-002','expense',89.99,'bank_transfer','completed'],
    ['2025-01-22','Employee payroll',-8500,'Payroll','Salaries','PAY-001','expense',8500,'bank_transfer','completed'],
    ['2025-01-25','Client payment - Consulting',3200,'Sales','Consulting','INV-1003','income',3200,'bank_transfer','completed'],
    ['2025-02-01','Monthly office rent',-2500,'Rent','Office','RNT-002','expense',2500,'bank_transfer','completed'],
    ['2025-02-03','Marketing campaign',-750,'Marketing','Digital','MKT-001','expense',750,'credit_card','completed'],
    ['2025-02-05','Client payment - App Dev',8500,'Sales','Development','INV-1004','income',8500,'bank_transfer','completed'],
    ['2025-02-08','Office furniture',-1200,'Equipment','Furniture','EQP-001','expense',1200,'credit_card','completed'],
    ['2025-02-10','Phone bill',-145,'Utilities','Phone','UTL-003','expense',145,'bank_transfer','completed'],
    ['2025-02-12','Client payment - SEO Services',2800,'Sales','SEO','INV-1005','income',2800,'check','completed'],
    ['2025-02-15','Insurance premium',-450,'Insurance','Business','INS-001','expense',450,'bank_transfer','completed'],
    ['2025-02-18','Travel expenses',-680,'Travel','Business Trip','TRV-001','expense',680,'credit_card','completed'],
    ['2025-02-20','Client payment - Social Media',1500,'Sales','Social Media','INV-1006','income',1500,'bank_transfer','completed'],
    ['2025-02-22','Server hosting',-199,'Software','Hosting','SW-002','expense',199,'credit_card','completed'],
    ['2025-02-25','Printing services',-275,'Supplies','Print','SUP-002','expense',275,'credit_card','completed'],
  ];
  for (const t of transactions) {
    await run(`INSERT INTO transactions (date,description,amount,category,subcategory,reference,type,absoluteAmount,payment_method,status) VALUES (?,?,?,?,?,?,?,?,?,?)`, t);
  }
  console.log('Seeded 20 transactions');

  // --- Customers (18) ---
  const customers = [
    ['Acme Corporation','contact@acme.com','555-1001','Acme Corp','123 Business Ave','New York','NY','10001','Long-term client',15000,'active'],
    ['TechStart Inc','info@techstart.com','555-1002','TechStart','456 Innovation Dr','San Francisco','CA','94105','Startup client',8500,'active'],
    ['Green Valley LLC','hello@greenvalley.com','555-1003','Green Valley','789 Nature Blvd','Portland','OR','97201','Eco-friendly company',3200,'active'],
    ['Metro Design Studio','studio@metrodesign.com','555-1004','Metro Design','321 Art Street','Chicago','IL','60601','Design agency partner',6700,'active'],
    ['Sunrise Healthcare','admin@sunrisehc.com','555-1005','Sunrise HC','654 Medical Pkwy','Houston','TX','77001','Healthcare provider',12000,'active'],
    ['Pacific Trading Co','trade@pacifictc.com','555-1006','Pacific Trading','987 Harbor Rd','Seattle','WA','98101','Import/export client',4500,'active'],
    ['Mountain View Realty','info@mvrealty.com','555-1007','MV Realty','147 Summit Ave','Denver','CO','80201','Real estate firm',9800,'active'],
    ['Blue Ocean Analytics','data@blueocean.com','555-1008','Blue Ocean','258 Data Lane','Boston','MA','02101','Analytics firm',7200,'active'],
    ['Golden Gate Foods','orders@ggfoods.com','555-1009','GG Foods','369 Market St','San Francisco','CA','94102','Restaurant chain',5600,'active'],
    ['Liberty Financial','consult@libertyfin.com','555-1010','Liberty Financial','741 Wall Street','New York','NY','10005','Financial advisory',18000,'active'],
    ['Evergreen Solutions','support@evergreen.com','555-1011','Evergreen','852 Pine Road','Seattle','WA','98102','IT solutions provider',4200,'active'],
    ['Stellar Marketing','hello@stellarmktg.com','555-1012','Stellar Marketing','963 Brand Ave','Los Angeles','CA','90001','Marketing agency',3800,'active'],
    ['Atlas Construction','project@atlascon.com','555-1013','Atlas Construction','174 Build Blvd','Dallas','TX','75201','Construction company',22000,'active'],
    ['Riverside Consulting','team@riverside.com','555-1014','Riverside','285 River Dr','Philadelphia','PA','19101','Management consulting',11500,'active'],
    ['Nova Education','learn@novaedu.com','555-1015','Nova Education','396 Campus Way','Austin','TX','78701','Education platform',6800,'inactive'],
    ['Pinnacle Sports','info@pinnaclesports.com','555-1016','Pinnacle Sports','507 Stadium Rd','Miami','FL','33101','Sports equipment',2900,'active'],
    ['Harmony Music','booking@harmonymusic.com','555-1017','Harmony Music','618 Melody Lane','Nashville','TN','37201','Music production',1500,'inactive'],
    ['Crystal Clear Optics','sales@crystaloptics.com','555-1018','Crystal Clear','729 Vision Blvd','Phoenix','AZ','85001','Optical equipment',7400,'active'],
  ];
  for (const c of customers) {
    await run(`INSERT INTO customers (name,email,phone,company,address,city,state,zip,notes,balance,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, c);
  }
  console.log('Seeded 18 customers');

  // --- Invoices (18) ---
  const invoices = [
    [1,'INV-2025-001','2025-01-05','2025-02-04','paid',4500,10,450,4950,'Web design project'],
    [2,'INV-2025-002','2025-01-10','2025-02-09','paid',1200,0,0,1200,'Logo design'],
    [3,'INV-2025-003','2025-01-15','2025-02-14','sent',3200,8,256,3456,'Consulting services'],
    [4,'INV-2025-004','2025-01-20','2025-02-19','overdue',8500,10,850,9350,'App development phase 1'],
    [5,'INV-2025-005','2025-01-25','2025-02-24','paid',2800,0,0,2800,'SEO optimization'],
    [6,'INV-2025-006','2025-02-01','2025-03-03','sent',1500,10,150,1650,'Social media management'],
    [7,'INV-2025-007','2025-02-05','2025-03-07','draft',5200,8,416,5616,'Marketing campaign'],
    [8,'INV-2025-008','2025-02-08','2025-03-10','sent',3600,10,360,3960,'Database migration'],
    [9,'INV-2025-009','2025-02-10','2025-03-12','paid',1800,0,0,1800,'Content writing'],
    [10,'INV-2025-010','2025-02-12','2025-03-14','draft',9500,10,950,10450,'Enterprise software'],
    [11,'INV-2025-011','2025-02-14','2025-03-16','sent',2200,8,176,2376,'Network setup'],
    [12,'INV-2025-012','2025-02-16','2025-03-18','overdue',4100,0,0,4100,'Brand identity'],
    [13,'INV-2025-013','2025-02-18','2025-03-20','paid',6800,10,680,7480,'Construction consultation'],
    [14,'INV-2025-014','2025-02-20','2025-03-22','sent',3400,8,272,3672,'Strategic planning'],
    [1,'INV-2025-015','2025-02-22','2025-03-24','draft',7200,10,720,7920,'Phase 2 development'],
    [16,'INV-2025-016','2025-02-24','2025-03-26','sent',1900,0,0,1900,'Equipment rental'],
    [2,'INV-2025-017','2025-02-26','2025-03-28','draft',4400,10,440,4840,'Mobile app prototype'],
    [18,'INV-2025-018','2025-02-28','2025-03-30','sent',5800,8,464,6264,'Optical system install'],
  ];
  for (const inv of invoices) {
    await run(`INSERT INTO invoices (customer_id,invoice_number,date,due_date,status,subtotal,tax_rate,tax_amount,total,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`, inv);
  }
  console.log('Seeded 18 invoices');

  // --- Invoice Items (30+) ---
  const invoiceItems = [
    [1,'Homepage design',1,2000,2000],[1,'Inner pages design (5)',5,500,2500],
    [2,'Logo concept development',1,800,800],[2,'Logo finalization',1,400,400],
    [3,'Strategy consultation',8,400,3200],
    [4,'Mobile app development',1,5000,5000],[4,'UI/UX design',1,2000,2000],[4,'Testing & QA',1,1500,1500],
    [5,'Keyword research',1,800,800],[5,'On-page SEO',1,1200,1200],[5,'Link building',1,800,800],
    [6,'Social media strategy',1,500,500],[6,'Monthly content creation',1,1000,1000],
    [7,'Campaign strategy',1,2000,2000],[7,'Ad creative design',5,400,2000],[7,'Analytics setup',1,1200,1200],
    [8,'Database audit',1,1200,1200],[8,'Migration execution',1,2400,2400],
    [9,'Blog articles (6)',6,200,1200],[9,'Website copy',1,600,600],
    [10,'Requirements analysis',1,2500,2500],[10,'Development phase 1',1,4500,4500],[10,'Training',1,2500,2500],
    [11,'Network assessment',1,800,800],[11,'Hardware setup',1,1400,1400],
    [12,'Brand research',1,1500,1500],[12,'Visual identity',1,2600,2600],
    [13,'Site assessment',1,3000,3000],[13,'Engineering review',1,3800,3800],
    [14,'Business analysis',10,340,3400],
  ];
  for (const item of invoiceItems) {
    await run(`INSERT INTO invoice_items (invoice_id,description,quantity,unit_price,amount) VALUES (?,?,?,?,?)`, item);
  }
  console.log('Seeded 30 invoice items');

  // --- Vendors (18) ---
  const vendors = [
    ['Office Depot','orders@officedepot.com','555-2001','Office Depot Inc','100 Supply Ave','Boca Raton','FL','33431','Office supplies vendor',1250,'active'],
    ['Amazon Web Services','billing@aws.com','555-2002','AWS','410 Terry Ave N','Seattle','WA','98109','Cloud hosting',3200,'active'],
    ['Adobe Systems','billing@adobe.com','555-2003','Adobe Inc','345 Park Ave','San Jose','CA','95110','Software licenses',659.88,'active'],
    ['Google Workspace','billing@google.com','555-2004','Google LLC','1600 Amphitheatre','Mountain View','CA','94043','Email & productivity',1440,'active'],
    ['FedEx','accounts@fedex.com','555-2005','FedEx Corp','942 S Shady Grove','Memphis','TN','38120','Shipping services',890,'active'],
    ['Staples','business@staples.com','555-2006','Staples Inc','500 Staples Dr','Framingham','MA','01702','Office equipment',2100,'active'],
    ['AT&T Business','business@att.com','555-2007','AT&T Inc','208 S Akard St','Dallas','TX','75202','Phone & internet',1740,'active'],
    ['Progressive Insurance','commercial@progressive.com','555-2008','Progressive','6300 Wilson Mills','Mayfield Village','OH','44143','Business insurance',5400,'active'],
    ['WeWork','billing@wework.com','555-2009','WeWork Companies','115 W 18th St','New York','NY','10011','Office space',30000,'active'],
    ['Zoom','billing@zoom.us','555-2010','Zoom Video','55 Almaden Blvd','San Jose','CA','95113','Video conferencing',200,'active'],
    ['Slack Technologies','billing@slack.com','555-2011','Slack','500 Howard St','San Francisco','CA','94105','Team communication',960,'active'],
    ['UPS','business@ups.com','555-2012','UPS','55 Glenlake Pkwy','Atlanta','GA','30328','Package delivery',650,'active'],
    ['Verizon Business','enterprise@verizon.com','555-2013','Verizon','1095 Avenue of Americas','New York','NY','10036','Mobile service',1200,'active'],
    ['Dell Technologies','orders@dell.com','555-2014','Dell Inc','1 Dell Way','Round Rock','TX','78682','Computer hardware',8500,'active'],
    ['Comcast Business','billing@comcast.com','555-2015','Comcast','1701 JFK Blvd','Philadelphia','PA','19103','Internet service',1080,'inactive'],
    ['LinkedIn','billing@linkedin.com','555-2016','LinkedIn Corp','1000 W Maude Ave','Sunnyvale','CA','94085','Recruiting platform',3600,'active'],
    ['Mailchimp','billing@mailchimp.com','555-2017','Mailchimp','675 Ponce De Leon','Atlanta','GA','30308','Email marketing',300,'active'],
    ['Geico Commercial','commercial@geico.com','555-2018','Geico','5260 Western Ave','Chevy Chase','MD','20815','Auto insurance',2400,'active'],
  ];
  for (const v of vendors) {
    await run(`INSERT INTO vendors (name,email,phone,company,address,city,state,zip,notes,balance,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, v);
  }
  console.log('Seeded 18 vendors');

  // --- Expenses (20) ---
  const expenses = [
    [1,'2025-01-03','Supplies',185.50,'Office supplies - pens, paper, toner','credit_card','EXP-001','paid','Monthly supplies order'],
    [9,'2025-01-05','Rent',2500,'Monthly office rent - January','bank_transfer','EXP-002','paid','Auto-pay'],
    [3,'2025-01-08','Software',54.99,'Adobe Creative Cloud subscription','credit_card','EXP-003','paid','Annual plan'],
    [7,'2025-01-10','Utilities',89.99,'AT&T internet service','bank_transfer','EXP-004','paid',null],
    [8,'2025-01-12','Insurance',450,'Business insurance premium','bank_transfer','EXP-005','paid','Quarterly payment'],
    [4,'2025-01-15','Software',14.99,'Google Workspace subscription','credit_card','EXP-006','paid','Monthly'],
    [5,'2025-01-18','Shipping',45.50,'FedEx package delivery','credit_card','EXP-007','paid',null],
    [2,'2025-01-20','Software',199,'AWS hosting - January','credit_card','EXP-008','paid','Monthly hosting'],
    [10,'2025-01-22','Software',14.99,'Zoom Pro subscription','credit_card','EXP-009','paid','Monthly'],
    [6,'2025-01-25','Equipment',1200,'Ergonomic standing desks x2','credit_card','EXP-010','approved','New employee setup'],
    [14,'2025-01-28','Equipment',2400,'Dell laptop for development','credit_card','EXP-011','paid','Developer workstation'],
    [11,'2025-02-01','Software',8,'Slack standard plan','credit_card','EXP-012','paid','Per user per month'],
    [9,'2025-02-05','Rent',2500,'Monthly office rent - February','bank_transfer','EXP-013','paid','Auto-pay'],
    [13,'2025-02-08','Utilities',145,'Verizon mobile service','bank_transfer','EXP-014','pending',null],
    [17,'2025-02-10','Marketing',99,'Mailchimp email campaign','credit_card','EXP-015','paid','Newsletter blast'],
    [16,'2025-02-12','Marketing',299,'LinkedIn job posting','credit_card','EXP-016','paid','Senior developer role'],
    [12,'2025-02-15','Shipping',32.50,'UPS ground shipping','credit_card','EXP-017','paid',null],
    [7,'2025-02-18','Utilities',320,'AT&T phone service','bank_transfer','EXP-018','pending','Office phones'],
    [18,'2025-02-20','Insurance',200,'Commercial auto insurance','bank_transfer','EXP-019','paid','Monthly'],
    [1,'2025-02-22','Supplies',275,'Printer paper and ink cartridges','credit_card','EXP-020','approved','Bulk order'],
  ];
  for (const e of expenses) {
    await run(`INSERT INTO expenses (vendor_id,date,category,amount,description,payment_method,reference,status,notes) VALUES (?,?,?,?,?,?,?,?,?)`, e);
  }
  console.log('Seeded 20 expenses');

  // --- Products/Services (18) ---
  const products = [
    ['Website Design','Custom website design and development','service',2500,0,'Design',null,0,'project',1],
    ['Logo Design','Professional logo and brand identity','service',800,0,'Design',null,0,'project',1],
    ['SEO Package','Search engine optimization monthly package','service',1200,0,'Marketing','SEO-001',0,'month',1],
    ['Social Media Management','Monthly social media content and management','service',1500,0,'Marketing','SMM-001',0,'month',1],
    ['Consulting Hour','Business consulting per hour','service',150,0,'Consulting',null,0,'hour',1],
    ['Mobile App Development','Custom mobile application development','service',8000,0,'Development',null,0,'project',1],
    ['Database Migration','Database migration and optimization','service',3000,0,'Development','DBM-001',0,'project',1],
    ['Content Writing','Blog posts and website content','service',200,0,'Content','CW-001',0,'article',1],
    ['Network Setup','Office network installation and setup','service',2200,0,'IT Services','NET-001',0,'project',1],
    ['Cloud Hosting - Basic','Basic cloud hosting plan','service',49.99,20,'Hosting','HOST-B',0,'month',1],
    ['Cloud Hosting - Pro','Professional cloud hosting plan','service',149.99,60,'Hosting','HOST-P',0,'month',1],
    ['SSL Certificate','Annual SSL certificate','product',99,30,'Security','SSL-001',50,'year',1],
    ['Domain Registration','Annual domain name registration','product',14.99,8,'Hosting','DOM-001',100,'year',1],
    ['Business Card Design','Professional business card design','service',150,0,'Design','BCD-001',0,'set',1],
    ['Email Marketing Setup','Email marketing platform setup','service',500,0,'Marketing','EM-001',0,'project',1],
    ['Training Session','On-site training session (half day)','service',800,0,'Training','TRN-001',0,'session',1],
    ['Maintenance Plan','Monthly website maintenance','service',299,0,'Support','MNT-001',0,'month',1],
    ['Security Audit','Comprehensive security assessment','service',2500,0,'Security','SEC-001',0,'project',1],
  ];
  for (const p of products) {
    await run(`INSERT INTO products (name,description,type,price,cost,category,sku,stock,unit,is_active) VALUES (?,?,?,?,?,?,?,?,?,?)`, p);
  }
  console.log('Seeded 18 products');

  // --- Accounts / Chart of Accounts (20) ---
  const accounts = [
    ['Cash','asset','Bank','1000','Main operating cash account',50000,1,null],
    ['Accounts Receivable','asset','Current Asset','1100','Customer outstanding balances',35000,1,null],
    ['Inventory','asset','Current Asset','1200','Product inventory',8500,1,null],
    ['Equipment','asset','Fixed Asset','1500','Office equipment and computers',15000,1,null],
    ['Accumulated Depreciation','asset','Fixed Asset','1501','Depreciation of fixed assets',-3500,1,null],
    ['Accounts Payable','liability','Current Liability','2000','Vendor outstanding balances',-12000,1,null],
    ['Credit Card Payable','liability','Current Liability','2100','Credit card balances',-3200,1,null],
    ['Payroll Liabilities','liability','Current Liability','2200','Payroll taxes and withholdings',-2800,1,null],
    ['Sales Tax Payable','liability','Current Liability','2300','Collected sales tax',-1500,1,null],
    ['Bank Loan','liability','Long-term Liability','2500','Business line of credit',-25000,1,null],
    ['Owner Equity','equity','Owner Equity','3000','Owner investment',50000,1,null],
    ['Retained Earnings','equity','Retained Earnings','3100','Accumulated profits',28000,1,null],
    ['Sales Revenue','income','Revenue','4000','Income from services and products',0,1,null],
    ['Consulting Revenue','income','Revenue','4100','Income from consulting',0,1,null],
    ['Interest Income','income','Other Income','4500','Bank interest earned',0,1,null],
    ['Rent Expense','expense','Operating Expense','5000','Office rent',0,1,null],
    ['Utilities Expense','expense','Operating Expense','5100','Electric, internet, phone',0,1,null],
    ['Payroll Expense','expense','Operating Expense','5200','Employee salaries and wages',0,1,null],
    ['Marketing Expense','expense','Operating Expense','5300','Advertising and marketing',0,1,null],
    ['Office Supplies','expense','Operating Expense','5400','General office supplies',0,1,null],
  ];
  for (const a of accounts) {
    await run(`INSERT INTO accounts (name,type,sub_type,account_number,description,balance,is_active,parent_id) VALUES (?,?,?,?,?,?,?,?)`, a);
  }
  console.log('Seeded 20 accounts');

  console.log('\nDatabase setup complete!');
  console.log('Default login: admin / Password123!');
  db.close();
}

setup().catch(err => {
  console.error('Setup failed:', err);
  db.close();
  process.exit(1);
});

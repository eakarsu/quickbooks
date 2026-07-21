CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','manager','user','viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version > 0),
  email_verified INTEGER NOT NULL DEFAULT 1 CHECK(email_verified IN (0,1)),
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
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
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT, notes TEXT, balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER REFERENCES customers(id), invoice_number TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','paid','overdue','cancelled')),
  subtotal REAL NOT NULL DEFAULT 0, tax_rate REAL NOT NULL DEFAULT 0, tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL, amount REAL NOT NULL
);

CREATE TABLE vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT, notes TEXT, balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER REFERENCES vendors(id), date TEXT NOT NULL, category TEXT,
  amount REAL NOT NULL, description TEXT, payment_method TEXT, reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','paid','rejected')), notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
  type TEXT NOT NULL DEFAULT 'product' CHECK(type IN ('product','service')), price REAL NOT NULL, cost REAL NOT NULL DEFAULT 0,
  category TEXT, sku TEXT, stock INTEGER NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'each', is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')), sub_type TEXT,
  account_number TEXT, description TEXT, balance REAL NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  parent_id INTEGER REFERENCES accounts(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_transactions_date ON transactions(date);

-- ========================================================
-- TITAN PAY - Custom Payment Gateway & Hotspot Database Schema
-- ========================================================

-- 1. Gateway Merchants (Your projects/apps that use this gateway)
CREATE TABLE IF NOT EXISTS gateway_merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  secret_key TEXT NOT NULL,
  webhook_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Merchant Receiving Accounts (Your bKash / Nagad / Rocket Numbers)
CREATE TABLE IF NOT EXISTS merchant_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL, -- 'bkash', 'nagad', 'rocket'
  account_number TEXT NOT NULL,
  account_type TEXT DEFAULT 'merchant', -- 'merchant', 'personal'
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Invoices (The core checkout sessions)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  merchant_id TEXT DEFAULT 'titan_hotspot',
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'BDT',
  provider TEXT DEFAULT 'bkash',
  customer_phone TEXT,
  client_mac TEXT,
  client_ip TEXT,
  tok TEXT,
  gateway_address TEXT,
  gateway_port TEXT,
  authaction TEXT,
  trx_id TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'cancelled', 'expired'
  redirect_url TEXT,
  webhook_url TEXT,
  metadata TEXT, -- JSON for extra data like package_id, duration_minutes
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME,
  expires_at DATETIME
);

-- 4. Verified SMS Transactions (from Merchant Phone)
CREATE TABLE IF NOT EXISTS verified_transactions (
  trx_id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  sender_phone TEXT,
  raw_message TEXT,
  used INTEGER DEFAULT 0,
  used_by_invoice_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Hotspot Packages
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  active INTEGER DEFAULT 1
);

-- 6. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed default data (Replace with your actual bKash / Nagad numbers)
INSERT OR IGNORE INTO merchant_accounts (id, provider, account_number, account_type, active) VALUES
('acc_bkash_main', 'bkash', '017XXXXXXXX', 'merchant', 1),
('acc_nagad_main', 'nagad', '018XXXXXXXX', 'personal', 1);

INSERT OR IGNORE INTO gateway_merchants (id, name, api_key, secret_key) VALUES
('titan_hotspot', 'TITAN Hotspot Service', 'tp_live_key_sample_2026', 'tp_sec_key_sample_2026');

INSERT OR IGNORE INTO packages (id, name, price, duration_minutes, active) VALUES
('hour1', '2 Hours', 10, 120, 1),
('day1', '1 Day', 25, 1440, 0),
('week1', '7 Days', 50, 10080, 1),
('month1', '1 Month', 150, 43200, 1);

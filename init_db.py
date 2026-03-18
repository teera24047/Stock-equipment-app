"""
init_db.py — สร้าง Tables ทั้งหมดในฐานข้อมูล stoc_app
รัน: python3 init_db.py
"""

import mysql.connector
import bcrypt
from datetime import datetime

DB_CONFIG = {
    'host':     '192.168.101.41',
    'port':     3306,
    'user':     'stocapp',
    'password': 'Boss@194219',
    'database': 'stoc_app',
    'charset':  'utf8mb4',
    'use_unicode': True
}

TABLES = {}

# ─── 1. system_settings ───────────────────────────────────────────────────────
TABLES['system_settings'] = """
CREATE TABLE IF NOT EXISTS system_settings (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    site_name   VARCHAR(255)    NOT NULL DEFAULT 'ระบบบริหารคลังพัสดุ',
    site_logo   VARCHAR(500)    NOT NULL DEFAULT '',
    system_info TEXT,
    version     VARCHAR(50)     NOT NULL DEFAULT '1.0.0',
    updated_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

# ─── 2. departments ───────────────────────────────────────────────────────────
TABLES['departments'] = """
CREATE TABLE IF NOT EXISTS departments (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(255) NOT NULL,
    code       VARCHAR(50)  NOT NULL,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dept_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

# ─── 3. users ─────────────────────────────────────────────────────────────────
TABLES['users'] = """
CREATE TABLE IF NOT EXISTS users (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    employee_id   VARCHAR(50)  NOT NULL,
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    username      VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    department_id INT          DEFAULT NULL,
    role          ENUM('admin','supervisor','user') NOT NULL DEFAULT 'user',
    status        ENUM('active','inactive')         NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_employee_id (employee_id),
    UNIQUE KEY uq_email      (email),
    UNIQUE KEY uq_username   (username),
    CONSTRAINT fk_users_dept FOREIGN KEY (department_id)
        REFERENCES departments (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

# ─── 4. items (พัสดุ) ─────────────────────────────────────────────────────────
TABLES['items'] = """
CREATE TABLE IF NOT EXISTS items (
    id                 INT PRIMARY KEY AUTO_INCREMENT,
    item_code          VARCHAR(100) NOT NULL,
    item_name          VARCHAR(255) NOT NULL,
    unit               VARCHAR(50)  NOT NULL,
    total_quantity     INT          NOT NULL DEFAULT 0,
    remaining_quantity INT          NOT NULL DEFAULT 0,
    category           VARCHAR(100) NOT NULL DEFAULT '',
    description        TEXT,
    status             ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_item_code (item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

# ─── 5. stock_transactions ────────────────────────────────────────────────────
TABLES['stock_transactions'] = """
CREATE TABLE IF NOT EXISTS stock_transactions (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    item_id          INT          NOT NULL,
    transaction_type ENUM('in','out','adjust') NOT NULL,
    quantity         INT          NOT NULL,
    reference_no     VARCHAR(100) NOT NULL DEFAULT '',
    note             TEXT,
    created_by       INT          NOT NULL,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_strans_item FOREIGN KEY (item_id)
        REFERENCES items (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_strans_user FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

# ─── 6. requisitions ──────────────────────────────────────────────────────────
TABLES['requisitions'] = """
CREATE TABLE IF NOT EXISTS requisitions (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    requisition_no  VARCHAR(100) NOT NULL,
    requester_id    INT          NOT NULL,
    necessity       TEXT         NOT NULL,
    note            TEXT,
    status          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    approved_by     INT          DEFAULT NULL,
    approved_at     TIMESTAMP    NULL DEFAULT NULL,
    reject_reason   TEXT,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_req_no (requisition_no),
    CONSTRAINT fk_req_requester FOREIGN KEY (requester_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_req_approver  FOREIGN KEY (approved_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

# ─── 7. requisition_items ────────────────────────────────────────────────────
TABLES['requisition_items'] = """
CREATE TABLE IF NOT EXISTS requisition_items (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    requisition_id      INT NOT NULL,
    item_id             INT NOT NULL,
    quantity_requested  INT NOT NULL DEFAULT 1,
    quantity_approved   INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_ri_req  FOREIGN KEY (requisition_id)
        REFERENCES requisitions (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ri_item FOREIGN KEY (item_id)
        REFERENCES items (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

# ─── Seed data ────────────────────────────────────────────────────────────────
SEED_SETTINGS = """
INSERT IGNORE INTO system_settings (id, site_name, system_info, version)
VALUES (1, 'ระบบบริหารคลังพัสดุ', 'ระบบจัดการสต็อกสินค้าองค์กร', '1.0.0');
"""

SEED_DEPARTMENTS = [
    ('ฝ่ายไอที',       'IT'),
    ('ฝ่ายบัญชี',     'ACC'),
    ('ฝ่ายจัดซื้อ',   'PUR'),
    ('ฝ่ายคลังสินค้า','WH'),
    ('ฝ่ายบริหาร',    'MNG'),
    ('ฝ่ายบุคคล',     'HR'),
    ('ฝ่ายการตลาด',   'MKT'),
]

SEED_ITEMS = [
    ('ITM001', 'กระดาษ A4',              'รีม',   100, 85,  'เครื่องเขียน'),
    ('ITM002', 'ปากกาลูกลื่น',           'ด้าม',  200, 150, 'เครื่องเขียน'),
    ('ITM003', 'แฟ้มเอกสาร',             'อัน',   50,  30,  'เครื่องเขียน'),
    ('ITM004', 'หมึกปริ้นเตอร์ Brother', 'ตลับ',  20,  12,  'อุปกรณ์คอมพิวเตอร์'),
    ('ITM005', 'สายไฟ USB-C',            'เส้น',  30,  25,  'อุปกรณ์คอมพิวเตอร์'),
    ('ITM006', 'กาวแท่ง',               'แท่ง',  80,  60,  'เครื่องเขียน'),
    ('ITM007', 'ลวดเย็บกระดาษ',          'กล่อง', 40,  35,  'เครื่องเขียน'),
    ('ITM008', 'คัตเตอร์',              'อัน',   15,  10,  'อุปกรณ์'),
    ('ITM009', 'กระดาษ A3',              'รีม',   30,  20,  'เครื่องเขียน'),
    ('ITM010', 'ปากกาไวท์บอร์ด',         'ด้าม',  60,  45,  'เครื่องเขียน'),
]

def run():
    print("=" * 56)
    print("  Stock App — Database Initializer")
    print(f"  Host    : {DB_CONFIG['host']}")
    print(f"  Database: {DB_CONFIG['database']}")
    print("=" * 56)

    conn = mysql.connector.connect(**DB_CONFIG)
    cur  = conn.cursor()

    # ── Create tables in dependency order ─────────────────────
    order = [
        'system_settings',
        'departments',
        'users',
        'items',
        'stock_transactions',
        'requisitions',
        'requisition_items',
    ]

    for tname in order:
        print(f"  [TABLE]  {tname:<25}", end=" ")
        cur.execute(TABLES[tname])
        conn.commit()
        print("✓ OK")

    # ── Seed: system_settings ─────────────────────────────────
    print("\n  [SEED]   system_settings         ", end=" ")
    cur.execute(SEED_SETTINGS)
    conn.commit()
    print("✓ OK")

    # ── Seed: departments ─────────────────────────────────────
    print("  [SEED]   departments              ", end=" ")
    for name, code in SEED_DEPARTMENTS:
        cur.execute(
            "INSERT IGNORE INTO departments (name, code) VALUES (%s, %s)",
            (name, code)
        )
    conn.commit()
    print("✓ OK")

    # ── Seed: items ───────────────────────────────────────────
    print("  [SEED]   items                    ", end=" ")
    for row in SEED_ITEMS:
        cur.execute(
            """INSERT IGNORE INTO items
               (item_code, item_name, unit, total_quantity, remaining_quantity, category)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            row
        )
    conn.commit()
    print("✓ OK")

    # ── Seed: admin user ──────────────────────────────────────
    print("  [SEED]   admin user               ", end=" ")
    cur.execute("SELECT id FROM departments WHERE code='IT'")
    dept = cur.fetchone()
    dept_id = dept[0] if dept else None

    pw_hash = bcrypt.hashpw(b'admin1234', bcrypt.gensalt()).decode()
    cur.execute(
        """INSERT IGNORE INTO users
           (employee_id, first_name, last_name, email,
            username, password_hash, department_id, role)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        ('EMP001', 'ผู้ดูแล', 'ระบบ', 'admin@company.com',
         'admin', pw_hash, dept_id, 'admin')
    )
    conn.commit()
    print("✓ OK")

    cur.close()
    conn.close()

    print("\n" + "=" * 56)
    print("  ✅  สร้าง Tables & Seed Data สำเร็จทั้งหมด!")
    print("  👤  Login: admin / admin1234")
    print("=" * 56)

    # ── Summary ───────────────────────────────────────────────
    conn2 = mysql.connector.connect(**DB_CONFIG)
    c2    = conn2.cursor()
    print("\n  📋  สรุป Tables ในฐานข้อมูล:")
    c2.execute("SHOW TABLES")
    tables = c2.fetchall()
    for (t,) in tables:
        c2.execute(f"SELECT COUNT(*) FROM `{t}`")
        (cnt,) = c2.fetchone()
        print(f"     {t:<30} {cnt:>6} rows")
    c2.close()
    conn2.close()
    print()

if __name__ == '__main__':
    try:
        run()
    except mysql.connector.Error as e:
        print(f"\n  ❌  MySQL Error: {e}")
        raise
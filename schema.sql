-- ============================================================
--  Stock Management System — Database Schema
--  Database : stoc_app  |  Host: 192.168.101.41
-- ============================================================

USE stoc_app;

-- ─── 1. system_settings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    site_name   VARCHAR(255) NOT NULL DEFAULT 'ระบบบริหารคลังพัสดุ',
    site_logo   VARCHAR(500) NOT NULL DEFAULT '',
    system_info TEXT,
    version     VARCHAR(50)  NOT NULL DEFAULT '1.0.0',
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO system_settings (id, site_name, system_info, version)
VALUES (1, 'ระบบบริหารคลังพัสดุ', 'ระบบจัดการสต็อกสินค้าองค์กร', '1.0.0');

-- ─── 2. departments ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50)  NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dept_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO departments (name, code) VALUES
('ฝ่ายไอที','IT'),('ฝ่ายบัญชี','ACC'),('ฝ่ายจัดซื้อ','PUR'),
('ฝ่ายคลังสินค้า','WH'),('ฝ่ายบริหาร','MNG'),('ฝ่ายบุคคล','HR'),('ฝ่ายการตลาด','MKT');

-- ─── 3. users ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id   VARCHAR(50)  NOT NULL,
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    username      VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    department_id INT DEFAULT NULL,
    role   ENUM('admin','supervisor','user') NOT NULL DEFAULT 'user',
    status ENUM('active','inactive')         NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_employee_id (employee_id),
    UNIQUE KEY uq_email       (email),
    UNIQUE KEY uq_username    (username),
    CONSTRAINT fk_users_dept FOREIGN KEY (department_id)
        REFERENCES departments(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4. items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS items (
    id                 INT PRIMARY KEY AUTO_INCREMENT,
    item_code          VARCHAR(100) NOT NULL,
    item_name          VARCHAR(255) NOT NULL,
    unit               VARCHAR(50)  NOT NULL,
    total_quantity     INT NOT NULL DEFAULT 0,
    remaining_quantity INT NOT NULL DEFAULT 0,
    category           VARCHAR(100) NOT NULL DEFAULT '',
    description        TEXT,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_item_code (item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO items (item_code,item_name,unit,total_quantity,remaining_quantity,category) VALUES
('ITM001','กระดาษ A4','รีม',100,85,'เครื่องเขียน'),
('ITM002','ปากกาลูกลื่น','ด้าม',200,150,'เครื่องเขียน'),
('ITM003','แฟ้มเอกสาร','อัน',50,30,'เครื่องเขียน'),
('ITM004','หมึกปริ้นเตอร์ Brother','ตลับ',20,12,'อุปกรณ์คอมพิวเตอร์'),
('ITM005','สายไฟ USB-C','เส้น',30,25,'อุปกรณ์คอมพิวเตอร์'),
('ITM006','กาวแท่ง','แท่ง',80,60,'เครื่องเขียน'),
('ITM007','ลวดเย็บกระดาษ','กล่อง',40,35,'เครื่องเขียน'),
('ITM008','คัตเตอร์','อัน',15,10,'อุปกรณ์'),
('ITM009','กระดาษ A3','รีม',30,20,'เครื่องเขียน'),
('ITM010','ปากกาไวท์บอร์ด','ด้าม',60,45,'เครื่องเขียน');

-- ─── 5. stock_transactions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_transactions (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    item_id          INT NOT NULL,
    transaction_type ENUM('in','out','adjust') NOT NULL,
    quantity         INT NOT NULL,
    reference_no     VARCHAR(100) NOT NULL DEFAULT '',
    note             TEXT,
    created_by       INT NOT NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_strans_item FOREIGN KEY (item_id)
        REFERENCES items(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_strans_user FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 6. requisitions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS requisitions (
    id             INT PRIMARY KEY AUTO_INCREMENT,
    requisition_no VARCHAR(100) NOT NULL,
    requester_id   INT NOT NULL,
    necessity      TEXT NOT NULL,
    note           TEXT,
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    approved_by  INT       DEFAULT NULL,
    approved_at  TIMESTAMP NULL DEFAULT NULL,
    reject_reason TEXT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_req_no (requisition_no),
    CONSTRAINT fk_req_requester FOREIGN KEY (requester_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_req_approver  FOREIGN KEY (approved_by)
        REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 7. requisition_items ───────────────────────────────────
CREATE TABLE IF NOT EXISTS requisition_items (
    id                 INT PRIMARY KEY AUTO_INCREMENT,
    requisition_id     INT NOT NULL,
    item_id            INT NOT NULL,
    quantity_requested INT NOT NULL DEFAULT 1,
    quantity_approved  INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_ri_req  FOREIGN KEY (requisition_id)
        REFERENCES requisitions(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ri_item FOREIGN KEY (item_id)
        REFERENCES items(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NOTE: รัน  python3 init_db.py  เพื่อสร้าง admin user (ต้องการ bcrypt)
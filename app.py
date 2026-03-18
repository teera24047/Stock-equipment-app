"""
Stock Management System - Flask Backend
Designed for Synology NAS deployment
"""

from flask import Flask, request, jsonify, session, send_file, send_from_directory
from flask_cors import CORS
import mysql.connector
import bcrypt
import jwt
import json
import csv
import io
import os
from datetime import datetime, timedelta , timezone
from functools import wraps
import re

# กำหนด Timezone ประเทศไทย (UTC+7)
BKK_TZ = timezone(timedelta(hours=7))
os.environ['TZ'] = 'Asia/Bangkok'
os.environ.setdefault('FLASK_ENV', 'development')
app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.secret_key = os.environ.get('SECRET_KEY', 'stock_secret_key_change_in_production')
CORS(app, supports_credentials=True, origins=["*"])

from flask.json.provider import DefaultJSONProvider

class CustomJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, datetime):
            # บังคับส่งเป็น String รูปแบบ ISO ไม่มี Timezone มากวนใจ
            return obj.strftime('%Y-%m-%dT%H:%M:%S')
        return super().default(obj)

app.json = CustomJSONProvider(app)

JWT_SECRET = os.environ.get('JWT_SECRET', 'jwt_secret_change_in_production')
JWT_EXPIRY_HOURS = 8
# ─── DB Config ───────────────────────────────────────────────────────────────
DB_CONFIG = {
    'host':     '192.168.101.41',
    'port':     3306,
    'user':     'stocapp',
    'password': 'Boss@194219',
    'database': 'stoc_app',
    'charset':  'utf8mb4',
    'use_unicode': True
}


def get_db():
    conn = mysql.connector.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute("SET time_zone = '+07:00'")
    cur.close()
    return conn
    #return mysql.connector.connect(**DB_CONFIG)

def query(sql, params=(), fetchone=False, commit=False):
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute(sql, params)
        if commit:
            conn.commit()
            return cur.lastrowid if cur.lastrowid else cur.rowcount
        if fetchone:
            return cur.fetchone()
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()

# ─── Auth Helpers ─────────────────────────────────────────────────────────────
def make_token(user):
    payload = {
        'id': user['id'],
        'username': user['username'],
        'role': user['role'],
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

def decode_token(token):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except:
        return None

def auth_required(roles=None):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # 1. พยายามอ่าน Token จาก Header ก่อน (สำหรับการใช้งาน API ปกติ)
            token = request.headers.get('Authorization', '').replace('Bearer ', '')
            
            # 2. ถ้าใน Header ไม่มี ให้พยายามอ่านจาก URL Query (สำหรับการกดปุ่มดาวน์โหลด Export)
            if not token:
                token = request.args.get('token', '')
                
            user = decode_token(token)
            if not user:
                return jsonify({'error': 'Unauthorized'}), 401
            if roles and user['role'] not in roles:
                return jsonify({'error': 'Forbidden'}), 403
            request.user = user
            return f(*args, **kwargs)
        return wrapper
    return decorator

# ─── Auth Routes ──────────────────────────────────────────────────────────────
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = query("SELECT * FROM users WHERE username=%s AND status='active'",
                 (data.get('username'),), fetchone=True)
    if not user:
        return jsonify({'error': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'}), 401
    if not bcrypt.checkpw(data.get('password','').encode(), user['password_hash'].encode()):
        return jsonify({'error': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'}), 401
    token = make_token(user)
    dept = query("SELECT name FROM departments WHERE id=%s", (user['department_id'],), fetchone=True)
    return jsonify({
        'token': token,
        'user': {
            'id': user['id'],
            'name': f"{user['first_name']} {user['last_name']}",
            'username': user['username'],
            'role': user['role'],
            'employee_id': user['employee_id'],
            'department': dept['name'] if dept else '',
            'email': user['email']
        }
    })

@app.route('/api/me', methods=['GET'])
@auth_required()
def me():
    user = query("SELECT u.*, d.name as dept_name FROM users u LEFT JOIN departments d ON u.department_id=d.id WHERE u.id=%s",
                 (request.user['id'],), fetchone=True)
    if user:
        user.pop('password_hash', None)
    return jsonify(user)

# ─── Users ────────────────────────────────────────────────────────────────────
@app.route('/api/users', methods=['GET'])
@auth_required(['admin', 'supervisor'])
def get_users():
    users = query("""SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.username,
                     u.role, u.status, u.created_at, d.name as department
                     FROM users u LEFT JOIN departments d ON u.department_id=d.id
                     ORDER BY u.created_at DESC""")
    return jsonify(users)

@app.route('/api/users', methods=['POST'])
@auth_required(['admin', 'supervisor'])
def create_user():
    d = request.json
    hashed = bcrypt.hashpw(d['password'].encode(), bcrypt.gensalt()).decode()
    try:
        uid = query("""INSERT INTO users (employee_id, first_name, last_name, email, username, password_hash, department_id, role)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (d['employee_id'], d['first_name'], d['last_name'], d['email'],
                     d['username'], hashed, d['department_id'], d['role']), commit=True)
        return jsonify({'id': uid, 'message': 'สร้างผู้ใช้สำเร็จ'})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/users/<int:uid>', methods=['PUT'])
@auth_required(['admin', 'supervisor'])
def update_user(uid):
    d = request.json
    fields, vals = [], []
    for f in ['first_name','last_name','email','department_id','role','status']:
        if f in d:
            fields.append(f"{f}=%s"); vals.append(d[f])
    if 'password' in d and d['password']:
        fields.append("password_hash=%s")
        vals.append(bcrypt.hashpw(d['password'].encode(), bcrypt.gensalt()).decode())
    if not fields:
        return jsonify({'error': 'No fields to update'}), 400
    vals.append(uid)
    query(f"UPDATE users SET {','.join(fields)} WHERE id=%s", vals, commit=True)
    return jsonify({'message': 'อัปเดตสำเร็จ'})

@app.route('/api/users/<int:uid>', methods=['DELETE'])
@auth_required(['admin'])
def delete_user(uid):
    query("UPDATE users SET status='inactive' WHERE id=%s", (uid,), commit=True)
    return jsonify({'message': 'ปิดการใช้งานสำเร็จ'})

# ─── Departments ──────────────────────────────────────────────────────────────
@app.route('/api/departments', methods=['GET'])
@auth_required()
def get_departments():
    return jsonify(query("SELECT * FROM departments ORDER BY name"))

# ─── Items ────────────────────────────────────────────────────────────────────
@app.route('/api/items', methods=['GET'])
@auth_required()
def get_items():
    items = query("SELECT * FROM items WHERE status='active' ORDER BY item_code")
    return jsonify(items)

@app.route('/api/items', methods=['POST'])
@auth_required(['admin', 'supervisor'])
def create_item():
    d = request.json
    try:
        iid = query("""INSERT INTO items (item_code, item_name, unit, total_quantity, remaining_quantity, category, description)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                    (d['item_code'], d['item_name'], d['unit'],
                     d['total_quantity'], d['total_quantity'],
                     d.get('category',''), d.get('description','')), commit=True)
        # Log transaction
        query("INSERT INTO stock_transactions (item_id, transaction_type, quantity, note, created_by) VALUES (%s,'in',%s,'เพิ่มพัสดุใหม่',%s)",
              (iid, d['total_quantity'], request.user['id']), commit=True)
        return jsonify({'id': iid, 'message': 'เพิ่มพัสดุสำเร็จ'})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/items/<int:iid>', methods=['PUT'])
@auth_required(['admin', 'supervisor'])
def update_item(iid):
    d = request.json

    # ดึงข้อมูลเดิม
    current = query("SELECT * FROM items WHERE id=%s", (iid,), fetchone=True)
    if not current:
        return jsonify({'error': 'ไม่พบพัสดุ'}), 404

    fields, vals = [], []

    # ฟิลด์ทั่วไป
    for f in ['item_name', 'unit', 'category', 'description', 'status']:
        if f in d:
            fields.append(f"{f}=%s")
            vals.append(d[f])

    # จัดการ total_quantity
    if 'total_quantity' in d:
        new_total = int(d['total_quantity'])
        old_total  = current['total_quantity']
        old_remain = current['remaining_quantity']

        # ถ้า frontend ส่ง remaining_quantity มาด้วย ใช้ค่านั้นเลย
        if 'remaining_quantity' in d:
            new_remain = min(int(d['remaining_quantity']), new_total)
        else:
            # คำนวณ: คงเหลือใหม่ = ทั้งหมดใหม่ - (ที่เบิกออกไปแล้ว)
            used = old_total - old_remain
            new_remain = max(0, new_total - used)

        fields += ["total_quantity=%s", "remaining_quantity=%s"]
        vals   += [new_total, new_remain]

        # Log transaction ถ้า total เปลี่ยน
        if new_total != old_total:
            diff    = new_total - old_total
            tx_type = 'in' if diff > 0 else 'adjust'
            query(
                "INSERT INTO stock_transactions (item_id, transaction_type, quantity, reference_no, note, created_by) VALUES (%s,%s,%s,%s,%s,%s)",
                (iid, tx_type, abs(diff), 'ADJUST', f'ปรับปรุงสต็อกจาก {old_total} เป็น {new_total}', request.user['id']),
                commit=True
            )

    elif 'remaining_quantity' in d:
        # แก้เฉพาะคงเหลือโดยตรง (ไม่เปลี่ยน total)
        new_remain = min(int(d['remaining_quantity']), current['total_quantity'])
        fields.append("remaining_quantity=%s")
        vals.append(new_remain)

    if not fields:
        return jsonify({'error': 'No fields to update'}), 400

    vals.append(iid)
    query(f"UPDATE items SET {','.join(fields)} WHERE id=%s", vals, commit=True)
    return jsonify({'message': 'อัปเดตสำเร็จ'})

@app.route('/api/items/<int:iid>', methods=['DELETE'])
@auth_required(['admin', 'supervisor'])
def delete_item(iid):
    query("UPDATE items SET status='inactive' WHERE id=%s", (iid,), commit=True)
    return jsonify({'message': 'ลบสำเร็จ'})

# ─── Import CSV/TSV ──────────────────────────────────────────────────────────
@app.route('/api/items/import', methods=['POST'])
@auth_required(['admin', 'supervisor'])
def import_items():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    f = request.files['file']

    # ── ลอง decode หลาย encoding (UTF-8, TIS-620, UTF-16)
    raw = f.read()
    for enc in ('utf-8-sig', 'utf-8', 'tis-620', 'cp874', 'utf-16'):
        try:
            content = raw.decode(enc)
            break
        except Exception:
            content = None
    if not content:
        return jsonify({'error': 'ไม่สามารถอ่านไฟล์ได้ — ลอง save เป็น UTF-8'}), 400

    # ── Auto-detect delimiter: tab หรือ comma
    first_line = content.replace('\r\n', '\n').split('\n')[0]
    delimiter = '\t' if '\t' in first_line else ','

    # ── Normalize header: ตัด whitespace + แปลง header ภาษาไทย → ภาษาอังกฤษ
    TH_MAP = {
        'รหัส': 'item_code', 'รหัสพัสดุ': 'item_code', 'รหัสสินค้า': 'item_code',
        'ชื่อพัสดุ': 'item_name', 'ชื่อสินค้า': 'item_name', 'ชื่อ': 'item_name',
        'หน่วย': 'unit', 'หน่วยนับ': 'unit',
        'จำนวน': 'total_quantity', 'จำนวนทั้งหมด': 'total_quantity',
        'หมวดหมู่': 'category', 'ประเภท': 'category',
    }

    lines = content.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    # แปลง header line
    header_raw = lines[0].split(delimiter)
    header = []
    for h in header_raw:
        h = h.strip().strip('"').strip("'")
        header.append(TH_MAP.get(h, h))  # map ภาษาไทย หรือใช้ชื่อเดิม

    # ── อ่านแถวข้อมูล
    success, errors, skipped = 0, [], 0
    for i, line in enumerate(lines[1:], 1):
        line = line.strip()
        if not line:
            continue
        cols = line.split(delimiter)
        row = {}
        for j, h in enumerate(header):
            row[h] = cols[j].strip().strip('"').strip("'") if j < len(cols) else ''

        try:
            item_code = row.get('item_code', '').strip()
            item_name = row.get('item_name', '').strip()
            unit      = row.get('unit', '').strip()

            if not item_code:
                skipped += 1
                continue
            if not item_name:
                errors.append(f"แถว {i} ({item_code}): ไม่มีชื่อสินค้า")
                continue
            if not unit:
                unit = 'อัน'  # default

            qty_raw = row.get('total_quantity', '0').strip() or '0'
            qty = int(''.join(filter(str.isdigit, qty_raw)) or 0)

            query("""INSERT INTO items
                     (item_code, item_name, unit, total_quantity, remaining_quantity, category)
                     VALUES (%s,%s,%s,%s,%s,%s)
                     ON DUPLICATE KEY UPDATE
                       item_name=VALUES(item_name),
                       unit=VALUES(unit),
                       total_quantity=VALUES(total_quantity),
                       remaining_quantity=VALUES(remaining_quantity),
                       category=VALUES(category)""",
                  (item_code, item_name, unit, qty, qty,
                   row.get('category', '').strip()), commit=True)
            success += 1
        except Exception as e:
            errors.append(f"แถว {i}: {str(e)}")

    return jsonify({
        'success': success,
        'skipped': skipped,
        'errors': errors,
        'delimiter_used': 'tab' if delimiter == '\t' else 'comma'
    })

# ─── Export CSV ───────────────────────────────────────────────────────────────
@app.route('/api/items/export', methods=['GET'])
@auth_required(['admin', 'supervisor'])
def export_items():
    items = query("SELECT item_code, item_name, unit, total_quantity, remaining_quantity, category, description FROM items WHERE status='active'")
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=['item_code','item_name','unit','total_quantity','remaining_quantity','category','description'])
    writer.writeheader()
    writer.writerows(items)
    output.seek(0)
    return send_file(
        io.BytesIO(('\ufeff' + output.getvalue()).encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f"stock_export_{datetime.now(BKK_TZ).strftime('%Y%m%d_%H%M%S')}.csv"
    )

# ─── Requisition No Generator ────────────────────────────────────────────────
def gen_req_no():
    """สร้างเลขที่คำขอเบิกในรูปแบบ REQ-YYYYMMDD-XXXX"""
    today = datetime.now(BKK_TZ).strftime('%Y%m%d')
    prefix = f"REQ-{today}-"
    row = query(
        "SELECT requisition_no FROM requisitions WHERE requisition_no LIKE %s ORDER BY id DESC LIMIT 1",
        (prefix + '%',), fetchone=True
    )
    if row:
        try:
            last_num = int(row['requisition_no'].rsplit('-', 1)[-1])
            return f"{prefix}{last_num + 1:04d}"
        except Exception:
            pass
    return f"{prefix}0001"

# ─── Requisitions ─────────────────────────────────────────────────────────────
@app.route('/api/requisitions', methods=['GET'])
@auth_required()
def get_requisitions():
    if request.user['role'] in ('admin', 'supervisor'):
        rows = query("""SELECT r.*, CONCAT(u.first_name,' ',u.last_name) as requester_name,
                        u.employee_id, d.name as department,
                        CONCAT(a.first_name,' ',a.last_name) as approver_name
                        FROM requisitions r
                        JOIN users u ON r.requester_id=u.id
                        LEFT JOIN departments d ON u.department_id=d.id
                        LEFT JOIN users a ON r.approved_by=a.id
                        ORDER BY r.created_at DESC""")
    else:
        rows = query("""SELECT r.*, CONCAT(u.first_name,' ',u.last_name) as requester_name,
                        CONCAT(a.first_name,' ',a.last_name) as approver_name
                        FROM requisitions r
                        JOIN users u ON r.requester_id=u.id
                        LEFT JOIN users a ON r.approved_by=a.id
                        WHERE r.requester_id=%s ORDER BY r.created_at DESC""",
                     (request.user['id'],))
    # Attach items
    for r in rows:
        r['items'] = query("""SELECT ri.*, i.item_name, i.unit, i.item_code
                               FROM requisition_items ri JOIN items i ON ri.item_id=i.id
                               WHERE ri.requisition_id=%s""", (r['id'],))
    return jsonify(rows)

@app.route('/api/requisitions', methods=['POST'])
@auth_required()
def create_requisition():
    d = request.json
    if not d:
        return jsonify({'error': 'ไม่มีข้อมูล'}), 400
    necessity = (d.get('necessity') or '').strip()
    if not necessity:
        return jsonify({'error': 'กรุณาระบุความจำเป็นในการเบิก'}), 400
    items_data = d.get('items', [])
    if not items_data:
        return jsonify({'error': 'กรุณาเลือกพัสดุอย่างน้อย 1 รายการ'}), 400

    try:
        req_no = gen_req_no()
        rid = query(
            "INSERT INTO requisitions (requisition_no, requester_id, necessity, note) VALUES (%s,%s,%s,%s)",
            (req_no, request.user['id'], necessity, d.get('note', '') or ''),
            commit=True
        )
        if not rid:
            return jsonify({'error': 'ไม่สามารถสร้างคำขอได้'}), 500

        for item in items_data:
            item_id  = item.get('item_id')
            quantity = int(item.get('quantity', 1))
            if not item_id or quantity < 1:
                continue
            query(
                "INSERT INTO requisition_items (requisition_id, item_id, quantity_requested) VALUES (%s,%s,%s)",
                (rid, item_id, quantity),
                commit=True
            )

        return jsonify({'id': rid, 'requisition_no': req_no, 'message': 'ส่งคำขอเบิกสำเร็จ'})
    except Exception as e:
        return jsonify({'error': f'เกิดข้อผิดพลาด: {str(e)}'}), 500

@app.route('/api/requisitions/<int:rid>/approve', methods=['POST'])
@auth_required(['admin', 'supervisor'])
def approve_requisition(rid):
    d = request.json
    action = d.get('action')  # 'approve' or 'reject'
    if action == 'approve':
        # Update stock for each item
        items = query("SELECT * FROM requisition_items WHERE requisition_id=%s", (rid,))
        for item in items:
            qty_approved = item.get('quantity_approved') or item['quantity_requested']
            # Update remaining quantity
            query("UPDATE items SET remaining_quantity = remaining_quantity - %s WHERE id=%s AND remaining_quantity >= %s",
                  (qty_approved, item['item_id'], qty_approved), commit=True)
            query("INSERT INTO stock_transactions (item_id, transaction_type, quantity, reference_no, note, created_by) VALUES (%s,'out',%s,%s,'อนุมัติเบิกพัสดุ',%s)",
                  (item['item_id'], qty_approved, f"REQ{rid}", request.user['id']), commit=True)
            query("UPDATE requisition_items SET quantity_approved=%s WHERE id=%s",
                  (qty_approved, item['id']), commit=True)
        query("UPDATE requisitions SET status='approved', approved_by=%s, approved_at=NOW() WHERE id=%s",
              (request.user['id'], rid), commit=True)
        return jsonify({'message': 'อนุมัติสำเร็จ'})
    elif action == 'reject':
        query("UPDATE requisitions SET status='rejected', approved_by=%s, approved_at=NOW(), reject_reason=%s WHERE id=%s",
              (request.user['id'], d.get('reason',''), rid), commit=True)
        return jsonify({'message': 'ปฏิเสธคำขอแล้ว'})
    return jsonify({'error': 'Invalid action'}), 400

# ─── Dashboard Stats ──────────────────────────────────────────────────────────
@app.route('/api/stats', methods=['GET'])
@auth_required()
def get_stats():
    if request.user['role'] in ('admin', 'supervisor'):
        total_items = query("SELECT COUNT(*) as c FROM items WHERE status='active'", fetchone=True)['c']
        low_stock = query("SELECT COUNT(*) as c FROM items WHERE status='active' AND remaining_quantity <= total_quantity*0.2", fetchone=True)['c']
        pending = query("SELECT COUNT(*) as c FROM requisitions WHERE status='pending'", fetchone=True)['c']
        approved_today = query("SELECT COUNT(*) as c FROM requisitions WHERE status='approved' AND DATE(approved_at)=CURDATE()", fetchone=True)['c']
        recent_req = query("""SELECT r.requisition_no, CONCAT(u.first_name,' ',u.last_name) as name,
                               r.status, r.created_at FROM requisitions r
                               JOIN users u ON r.requester_id=u.id ORDER BY r.created_at DESC LIMIT 5""")
        return jsonify({'total_items': total_items, 'low_stock': low_stock,
                        'pending': pending, 'approved_today': approved_today, 'recent_req': recent_req})
    else:
        uid = request.user['id']
        total = query("SELECT COUNT(*) as c FROM requisitions WHERE requester_id=%s", (uid,), fetchone=True)['c']
        pending = query("SELECT COUNT(*) as c FROM requisitions WHERE requester_id=%s AND status='pending'", (uid,), fetchone=True)['c']
        approved = query("SELECT COUNT(*) as c FROM requisitions WHERE requester_id=%s AND status='approved'", (uid,), fetchone=True)['c']
        rejected = query("SELECT COUNT(*) as c FROM requisitions WHERE requester_id=%s AND status='rejected'", (uid,), fetchone=True)['c']
        return jsonify({'total': total, 'pending': pending, 'approved': approved, 'rejected': rejected})

# ─── System Settings ──────────────────────────────────────────────────────────
@app.route('/api/settings', methods=['GET'])
@auth_required()
def get_settings():
    return jsonify(query("SELECT * FROM system_settings LIMIT 1", fetchone=True))

@app.route('/api/settings', methods=['PUT'])
@auth_required(['admin'])
def update_settings():
    d = request.json
    query("UPDATE system_settings SET site_name=%s, site_logo=%s, system_info=%s, version=%s WHERE id=1",
          (d.get('site_name'), d.get('site_logo',''), d.get('system_info',''), d.get('version','')), commit=True)
    return jsonify({'message': 'บันทึกการตั้งค่าสำเร็จ'})

# ─── Health Check ─────────────────────────────────────────────────────────────
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'time': datetime.now().isoformat()})

# ─── Serve Frontend ──────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8504, debug=False)
/* ============================================
   Stock Management System - Main JS
   ============================================ */

const API = '/api';  // Flask serves both frontend and API on port 5000
let currentUser = null;
let authToken = localStorage.getItem('stock_token') || '';
let pendingCount = 0;
let confirmCallback = null;

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
async function api(method, endpoint, body = null, isForm = false) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${authToken}` }
  };
  if (!isForm) opts.headers['Content-Type'] = 'application/json';
  if (body) opts.body = isForm ? body : JSON.stringify(body);
  const res = await fetch(API + endpoint, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success:'fa-check-circle', error:'fa-times-circle', info:'fa-info-circle', warn:'fa-exclamation-triangle' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fas ${icons[type]}"></i> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Loading ──────────────────────────────────────────────────────────────────
function setLoading(show) { document.getElementById('loadingOverlay').classList.toggle('show', show); }

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
function confirm(title, msg, icon, cb, btnText = 'ยืนยัน', btnClass = 'btn-danger') {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-icon').textContent = icon;
  const btn = document.getElementById('confirm-ok');
  btn.textContent = btnText;
  btn.className = `btn ${btnClass}`;
  confirmCallback = cb;
  document.getElementById('confirm-overlay').classList.add('open');
  btn.onclick = () => { closeConfirm(); cb(); };
}
function closeConfirm() { document.getElementById('confirm-overlay').classList.remove('open'); }

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(title, bodyHTML, footerHTML, large = false) {
  const overlay = document.getElementById('modal-overlay');
  const box = document.getElementById('modal-box');
  document.querySelector('#modal-title span').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-footer').innerHTML = footerHTML;
  box.classList.toggle('modal-lg', large);
  overlay.classList.add('open');
}
function closeModal(e) { if (e.target === document.getElementById('modal-overlay')) closeModalDirect(); }
function closeModalDirect() { document.getElementById('modal-overlay').classList.remove('open'); }

// ─── Date ─────────────────────────────────────────────────────────────────────
function updateDate() {
  const now = new Date();
  const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' };
  document.getElementById('topbar-date').textContent = now.toLocaleDateString('th-TH', opts);
}
setInterval(updateDate, 60000); updateDate();

// ─── Role Helpers ─────────────────────────────────────────────────────────────
function isAdmin() { return currentUser?.role === 'admin'; }
function isSupervisor() { return currentUser?.role === 'supervisor'; }
function isPrivileged() { return isAdmin() || isSupervisor(); }
function roleName(r) { return { admin:'ผู้ดูแลระบบ', supervisor:'หัวหน้างาน', user:'ผู้ใช้ทั่วไป' }[r] || r; }
function roleClass(r) { return { admin:'badge-admin', supervisor:'badge-supervisor', user:'badge-user' }[r] || ''; }

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const btn = document.getElementById('btn-login-submit');
  const errDiv = document.getElementById('login-error');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if (!username || !password) { showLoginError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'); return; }
  btn.classList.add('loading');
  try {
    const data = await api('POST', '/login', { username, password });
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('stock_token', authToken);
    await initApp();
  } catch (e) { showLoginError(e.message); }
  finally { btn.classList.remove('loading'); }
}
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  document.getElementById('login-error-msg').textContent = msg;
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.gap = '8px';
}
function doLogout() {
  authToken = ''; currentUser = null;
  localStorage.removeItem('stock_token');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
}
document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// ─── Init App ─────────────────────────────────────────────────────────────────
async function initApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Load settings
  try {
    const s = await api('GET', '/settings');
    document.getElementById('sidebar-site-name').textContent = s.site_name || 'คลังพัสดุ';
    document.getElementById('sidebar-version').textContent = `v${s.version || '1.0.0'}`;
    document.getElementById('login-site-name').textContent = s.site_name || 'ระบบบริหารคลังพัสดุ';
    if (s.site_logo) document.querySelector('.sidebar-logo-icon').innerHTML = `<img src="${s.site_logo}" style="width:28px;height:28px;object-fit:contain;">`;
  } catch {}

  // Set user info
  const name = currentUser.name;
  document.getElementById('sidebar-user-name').textContent = name;
  document.getElementById('sidebar-user-role').textContent = roleName(currentUser.role);
  document.getElementById('user-avatar-text').textContent = name.charAt(0);

  buildNav();
  renderNav();
  navigateTo(isPrivileged() ? 'dashboard-admin' : 'dashboard-user');

  // ── Real-time polling ──────────────────────────────
  if (isPrivileged()) {
    await refreshPendingBadge();
    setInterval(refreshPendingBadge, 15000);         // badge ทุก 15s
    setInterval(realtimeRefreshAdmin, 10000);         // admin view ทุก 10s
  } else {
    setInterval(realtimeRefreshUser, 8000);           // user view ทุก 8s
  }
}

// ── Real-time: Admin refresh ──────────────────────────────────────────────────
async function realtimeRefreshAdmin() {
  if (currentView === 'requisitions-admin') {
    const prev = allReqAdmin.length;
    await loadReqAdmin(currentReqTab);
    // แจ้งเตือนถ้ามีรายการใหม่
    if (allReqAdmin.length > prev) {
      const newCount = allReqAdmin.length - prev;
      showRealtimeBanner(`มีคำขอเบิกใหม่ ${newCount} รายการ`, 'info');
    }
  }
  if (currentView === 'dashboard-admin') {
    renderDashboardAdmin(document.getElementById('page-content'));
  }
  if (currentView === 'items') {
    await loadItems();
    renderItemsTable(allItems);
  }
}

// ── Real-time: User refresh ──────────────────────────────────────────────────
async function realtimeRefreshUser() {
  if (currentView === 'history' || currentView === 'dashboard-user') {
    const prevHistory = allHistory.map(r => r.status).join(',');
    allHistory = await api('GET', '/requisitions').catch(() => allHistory);
    const newHistory = allHistory.map(r => r.status).join(',');
    if (prevHistory !== newHistory) {
      // status เปลี่ยน = มีการอนุมัติ/ปฏิเสธ
      const justApproved = allHistory.filter(r => r.status === 'approved');
      const justRejected = allHistory.filter(r => r.status === 'rejected');
      if (currentView === 'history') renderHistTable(document.querySelector('.tabs .tab.active')?.textContent?.trim() === 'ทั้งหมด' ? 'all' : 'pending');
      if (currentView === 'dashboard-user') renderDashboardUser(document.getElementById('page-content'));
      showRealtimeBanner('สถานะคำขอเบิกได้รับการอัปเดต', 'success');
    }
  }
}

// ── Real-time Banner (แถบแจ้งเตือนชั่วคราวบน topbar) ──────────────────────────
function showRealtimeBanner(msg, type = 'info') {
  const colors = { info:'#1877F2', success:'#42b72a', warn:'#f7b928', danger:'#e41e3f' };
  const existing = document.getElementById('rt-banner');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'rt-banner';
  el.style.cssText = `
    position:fixed; top:0; left:var(--sidebar-width); right:0; z-index:9998;
    background:${colors[type]}; color:#fff; font-size:.82rem; font-weight:600;
    padding:8px 20px; display:flex; align-items:center; gap:8px;
    animation:slideDown .3s ease;
  `;
  el.innerHTML = `<i class="fas fa-sync-alt fa-spin" style="font-size:.75rem"></i> ${msg}
    <span style="margin-left:auto;cursor:pointer;opacity:.7" onclick="this.parentElement.remove()">✕</span>`;
  document.body.appendChild(el);
  setTimeout(() => el?.remove(), 4000);
}

async function refreshPendingBadge() {
  try {
    const s = await api('GET', '/stats');
    pendingCount = s.pending || 0;
    const badge = document.querySelector('.nav-badge');
    if (badge) { badge.textContent = pendingCount; badge.style.display = pendingCount > 0 ? '' : 'none'; }
  } catch {}
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const NAV_ADMIN = [
  { section: 'ภาพรวม', items: [
    { id: 'dashboard-admin', icon: 'fa-chart-pie', label: 'แดชบอร์ด' },
  ]},
  { section: 'จัดการระบบ', items: [
    { id: 'users', icon: 'fa-users', label: 'จัดการสมาชิก' },
    { id: 'items', icon: 'fa-boxes-stacked', label: 'จัดการพัสดุ' },
    { id: 'stock', icon: 'fa-list-check', label: 'จัดการรายการสต็อก' },
    { id: 'requisitions-admin', icon: 'fa-clipboard-list', label: 'รายการเบิกอุปกรณ์', badge: true },
  ]},
  { section: 'ระบบ', items: [
    { id: 'settings', icon: 'fa-gear', label: 'ตั้งค่าระบบ' },
  ]},
];
const NAV_USER = [
  { section: 'เมนูหลัก', items: [
    { id: 'dashboard-user', icon: 'fa-house', label: 'แดชบอร์ด' },
    { id: 'request', icon: 'fa-hand-holding-box', label: 'ขอเบิกพัสดุ' },
    { id: 'history', icon: 'fa-clock-rotate-left', label: 'ประวัติการเบิก' },
  ]},
];

function buildNav() {
  const nav = isPrivileged() ? NAV_ADMIN : NAV_USER;
  const el = document.getElementById('sidebar-nav');
  el.innerHTML = nav.map(section => `
    <div class="nav-section">
      <div class="nav-section-label">${section.section}</div>
      ${section.items.map(item => `
        <div class="nav-item" id="nav-${item.id}" onclick="navigateTo('${item.id}')">
          <i class="fas ${item.icon}"></i>
          <span>${item.label}</span>
          ${item.badge ? `<span class="nav-badge" style="display:none">0</span>` : ''}
        </div>
      `).join('')}
    </div>
  `).join('');
}

function renderNav() {}

let currentView = '';
function navigateTo(view) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${view}`);
  if (navEl) navEl.classList.add('active');
  currentView = view;
  const titles = {
    'dashboard-admin': 'แดชบอร์ด', 'dashboard-user': 'แดชบอร์ด',
    'users': 'จัดการสมาชิก', 'items': 'จัดการพัสดุ',
    'stock': 'จัดการรายการสต็อก', 'requisitions-admin': 'รายการเบิกอุปกรณ์',
    'request': 'ขอเบิกพัสดุ', 'history': 'ประวัติการเบิก',
    'settings': 'ตั้งค่าระบบ'
  };
  document.getElementById('topbar-title').textContent = titles[view] || view;
  renderView(view);
}

// ─── VIEW ROUTER ──────────────────────────────────────────────────────────────
function renderView(view) {
  const pc = document.getElementById('page-content');
  const views = {
    'dashboard-admin': renderDashboardAdmin,
    'dashboard-user':  renderDashboardUser,
    'users':           renderUsers,
    'items':           renderItems,
    'stock':           renderStock,
    'requisitions-admin': renderRequisitionsAdmin,
    'request':         renderRequest,
    'history':         renderHistory,
    'settings':        renderSettings,
  };
  if (views[view]) views[view](pc);
  else pc.innerHTML = `<div class="card card-body">ไม่พบหน้าที่ต้องการ</div>`;
}

// ══════════════════════════════════════════
// DASHBOARD ADMIN
// ══════════════════════════════════════════
// ประกาศตัวแปรเก็บ instance ของกราฟไว้ด้านนอก เพื่อให้ทำลาย (destroy) ตัวเก่าทิ้งก่อนวาดใหม่ได้
let statusPieChartInstance = null;
let stockBarChartInstance = null;

// ══════════════════════════════════════════
// DASHBOARD ADMIN (Updated with Charts)
// ══════════════════════════════════════════
async function renderDashboardAdmin(pc) {
  pc.innerHTML = `
    <div class="page-header"><h2><i class="fas fa-chart-pie"></i> แดชบอร์ดภาพรวม</h2></div>
    
    <div class="stats-grid" id="admin-stats">
      ${['','','',''].map(() => `<div class="stat-card"><div class="stat-icon blue"><i class="fas fa-spinner fa-spin"></i></div><div class="stat-info"><div class="stat-value">-</div><div class="stat-label">กำลังโหลด...</div></div></div>`).join('')}
    </div>

    <div class="dashboard-charts">
      <div class="chart-card">
        <h3><i class="fas fa-chart-pie"></i> สัดส่วนสถานะการเบิก</h3>
        <div class="chart-container">
          <canvas id="statusPieChart"></canvas>
        </div>
      </div>
      
      <div class="chart-card">
        <h3><i class="fas fa-chart-column"></i> รายการพัสดุใกล้หมด (Top 10)</h3>
        <div class="chart-container">
          <canvas id="stockBarChart"></canvas>
        </div>
      </div>
    </div>

    <div class="card" id="recent-req-card"></div>
  `;

  try {
    // โหลดข้อมูลทั้งหมดที่จำเป็นพร้อมกัน
    const [stats, reqs, items] = await Promise.all([
      api('GET', '/stats'),
      api('GET', '/requisitions'),
      api('GET', '/items')
    ]);

    // ─── อัปเดตการ์ดตัวเลข ───
    document.getElementById('admin-stats').innerHTML = `
      <div class="stat-card blue">
        <div class="stat-icon blue"><i class="fas fa-file-signature"></i></div>
        <div class="stat-info"><div class="stat-value">${reqs.length}</div><div class="stat-label">จำนวนการเบิกทั้งหมด</div></div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-icon yellow"><i class="fas fa-clock"></i></div>
        <div class="stat-info"><div class="stat-value">${stats.pending}</div><div class="stat-label">รอการอนุมัติ</div></div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon green"><i class="fas fa-boxes-stacked"></i></div>
        <div class="stat-info"><div class="stat-value">${stats.total_items}</div><div class="stat-label">รายการพัสดุทั้งหมด</div></div>
      </div>
      <div class="stat-card red">
        <div class="stat-icon red"><i class="fas fa-triangle-exclamation"></i></div>
        <div class="stat-info"><div class="stat-value">${stats.low_stock}</div><div class="stat-label">พัสดุใกล้หมด</div></div>
      </div>
    `;

    // ─── วาดกราฟวงกลม (Pie Chart) สถานะการเบิก ───
    const statusCounts = { pending: 0, approved: 0, rejected: 0 };
    reqs.forEach(r => { if (statusCounts[r.status] !== undefined) statusCounts[r.status]++; });

    const ctxPie = document.getElementById('statusPieChart').getContext('2d');
    if (statusPieChartInstance) statusPieChartInstance.destroy(); // ลบกราฟเก่าก่อน
    statusPieChartInstance = new Chart(ctxPie, {
      type: 'doughnut', // เปลี่ยนเป็น 'pie' ได้ถ้าชอบแบบทึบ
      data: {
        labels: ['รออนุมัติ', 'อนุมัติแล้ว', 'ปฏิเสธ'],
        datasets: [{
          data: [statusCounts.pending, statusCounts.approved, statusCounts.rejected],
          backgroundColor: ['#e8a200', '#2d9d5f', '#d9263d'], // เหลือง, เขียว, แดง
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });

    // ─── วาดกราฟแท่ง (Bar Chart) พัสดุคงเหลือต่ำสุด 10 อันดับ ───
    // เรียงลำดับรายการที่มี remaining_quantity น้อยที่สุดไปมาก
    const lowestItems = [...items].sort((a, b) => a.remaining_quantity - b.remaining_quantity).slice(0, 10);
    const itemLabels = lowestItems.map(i => i.item_name);
    const itemData = lowestItems.map(i => i.remaining_quantity);

    const ctxBar = document.getElementById('stockBarChart').getContext('2d');
    if (stockBarChartInstance) stockBarChartInstance.destroy();
    stockBarChartInstance = new Chart(ctxBar, {
      type: 'bar',
      data: {
        labels: itemLabels,
        datasets: [{
          label: 'จำนวนคงเหลือ',
          data: itemData,
          backgroundColor: '#1a6ab5',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 45 } }
        },
        plugins: { legend: { display: false } } // ซ่อน Legend เพราะมีชุดข้อมูลเดียว
      }
    });

    // ─── ตารางรายการเบิกล่าสุด ───
    document.getElementById('recent-req-card').innerHTML = `
      <div class="card-header">
        <h3><i class="fas fa-clock-rotate-left"></i> รายการเบิกล่าสุด</h3>
        <button class="btn btn-outline btn-sm" onclick="navigateTo('requisitions-admin')">ดูทั้งหมด</button>
      </div>
      <div class="card-body" style="padding:0">
        <div class="table-wrap">
          <table>
            <thead><tr><th>เลขที่</th><th>ผู้ขอ</th><th>ความจำเป็น</th><th>วันที่</th><th>สถานะ</th></tr></thead>
            <tbody>
              ${(stats.recent_req || []).map(r => `<tr>
                <td><span style="font-family:var(--mono);font-size:.82rem">${r.requisition_no}</span></td>
                <td>${r.name}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.necessity || '-'}</td>
                <td style="font-size:.82rem">${fmtDate(r.created_at)}</td>
                <td>${statusBadge(r.status)}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="table-empty">ไม่มีข้อมูล</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch(e) { 
    toast(e.message, 'error'); 
  }
}

// ══════════════════════════════════════════
// DASHBOARD USER
// ══════════════════════════════════════════
async function renderDashboardUser(pc) {
  pc.innerHTML = `
    <div class="page-header">
      <h2><i class="fas fa-house"></i> แดชบอร์ดของฉัน</h2>
      <button class="btn btn-accent" onclick="navigateTo('request')"><i class="fas fa-plus"></i> ขอเบิกพัสดุ</button>
    </div>
    <div class="stats-grid" id="user-stats" style="grid-template-columns:repeat(4,1fr)">
      ${[4].fill('').map(() => '<div class="stat-card"><div class="stat-icon blue"><i class="fas fa-spinner fa-spin"></i></div><div class="stat-info"><div class="stat-value">-</div></div></div>').join('')}
    </div>
    <div class="card" id="user-recent"></div>
  `;
  try {
    const s = await api('GET', '/stats');
    document.getElementById('user-stats').innerHTML = `
      <div class="stat-card blue">
        <div class="stat-icon blue"><i class="fas fa-file-lines"></i></div>
        <div class="stat-info"><div class="stat-value">${s.total}</div><div class="stat-label">รายการทั้งหมด</div></div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-icon yellow"><i class="fas fa-clock"></i></div>
        <div class="stat-info"><div class="stat-value">${s.pending}</div><div class="stat-label">รออนุมัติ</div></div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
        <div class="stat-info"><div class="stat-value">${s.approved}</div><div class="stat-label">อนุมัติแล้ว</div></div>
      </div>
      <div class="stat-card red">
        <div class="stat-icon red"><i class="fas fa-times-circle"></i></div>
        <div class="stat-info"><div class="stat-value">${s.rejected}</div><div class="stat-label">ปฏิเสธ</div></div>
      </div>
    `;
    const reqs = await api('GET', '/requisitions');
    document.getElementById('user-recent').innerHTML = `
      <div class="card-header"><h3><i class="fas fa-clock-rotate-left"></i> รายการเบิกล่าสุด</h3>
        <button class="btn btn-outline btn-sm" onclick="navigateTo('history')">ดูทั้งหมด</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>เลขที่</th><th>วันที่ขอ</th><th>ความจำเป็น</th><th>สถานะ</th></tr></thead>
          <tbody>
            ${reqs.slice(0,5).map(r => `<tr>
              <td><span style="font-family:var(--mono);font-size:.82rem">${r.requisition_no}</span></td>
              <td>${fmtDate(r.created_at)}</td>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.necessity}</td>
              <td>${statusBadge(r.status)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="table-empty"><i class="fas fa-inbox"></i>ยังไม่มีรายการ</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch(e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════════
// USERS MANAGEMENT
// ══════════════════════════════════════════
async function renderUsers(pc) {
  pc.innerHTML = `
    <div class="page-header">
      <h2><i class="fas fa-users"></i> จัดการสมาชิก</h2>
      <div class="page-actions">
        <div class="search-bar"><i class="fas fa-search"></i><input type="text" placeholder="ค้นหาชื่อ/รหัส..." id="user-search" oninput="filterUsers()"></div>
        <button class="btn btn-primary" onclick="openUserModal()"><i class="fas fa-user-plus"></i> เพิ่มสมาชิก</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table id="users-table">
          <thead><tr><th>รหัสพนักงาน</th><th>ชื่อ-นามสกุล</th><th>แผนก</th><th>Email</th><th>ชื่อผู้ใช้</th><th>สิทธ์</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
          <tbody id="users-tbody"><tr><td colspan="8" class="table-empty"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  await loadUsers();
}

let allUsers = [];
async function loadUsers() {
  try {
    allUsers = await api('GET', '/users');
    renderUsersTable(allUsers);
  } catch(e) { toast(e.message, 'error'); }
}
function filterUsers() {
  const q = document.getElementById('user-search')?.value.toLowerCase() || '';
  renderUsersTable(allUsers.filter(u => `${u.first_name} ${u.last_name} ${u.employee_id} ${u.username}`.toLowerCase().includes(q)));
}
function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = users.length === 0 ? `<tr><td colspan="8" class="table-empty"><i class="fas fa-users-slash"></i><br>ไม่พบข้อมูลสมาชิก</td></tr>` :
    users.map(u => `<tr>
      <td><span style="font-family:var(--mono);font-size:.82rem">${u.employee_id}</span></td>
      <td style="font-weight:600">${u.first_name} ${u.last_name}</td>
      <td>${u.department || '-'}</td>
      <td style="font-size:.82rem">${u.email}</td>
      <td><span style="font-family:var(--mono);font-size:.82rem">${u.username}</span></td>
      <td><span class="badge ${roleClass(u.role)}">${roleName(u.role)}</span></td>
      <td><span class="badge badge-${u.status}">${u.status === 'active' ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm btn-icon" title="แก้ไข" onclick="openUserModal(${u.id})"><i class="fas fa-edit"></i></button>
        ${isAdmin() && u.id !== currentUser.id ? `<button class="btn btn-ghost btn-sm btn-icon" title="${u.status==='active'?'ปิดใช้งาน':'เปิดใช้งาน'}" onclick="toggleUser(${u.id},'${u.status}')"><i class="fas fa-${u.status==='active'?'ban':'check-circle'}"></i></button>` : ''}
      </td>
    </tr>`).join('');
}

let depts = [];
async function openUserModal(userId = null) {
  if (!depts.length) depts = await api('GET', '/departments');
  let user = null;
  if (userId) { user = allUsers.find(u => u.id === userId); }
  const deptOpts = depts.map(d => `<option value="${d.id}" ${user?.department === d.name ? 'selected' : ''}>${d.name}</option>`).join('');
  const roleOpts = ['admin','supervisor','user'].map(r => `<option value="${r}" ${user?.role === r ? 'selected':''}>${roleName(r)}</option>`).join('');
  openModal(userId ? 'แก้ไขข้อมูลสมาชิก' : 'เพิ่มสมาชิกใหม่', `
    <form id="user-form">
      <div class="form-row col-2">
        <div class="form-group"><label class="form-label">รหัสพนักงาน<span class="required">*</span></label>
          <input class="form-control" id="uf-empid" value="${user?.employee_id||''}" ${userId ? 'disabled' : 'required'}></div>
        <div class="form-group"><label class="form-label">แผนก<span class="required">*</span></label>
          <select class="form-control" id="uf-dept">${deptOpts}</select></div>
      </div>
      <div class="form-row col-2">
        <div class="form-group"><label class="form-label">ชื่อ<span class="required">*</span></label>
          <input class="form-control" id="uf-fname" value="${user?.first_name||''}" required></div>
        <div class="form-group"><label class="form-label">นามสกุล<span class="required">*</span></label>
          <input class="form-control" id="uf-lname" value="${user?.last_name||''}" required></div>
      </div>
      <div class="form-group"><label class="form-label">Email<span class="required">*</span></label>
        <input type="email" class="form-control" id="uf-email" value="${user?.email||''}" required></div>
      <div class="form-row col-2">
        <div class="form-group"><label class="form-label">ชื่อผู้ใช้<span class="required">*</span></label>
          <input class="form-control" id="uf-username" value="${user?.username||''}" ${userId ? 'disabled':'required'}></div>
        <div class="form-group"><label class="form-label">รหัสผ่าน${userId ? '' : '<span class="required">*</span>'}</label>
          <input type="password" class="form-control" id="uf-pass" placeholder="${userId ? 'เว้นว่างหากไม่เปลี่ยน' : 'กรอกรหัสผ่าน'}" ${userId ? '' : 'required'}></div>
      </div>
      <div class="form-group"><label class="form-label">สิทธ์การใช้งาน</label>
        <select class="form-control" id="uf-role">${roleOpts}</select></div>
    </form>
  `, `
    <button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="saveUser(${userId || 'null'})"><i class="fas fa-save"></i> บันทึก</button>
  `);
}

async function saveUser(userId) {
  const body = {
    first_name: document.getElementById('uf-fname').value.trim(),
    last_name:  document.getElementById('uf-lname').value.trim(),
    email:      document.getElementById('uf-email').value.trim(),
    department_id: document.getElementById('uf-dept').value,
    role:       document.getElementById('uf-role').value,
  };
  if (!userId) {
    body.employee_id = document.getElementById('uf-empid').value.trim();
    body.username    = document.getElementById('uf-username').value.trim();
    body.password    = document.getElementById('uf-pass').value;
  } else {
    const pw = document.getElementById('uf-pass').value;
    if (pw) body.password = pw;
  }
  setLoading(true);
  try {
    if (userId) await api('PUT', `/users/${userId}`, body);
    else await api('POST', '/users', body);
    closeModalDirect();
    await loadUsers();
    toast(userId ? 'อัปเดตสำเร็จ' : 'เพิ่มสมาชิกสำเร็จ', 'success');
  } catch(e) { toast(e.message, 'error'); }
  finally { setLoading(false); }
}

async function toggleUser(uid, status) {
  const newStatus = status === 'active' ? 'inactive' : 'active';
  const label = newStatus === 'active' ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
  confirm(`${label}ผู้ใช้`, `ต้องการ${label}ผู้ใช้นี้?`, newStatus==='active'?'✅':'🚫', async () => {
    setLoading(true);
    try {
      await api('PUT', `/users/${uid}`, { status: newStatus });
      await loadUsers();
      toast(label + 'สำเร็จ', 'success');
    } catch(e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, label, newStatus === 'active' ? 'btn-success' : 'btn-danger');
}

// ══════════════════════════════════════════
// ITEMS MANAGEMENT
// ══════════════════════════════════════════
async function renderItems(pc) {
  pc.innerHTML = `
    <div class="page-header">
      <h2><i class="fas fa-boxes-stacked"></i> จัดการพัสดุ</h2>
      <div class="page-actions">
        <div class="search-bar"><i class="fas fa-search"></i><input type="text" placeholder="ค้นหา..." id="item-search" oninput="filterItems()"></div>
        <button class="btn btn-primary" onclick="openItemModal()"><i class="fas fa-plus"></i> เพิ่มพัสดุ</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>รหัส</th><th>ชื่อพัสดุ</th><th>หมวดหมู่</th><th>หน่วย</th><th>จำนวนทั้งหมด</th><th>คงเหลือ</th><th>สถานะสต็อก</th><th>จัดการ</th></tr></thead>
          <tbody id="items-tbody"><tr><td colspan="8" class="table-empty"><i class="fas fa-spinner fa-spin"></i></td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  await loadItems();
}
let allItems = [];
async function loadItems() {
  try {
    allItems = await api('GET', '/items');
    renderItemsTable(allItems);
  } catch(e) { toast(e.message,'error'); }
}
function filterItems() {
  const q = document.getElementById('item-search')?.value.toLowerCase() || '';
  renderItemsTable(allItems.filter(i => `${i.item_code} ${i.item_name} ${i.category}`.toLowerCase().includes(q)));
}
function renderItemsTable(items) {
  const tbody = document.getElementById('items-tbody');
  if (!tbody) return;
  tbody.innerHTML = items.length === 0 ? `<tr><td colspan="8" class="table-empty"><i class="fas fa-box-open"></i><br>ไม่พบข้อมูลพัสดุ</td></tr>` :
    items.map(i => {
      const pct = i.total_quantity > 0 ? i.remaining_quantity/i.total_quantity : 0;
      const cls = pct > 0.5 ? 'high' : pct > 0.2 ? 'medium' : 'low';
      return `<tr>
        <td><span style="font-family:var(--mono);font-size:.82rem">${i.item_code}</span></td>
        <td style="font-weight:600">${i.item_name}</td>
        <td><span style="font-size:.78rem;color:var(--text-muted)">${i.category||'-'}</span></td>
        <td>${i.unit}</td>
        <td style="text-align:center;font-family:var(--mono)">${i.total_quantity}</td>
        <td style="text-align:center;font-family:var(--mono);font-weight:700;color:${cls==='low'?'var(--danger)':cls==='medium'?'var(--warning)':'var(--success)'}">${i.remaining_quantity}</td>
        <td style="min-width:100px">
          <div style="display:flex;align-items:center;gap:8px">
            <div class="stock-bar" style="flex:1"><div class="stock-bar-inner ${cls}" style="width:${Math.round(pct*100)}%"></div></div>
            <span style="font-size:.72rem;color:var(--text-muted);width:30px">${Math.round(pct*100)}%</span>
          </div>
        </td>
        <td>
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openItemModal(${i.id})" title="แก้ไข"><i class="fas fa-edit"></i></button>
          <button class="btn btn-ghost btn-sm btn-icon" onclick="deleteItem(${i.id},'${i.item_name}')" title="ลบ" style="color:var(--danger)"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
}

function openItemModal(itemId = null) {
  const item = itemId ? allItems.find(i => i.id === itemId) : null;
  const usedQty = item ? (item.total_quantity - item.remaining_quantity) : 0;
  openModal(item ? 'แก้ไขข้อมูลพัสดุ' : 'เพิ่มพัสดุใหม่', `
    <form id="item-form">
      <div class="form-row col-2">
        <div class="form-group"><label class="form-label">รหัสพัสดุ<span class="required">*</span></label>
          <input class="form-control" id="if-code" value="${item?.item_code||''}" ${itemId?'disabled':'required'}></div>
        <div class="form-group"><label class="form-label">หมวดหมู่</label>
          <input class="form-control" id="if-cat" value="${item?.category||''}" placeholder="เช่น เครื่องเขียน"></div>
      </div>
      <div class="form-group"><label class="form-label">ชื่อพัสดุ<span class="required">*</span></label>
        <input class="form-control" id="if-name" value="${item?.item_name||''}" required></div>
      <div class="form-row col-2">
        <div class="form-group"><label class="form-label">หน่วย<span class="required">*</span></label>
          <input class="form-control" id="if-unit" value="${item?.unit||''}" placeholder="อัน, กล่อง, รีม..." required></div>
        <div class="form-group"><label class="form-label">จำนวนทั้งหมด<span class="required">*</span></label>
          <input type="number" class="form-control" id="if-qty" value="${item?.total_quantity||0}" min="0" required></div>
      </div>
      ${itemId ? `
      <div class="form-row col-2">
        <div class="form-group">
          <label class="form-label">จำนวนคงเหลือ<span class="required">*</span></label>
          <input type="number" class="form-control" id="if-remain"
            value="${item?.remaining_quantity??0}" min="0" max="${item?.total_quantity||0}">
          <div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">
            <i class="fas fa-info-circle"></i> เบิกออกไปแล้ว ${usedQty} ชิ้น
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">สถานะ</label>
          <select class="form-control" id="if-status">
            <option value="active" ${item?.status==='active'?'selected':''}>ใช้งาน</option>
            <option value="inactive" ${item?.status==='inactive'?'selected':''}>ปิดใช้งาน</option>
          </select>
        </div>
      </div>` : ''}
      <div class="form-group"><label class="form-label">รายละเอียด</label>
        <textarea class="form-control" id="if-desc" rows="2">${item?.description||''}</textarea></div>
    </form>
  `, `
    <button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="saveItem(${itemId||'null'})"><i class="fas fa-save"></i> บันทึก</button>
  `);
}

async function saveItem(itemId) {
  const totalQty = parseInt(document.getElementById('if-qty').value) || 0;
  const body = {
    item_name: document.getElementById('if-name').value.trim(),
    unit: document.getElementById('if-unit').value.trim(),
    total_quantity: totalQty,
    category: document.getElementById('if-cat').value.trim(),
    description: document.getElementById('if-desc').value.trim(),
  };
  if (!itemId) {
    body.item_code = document.getElementById('if-code').value.trim();
  } else {
    // ส่ง remaining_quantity ที่แก้ไขด้วย
    const remainEl = document.getElementById('if-remain');
    if (remainEl) {
      const remainVal = parseInt(remainEl.value) || 0;
      body.remaining_quantity = Math.min(remainVal, totalQty);
    }
    const statusEl = document.getElementById('if-status');
    if (statusEl) body.status = statusEl.value;
  }
  if (!body.item_name || !body.unit) { toast('กรุณากรอกข้อมูลให้ครบ', 'warn'); return; }
  setLoading(true);
  try {
    if (itemId) await api('PUT', `/items/${itemId}`, body);
    else await api('POST', '/items', body);
    closeModalDirect();
    await loadItems();
    toast('บันทึกสำเร็จ', 'success');
  } catch(e) { toast(e.message, 'error'); }
  finally { setLoading(false); }
}

async function deleteItem(id, name) {
  confirm('ลบพัสดุ', `ต้องการลบ "${name}" ออกจากระบบ?`, '🗑️', async () => {
    setLoading(true);
    try {
      await api('DELETE', `/items/${id}`);
      await loadItems();
      toast('ลบพัสดุสำเร็จ', 'success');
    } catch(e) { toast(e.message,'error'); }
    finally { setLoading(false); }
  });
}

// ══════════════════════════════════════════
// STOCK MANAGEMENT (Import/Export)
// ══════════════════════════════════════════
async function renderStock(pc) {
  pc.innerHTML = `
    <div class="page-header">
      <h2><i class="fas fa-list-check"></i> จัดการรายการสต็อก</h2>
      <div class="page-actions">
        <div class="export-dropdown" id="export-dropdown">
          <button class="btn btn-outline" onclick="toggleExportMenu(event)">
            <i class="fas fa-file-export"></i> Export <i class="fas fa-chevron-down" style="font-size:.72rem;margin-left:4px"></i>
          </button>
          <div class="export-menu" id="export-menu">
            <div class="export-menu-item" onclick="exportData('csv')">
              <i class="fas fa-file-csv" style="color:#21a366"></i> CSV
            </div>
            <div class="export-menu-item" onclick="exportData('excel')">
              <i class="fas fa-file-excel" style="color:#1d6f42"></i> Excel (.xlsx)
            </div>
            <div class="export-menu-item" onclick="exportData('pdf')">
              <i class="fas fa-file-pdf" style="color:#e53935"></i> PDF
            </div>
          </div>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-file-import"></i> นำเข้าสต็อก (CSV)</h3></div>
        <div class="card-body">
          <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:12px">รูปแบบไฟล์ CSV: <code style="background:#f0f4f8;padding:2px 6px;border-radius:4px">item_code, item_name, unit, total_quantity, category</code></p>
          <div class="file-drop" id="file-drop" onclick="document.getElementById('csv-file').click()">
            <i class="fas fa-cloud-arrow-up"></i>
            <p>คลิกหรือลากไฟล์ CSV มาวาง</p>
            <p class="file-name" id="file-name-display"></p>
          </div>
          <input type="file" id="csv-file" accept=".csv" style="display:none" onchange="onCsvSelect(event)">
          <button class="btn btn-primary" style="margin-top:14px;width:100%" onclick="importCsv()"><i class="fas fa-upload"></i> นำเข้าข้อมูล</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-circle-info"></i> ข้อมูลสต็อกปัจจุบัน</h3></div>
        <div class="card-body" id="stock-summary">
          <div style="text-align:center;color:var(--text-muted);padding:20px"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</div>
        </div>
      </div>
    </div>
    <div id="import-result"></div>
  `;

  // Drag-drop
  const drop = document.getElementById('file-drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) {
      document.getElementById('csv-file').files = e.dataTransfer.files;
      document.getElementById('file-name-display').textContent = e.dataTransfer.files[0].name;
    }
  });

  // Load stock summary
  try {
    const items = await api('GET', '/items');
    const total = items.length;
    const low = items.filter(i => i.remaining_quantity <= i.total_quantity * 0.2).length;
    const totalQty = items.reduce((s,i) => s + i.remaining_quantity, 0);
    document.getElementById('stock-summary').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
        <div style="background:#f0f4f8;border-radius:8px;padding:16px">
          <div style="font-size:1.6rem;font-weight:800;color:var(--primary);font-family:var(--mono)">${total}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">รายการทั้งหมด</div>
        </div>
        <div style="background:#fef6e3;border-radius:8px;padding:16px">
          <div style="font-size:1.6rem;font-weight:800;color:var(--warning);font-family:var(--mono)">${low}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">ใกล้หมด</div>
        </div>
        <div style="background:#e8f7ee;border-radius:8px;padding:16px">
          <div style="font-size:1.6rem;font-weight:800;color:var(--success);font-family:var(--mono)">${totalQty.toLocaleString()}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">จำนวนคงเหลือรวม</div>
        </div>
      </div>
      <div style="margin-top:16px">
        <button class="btn btn-success" style="width:100%" onclick="exportData('csv')">
          <i class="fas fa-file-csv"></i> ดาวน์โหลด Export สต็อกทั้งหมด (CSV)
        </button>
      </div>
    `;
  } catch {}
}

function onCsvSelect(e) {
  const f = e.target.files[0];
  if (f) document.getElementById('file-name-display').textContent = f.name;
}

async function importCsv() {
  const fileInput = document.getElementById('csv-file');
  if (!fileInput.files[0]) { toast('กรุณาเลือกไฟล์ CSV', 'warn'); return; }
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  setLoading(true);
  try {
    const res = await api('POST', '/items/import', fd, true);
    const resultEl = document.getElementById('import-result');
    resultEl.innerHTML = `
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-check-circle" style="color:var(--success)"></i> ผลการนำเข้า</h3></div>
        <div class="card-body">
          <p style="color:var(--success);font-weight:600;margin-bottom:8px">✅ นำเข้าสำเร็จ ${res.success} รายการ</p>
          ${res.errors.length > 0 ? `<p style="color:var(--danger);font-weight:600;margin-bottom:8px">❌ ข้อผิดพลาด ${res.errors.length} รายการ</p>
          <ul style="font-size:.82rem;color:var(--danger);padding-left:20px">${res.errors.map(e=>`<li>${e}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
    `;
    await loadItems();
    toast(`นำเข้าสำเร็จ ${res.success} รายการ`, 'success');
  } catch(e) { toast(e.message,'error'); }
  finally { setLoading(false); }
}

// ══════════════════════════════════════════
// REQUISITIONS ADMIN
// ══════════════════════════════════════════
async function renderRequisitionsAdmin(pc) {
  pc.innerHTML = `
    <div class="page-header"><h2><i class="fas fa-clipboard-list"></i> รายการเบิกอุปกรณ์</h2></div>
    <div class="tabs">
      <div class="tab active" onclick="switchReqTab('all',this)">ทั้งหมด</div>
      <div class="tab" onclick="switchReqTab('pending',this)">รออนุมัติ</div>
      <div class="tab" onclick="switchReqTab('approved',this)">อนุมัติแล้ว</div>
      <div class="tab" onclick="switchReqTab('rejected',this)">ปฏิเสธ</div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>เลขที่</th><th>ผู้ขอ</th><th>แผนก</th><th>ความจำเป็น</th><th>วันที่</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
          <tbody id="req-admin-tbody"><tr><td colspan="7" class="table-empty"><i class="fas fa-spinner fa-spin"></i></td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  await loadReqAdmin('all');
}

let allReqAdmin = [];
let currentReqTab = 'all';
async function loadReqAdmin(filter = 'all') {
  currentReqTab = filter;
  try {
    allReqAdmin = await api('GET', '/requisitions');
    renderReqAdminTable(filter);
  } catch(e) { toast(e.message,'error'); }
}
function switchReqTab(filter, el) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderReqAdminTable(filter);
  currentReqTab = filter;
  refreshPendingBadge();
}
function renderReqAdminTable(filter) {
  const tbody = document.getElementById('req-admin-tbody');
  if (!tbody) return;
  const filtered = filter === 'all' ? allReqAdmin : allReqAdmin.filter(r => r.status === filter);
  tbody.innerHTML = filtered.length === 0 ? `<tr><td colspan="7" class="table-empty"><i class="fas fa-inbox"></i><br>ไม่มีรายการ</td></tr>` :
    filtered.map(r => `<tr>
      <td><span style="font-family:var(--mono);font-size:.82rem">${r.requisition_no}</span></td>
      <td style="font-weight:600">${r.requester_name}</td>
      <td><span style="font-size:.78rem;color:var(--text-muted)">${r.department||'-'}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.necessity}</td>
      <td style="font-size:.82rem">${fmtDate(r.created_at)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="viewRequisition(${r.id})"><i class="fas fa-eye"></i> ดูรายละเอียด</button>
        ${r.status==='pending' ? `
          <button class="btn btn-success btn-sm" onclick="approveReq(${r.id})"><i class="fas fa-check"></i></button>
          <button class="btn btn-danger btn-sm" onclick="rejectReq(${r.id})"><i class="fas fa-times"></i></button>
        ` : ''}
      </td>
    </tr>`).join('');
}

function viewRequisition(id) {
  const r = allReqAdmin.find(x => x.id === id);
  if (!r) return;
  openModal(`รายละเอียดคำขอเบิก - ${r.requisition_no}`, `
    <div style="display:grid;gap:12px">
      <div style="background:#f8fafc;border-radius:8px;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.875rem">
        <div><span style="color:var(--text-muted)">ผู้ขอ:</span> <strong>${r.requester_name}</strong></div>
        <div><span style="color:var(--text-muted)">แผนก:</span> ${r.department||'-'}</div>
        <div><span style="color:var(--text-muted)">วันที่ขอ:</span> ${fmtDate(r.created_at)}</div>
        <div><span style="color:var(--text-muted)">สถานะ:</span> ${statusBadge(r.status)}</div>
      </div>
      <div><strong>ความจำเป็นในการเบิก:</strong><p style="margin-top:4px;font-size:.875rem;color:var(--text-muted)">${r.necessity}</p></div>
      ${r.note ? `<div><strong>หมายเหตุ:</strong><p style="margin-top:4px;font-size:.875rem;color:var(--text-muted)">${r.note}</p></div>` : ''}
      ${r.reject_reason ? `<div class="reject-note"><i class="fas fa-times-circle"></i><div><strong>เหตุผลที่ปฏิเสธ:</strong> ${r.reject_reason}</div></div>` : ''}
      <div>
        <strong>รายการที่ขอเบิก:</strong>
        <table style="margin-top:8px">
          <thead><tr><th>รหัส</th><th>ชื่อพัสดุ</th><th>หน่วย</th><th>จำนวนที่ขอ</th>${r.status!=='pending'?'<th>อนุมัติ</th>':''}</tr></thead>
          <tbody>
            ${(r.items||[]).map(i => `<tr>
              <td><span style="font-family:var(--mono);font-size:.78rem">${i.item_code}</span></td>
              <td>${i.item_name}</td><td>${i.unit}</td>
              <td style="text-align:center">${i.quantity_requested}</td>
              ${r.status!=='pending'?`<td style="text-align:center">${i.quantity_approved}</td>`:''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${r.status==='pending' ? `
        <div style="display:flex;gap:10px;padding-top:8px;border-top:1px solid var(--border)">
          <button class="btn btn-success" style="flex:1" onclick="closeModalDirect();approveReq(${r.id})"><i class="fas fa-check"></i> อนุมัติ</button>
          <button class="btn btn-danger" style="flex:1" onclick="closeModalDirect();rejectReq(${r.id})"><i class="fas fa-times"></i> ปฏิเสธ</button>
        </div>
      ` : ''}
    </div>
  `, '', true);
}

async function approveReq(id) {
  confirm('อนุมัติคำขอเบิก', 'ต้องการอนุมัติคำขอเบิกนี้? ระบบจะตัดจำนวนพัสดุอัตโนมัติ', '✅', async () => {
    setLoading(true);
    try {
      await api('POST', `/requisitions/${id}/approve`, { action: 'approve' });
      // ── Refresh พร้อมกันทันที: รายการเบิก + สต็อก + badge
      await Promise.all([
        loadReqAdmin(currentReqTab),
        api('GET', '/items').then(d => { allItems = d; }),
        refreshPendingBadge(),
      ]);
      // ── อัปเดต stock bar ถ้า view items เปิดอยู่
      if (currentView === 'items') renderItemsTable(allItems);
      showRealtimeBanner('✅ อนุมัติสำเร็จ — สต็อกอัปเดตแล้ว', 'success');
      toast('อนุมัติสำเร็จ — ตัดสต็อกเรียบร้อย', 'success');
    } catch(e) { toast(e.message,'error'); }
    finally { setLoading(false); }
  }, 'อนุมัติ', 'btn-success');
}

async function rejectReq(id) {
  openModal('ปฏิเสธคำขอเบิก', `
    <div class="form-group">
      <label class="form-label">เหตุผลที่ปฏิเสธ<span class="required">*</span></label>
      <textarea class="form-control" id="reject-reason" rows="3" placeholder="กรอกเหตุผล..."></textarea>
    </div>
  `, `
    <button class="btn btn-ghost" onclick="closeModalDirect()">ยกเลิก</button>
    <button class="btn btn-danger" onclick="doReject(${id})"><i class="fas fa-times"></i> ปฏิเสธ</button>
  `);
}
async function doReject(id) {
  const reason = document.getElementById('reject-reason')?.value.trim();
  if (!reason) { toast('กรุณากรอกเหตุผล', 'warn'); return; }
  setLoading(true);
  try {
    await api('POST', `/requisitions/${id}/approve`, { action: 'reject', reason });
    closeModalDirect();
    await loadReqAdmin(currentReqTab);
    await refreshPendingBadge();
    toast('ปฏิเสธคำขอแล้ว', 'info');
  } catch(e) { toast(e.message,'error'); }
  finally { setLoading(false); }
}

// ══════════════════════════════════════════
// REQUEST FORM (User)
// ══════════════════════════════════════════
let reqItems = [];
async function renderRequest(pc) {
  reqItems = [];
  if (!allItems.length) { try { allItems = await api('GET', '/items'); } catch {} }
  pc.innerHTML = `
    <div class="page-header"><h2><i class="fas fa-hand-holding-box"></i> ขอเบิกพัสดุ</h2></div>
    <div class="card" style="max-width:800px;margin:0 auto">
      <div class="card-header"><h3><i class="fas fa-file-pen"></i> แบบฟอร์มขอเบิกพัสดุ</h3></div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">ชื่อ-นามสกุลผู้ขอเบิก</label>
          <input class="form-control" value="${currentUser.name}" disabled>
        </div>
        <div class="form-group">
          <label class="form-label">ความจำเป็นต้องเบิก<span class="required">*</span></label>
          <textarea class="form-control" id="req-necessity" rows="3" placeholder="อธิบายเหตุผลความจำเป็น..." required></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">รายการที่ขอเบิก</label>
          <div id="req-items-list"></div>
          <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="addReqItem()">
            <i class="fas fa-plus"></i> เพิ่มรายการ
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">หมายเหตุ</label>
          <textarea class="form-control" id="req-note" rows="2" placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"></textarea>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
          <button class="btn btn-ghost" onclick="navigateTo('dashboard-user')">ยกเลิก</button>
          <button class="btn btn-accent" onclick="submitRequest()"><i class="fas fa-paper-plane"></i> ส่งคำขอเบิก</button>
        </div>
      </div>
    </div>
  `;
  addReqItem();
}

function addReqItem() {
  reqItems.push({ item_id: '', quantity: 1 });
  renderReqItems();
}
function removeReqItem(idx) {
  reqItems.splice(idx, 1);
  renderReqItems();
}
function renderReqItems() {
  const container = document.getElementById('req-items-list');
  if (!container) return;
  container.innerHTML = reqItems.map((item, i) => `
    <div class="req-item-row">
      <select class="form-control" onchange="reqItems[${i}].item_id=this.value" style="grid-column:1">
        <option value="">-- เลือกพัสดุ --</option>
        ${allItems.map(a => `<option value="${a.id}" ${a.id==item.item_id?'selected':''}>${a.item_code} - ${a.item_name} (คงเหลือ: ${a.remaining_quantity} ${a.unit})</option>`).join('')}
      </select>
      <span style="font-size:.82rem;color:var(--text-muted);white-space:nowrap">จำนวน:</span>
      <input type="number" class="form-control" style="width:80px" value="${item.quantity}" min="1"
        onchange="reqItems[${i}].quantity=parseInt(this.value)||1">
      <button class="btn-remove-item" onclick="removeReqItem(${i})" ${reqItems.length<=1?'disabled':''}>
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
}

async function submitRequest() {
  const necessity = document.getElementById('req-necessity')?.value.trim();
  if (!necessity) { toast('กรุณากรอกความจำเป็น', 'warn'); return; }
  const validItems = reqItems.filter(i => i.item_id);
  if (validItems.length === 0) { toast('กรุณาเลือกพัสดุอย่างน้อย 1 รายการ', 'warn'); return; }
  setLoading(true);
  try {
    const res = await api('POST', '/requisitions', {
      necessity,
      note: document.getElementById('req-note')?.value.trim() || '',
      items: validItems.map(i => ({ item_id: parseInt(i.item_id), quantity: i.quantity }))
    });
    // ── Refresh stock list ทันทีหลังส่งคำขอ
    allItems = await api('GET', '/items').catch(() => allItems);
    // ── Refresh history
    allHistory = await api('GET', '/requisitions').catch(() => allHistory);
    toast(`✅ ส่งคำขอ ${res.requisition_no} สำเร็จ — รอการอนุมัติ`, 'success');
    navigateTo('history');
  } catch(e) { toast(e.message,'error'); }
  finally { setLoading(false); }
}

// ══════════════════════════════════════════
// HISTORY (User)
// ══════════════════════════════════════════
async function renderHistory(pc) {
  pc.innerHTML = `
    <div class="page-header"><h2><i class="fas fa-clock-rotate-left"></i> ประวัติการเบิก</h2></div>
    <div class="tabs">
      <div class="tab active" onclick="switchHistTab('all',this)">ทั้งหมด</div>
      <div class="tab" onclick="switchHistTab('pending',this)">รออนุมัติ</div>
      <div class="tab" onclick="switchHistTab('approved',this)">อนุมัติแล้ว</div>
      <div class="tab" onclick="switchHistTab('rejected',this)">ปฏิเสธ</div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>เลขที่</th><th>วันที่ขอ</th><th>ความจำเป็น</th><th>รายการ</th><th>สถานะ</th><th>ผู้อนุมัติ</th><th>วันที่อนุมัติ</th><th></th></tr></thead>
          <tbody id="hist-tbody"><tr><td colspan="8" class="table-empty"><i class="fas fa-spinner fa-spin"></i></td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  await loadHistory('all');
}

let allHistory = [];
async function loadHistory(filter) {
  try {
    allHistory = await api('GET', '/requisitions');
    renderHistTable(filter);
  } catch(e) { toast(e.message,'error'); }
}
function switchHistTab(filter, el) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderHistTable(filter);
}
function renderHistTable(filter) {
  const tbody = document.getElementById('hist-tbody');
  if (!tbody) return;
  const data = filter === 'all' ? allHistory : allHistory.filter(r => r.status === filter);
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><i class="fas fa-inbox"></i><br>ไม่มีรายการ</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(r => {
    // ── สรุปรายการพัสดุแบบย่อ
    const itemSummary = (r.items||[]).map(i =>
      `<span style="display:inline-flex;align-items:center;gap:4px;background:#f0f4f8;border-radius:20px;padding:2px 10px;font-size:.72rem;margin:2px">
        <span style="font-family:var(--mono)">${i.item_code}</span>
        ${i.item_name}
        <strong>×${i.quantity_requested}</strong>
        ${r.status==='approved' ? `<span style="color:var(--success)">✓${i.quantity_approved}</span>` : ''}
       </span>`
    ).join('');

    // ── แถวหลัก
    const mainRow = `<tr style="cursor:pointer" onclick="toggleHistRow(${r.id})">
      <td><i class="fas fa-chevron-right" id="chevron-${r.id}" style="font-size:.7rem;color:var(--text-muted);margin-right:6px;transition:transform .2s"></i>
        <span style="font-family:var(--mono);font-size:.82rem">${r.requisition_no}</span></td>
      <td style="font-size:.78rem">${fmtDate(r.created_at)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.875rem">${r.necessity}</td>
      <td style="font-size:.82rem;color:var(--primary);font-weight:600">${(r.items||[]).length} รายการ</td>
      <td>${statusBadge(r.status)}</td>
      <td style="font-size:.78rem">${r.approver_name||'-'}</td>
      <td style="font-size:.78rem">${r.approved_at ? fmtDate(r.approved_at) : '-'}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();viewMyReq(${r.id})"><i class="fas fa-eye"></i></button></td>
    </tr>`;

    // ── แถวขยาย (แสดงรายการพัสดุทั้งหมด)
    const expandRow = `<tr id="expand-${r.id}" style="display:none;background:#f8faff">
      <td colspan="8" style="padding:8px 16px 12px 36px">
        <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin-bottom:6px">
          <i class="fas fa-boxes-stacked" style="color:var(--primary)"></i> รายการพัสดุที่ขอเบิก:
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${itemSummary}</div>
        ${r.reject_reason ? `<div style="margin-top:8px;padding:8px 12px;background:#fff0f0;border-radius:6px;font-size:.78rem;color:var(--danger)">
          <i class="fas fa-times-circle"></i> เหตุผลที่ปฏิเสธ: ${r.reject_reason}</div>` : ''}
        ${r.note ? `<div style="margin-top:6px;font-size:.78rem;color:var(--text-muted)"><i class="fas fa-sticky-note"></i> หมายเหตุ: ${r.note}</div>` : ''}
      </td>
    </tr>`;

    return mainRow + expandRow;
  }).join('');
}

function toggleHistRow(id) {
  const row = document.getElementById(`expand-${id}`);
  const chevron = document.getElementById(`chevron-${id}`);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'table-row';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
}

function viewMyReq(id) {
  const r = allHistory.find(x => x.id === id);
  if (!r) return;
  openModal(`${r.requisition_no}`, `
    <div style="display:grid;gap:12px;font-size:.875rem">
      <div style="background:#f8fafc;border-radius:8px;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><span style="color:var(--text-muted)">วันที่ขอ:</span> ${fmtDate(r.created_at)}</div>
        <div><span style="color:var(--text-muted)">สถานะ:</span> ${statusBadge(r.status)}</div>
        ${r.approved_at ? `<div><span style="color:var(--text-muted)">วันที่ดำเนินการ:</span> ${fmtDate(r.approved_at)}</div>` : ''}
        ${r.approver_name ? `<div><span style="color:var(--text-muted)">ผู้อนุมัติ:</span> ${r.approver_name}</div>` : ''}
      </div>
      <div><strong>ความจำเป็น:</strong><p style="margin-top:4px;color:var(--text-muted)">${r.necessity}</p></div>
      ${r.note ? `<div><strong>หมายเหตุ:</strong><p style="margin-top:4px;color:var(--text-muted)">${r.note}</p></div>` : ''}
      ${r.reject_reason ? `<div class="reject-note"><i class="fas fa-times-circle"></i><div><strong>เหตุผลที่ปฏิเสธ:</strong> ${r.reject_reason}</div></div>` : ''}
      <table>
        <thead><tr><th>ชื่อพัสดุ</th><th>หน่วย</th><th>ขอ</th>${r.status!=='pending'?'<th>ได้รับ</th>':''}</tr></thead>
        <tbody>
          ${(r.items||[]).map(i => `<tr>
            <td>${i.item_name}</td><td>${i.unit}</td>
            <td style="text-align:center">${i.quantity_requested}</td>
            ${r.status!=='pending'?`<td style="text-align:center">${i.quantity_approved}</td>`:''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `, `<button class="btn btn-ghost" onclick="closeModalDirect()">ปิด</button>`, true);
}

// ══════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════
async function renderSettings(pc) {
  pc.innerHTML = `
    <div class="page-header"><h2><i class="fas fa-gear"></i> ตั้งค่าระบบ</h2></div>
    <div class="card" style="max-width:700px">
      <div class="card-header"><h3><i class="fas fa-sliders"></i> ข้อมูลระบบ</h3></div>
      <div class="card-body">
        <div class="settings-section">
          <h3><i class="fas fa-globe"></i> ข้อมูลเว็บไซต์</h3>
          <div class="form-group"><label class="form-label">โลโก้เว็บไซต์ (URL รูปภาพ)</label>
            <input class="form-control" id="s-logo" placeholder="https://example.com/logo.png"></div>
          <div class="form-group"><label class="form-label">ชื่อเว็บไซต์<span class="required">*</span></label>
            <input class="form-control" id="s-name" placeholder="ชื่อระบบ"></div>
          <div class="form-group"><label class="form-label">ข้อมูลระบบ</label>
            <textarea class="form-control" id="s-info" rows="3" placeholder="รายละเอียดระบบ..."></textarea></div>
          <div class="form-group"><label class="form-label">เวอร์ชั่น</label>
            <input class="form-control" id="s-ver" placeholder="1.0.0"></div>
        </div>
        <div style="padding:16px;background:#f0f4f8;border-radius:8px;margin-bottom:16px">
          <div style="font-size:.82rem;color:var(--text-muted);display:grid;gap:6px">
            <div><i class="fas fa-server"></i> <strong>Backend:</strong> Python Flask</div>
            <div><i class="fas fa-database"></i> <strong>Database:</strong> MySQL</div>
            <div><i class="fas fa-hdd"></i> <strong>Platform:</strong> Synology NAS</div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="saveSettings()"><i class="fas fa-save"></i> บันทึกการตั้งค่า</button>
      </div>
    </div>
  `;
  try {
    const s = await api('GET', '/settings');
    document.getElementById('s-logo').value = s.site_logo || '';
    document.getElementById('s-name').value = s.site_name || '';
    document.getElementById('s-info').value = s.system_info || '';
    document.getElementById('s-ver').value = s.version || '1.0.0';
  } catch {}
}

async function saveSettings() {
  setLoading(true);
  try {
    await api('PUT', '/settings', {
      site_logo: document.getElementById('s-logo').value.trim(),
      site_name: document.getElementById('s-name').value.trim(),
      system_info: document.getElementById('s-info').value.trim(),
      version: document.getElementById('s-ver').value.trim(),
    });
    const name = document.getElementById('s-name').value.trim();
    document.getElementById('sidebar-site-name').textContent = name;
    document.getElementById('login-site-name').textContent = name;
    document.getElementById('sidebar-version').textContent = `v${document.getElementById('s-ver').value.trim()}`;
    toast('บันทึกการตั้งค่าสำเร็จ', 'success');
  } catch(e) { toast(e.message,'error'); }
  finally { setLoading(false); }
}

// ══════════════════════════════════════════
// EXPORT FUNCTIONS (CSV / Excel / PDF)
// ══════════════════════════════════════════

function toggleExportMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('export-menu');
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  // ปิด dropdown อื่น ๆ ก่อน
  document.querySelectorAll('.export-menu.open').forEach(m => m.classList.remove('open'));
  if (!isOpen) {
    menu.classList.add('open');
    // คลิกนอก dropdown = ปิด
    setTimeout(() => document.addEventListener('click', closeExportMenu, { once: true }), 0);
  }
}
function closeExportMenu() {
  document.querySelectorAll('.export-menu.open').forEach(m => m.classList.remove('open'));
}

async function exportData(format) {
  closeExportMenu();
  // โหลดข้อมูลล่าสุดจาก server
  setLoading(true);
  let items = [];
  try {
    items = await api('GET', '/items');
  } catch(e) {
    // fallback ใช้ข้อมูลที่มีอยู่แล้ว
    items = allItems;
  } finally {
    setLoading(false);
  }

  if (!items || items.length === 0) { toast('ไม่มีข้อมูลสำหรับ Export', 'warn'); return; }

  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { year:'numeric', month:'2-digit', day:'2-digit' }).replace(/\//g,'-');
  const filename = `stock_export_${dateStr}`;

  if (format === 'csv') {
    exportCSV(items, filename);
  } else if (format === 'excel') {
    exportExcel(items, filename);
  } else if (format === 'pdf') {
    exportPDF(items, filename);
  }
}

function getExportRows(items) {
  return items.map(i => ({
    'รหัสพัสดุ': i.item_code || '',
    'ชื่อพัสดุ': i.item_name || '',
    'หมวดหมู่': i.category || '',
    'หน่วย': i.unit || '',
    'จำนวนทั้งหมด': i.total_quantity ?? 0,
    'จำนวนคงเหลือ': i.remaining_quantity ?? 0,
    'รายละเอียด': i.description || '',
  }));
}

function exportCSV(items, filename) {
  const rows = getExportRows(items);
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const val = String(r[h]).replace(/"/g, '""');
      return `"${val}"`;
    }).join(','))
  ].join('\n');

  // เพิ่ม BOM สำหรับ Excel ให้อ่าน UTF-8 ได้ถูกต้อง
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename + '.csv');
  toast('Export CSV สำเร็จ', 'success');
}

function exportExcel(items, filename) {
  if (typeof XLSX === 'undefined') { toast('ไม่พบ library XLSX', 'error'); return; }
  const rows = getExportRows(items);
  const ws = XLSX.utils.json_to_sheet(rows);

  // ปรับความกว้างคอลัมน์อัตโนมัติ
  const colWidths = Object.keys(rows[0]).map(key => ({
    wch: Math.max(key.length * 2, ...rows.map(r => String(r[key]).length)) + 2
  }));
  ws['!cols'] = colWidths;

  // Style header row (เป็นสีเข้ม)
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (cell) {
      cell.s = {
        fill: { fgColor: { rgb: '1a6ab5' } },
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center' }
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock');

  // เพิ่ม sheet summary
  const total = items.length;
  const low = items.filter(i => i.remaining_quantity <= i.total_quantity * 0.2).length;
  const summaryData = [
    { 'ข้อมูลสรุป': 'รายการพัสดุทั้งหมด', 'จำนวน': total },
    { 'ข้อมูลสรุป': 'พัสดุใกล้หมด (≤20%)', 'จำนวน': low },
    { 'ข้อมูลสรุป': 'วันที่ Export', 'จำนวน': new Date().toLocaleDateString('th-TH') },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'สรุป');

  XLSX.writeFile(wb, filename + '.xlsx');
  toast('Export Excel สำเร็จ', 'success');
}

function exportPDF(items, filename) {
  const rows = getExportRows(items);
  const now = new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' });

  // สร้างหน้า HTML สำหรับ print เป็น PDF
  const tableRows = rows.map(r => `
    <tr>
      <td>${r['รหัสพัสดุ']}</td>
      <td>${r['ชื่อพัสดุ']}</td>
      <td>${r['หมวดหมู่']}</td>
      <td>${r['หน่วย']}</td>
      <td style="text-align:center">${r['จำนวนทั้งหมด']}</td>
      <td style="text-align:center;color:${r['จำนวนคงเหลือ'] <= r['จำนวนทั้งหมด']*0.2 ? '#d9263d' : r['จำนวนคงเหลือ'] <= r['จำนวนทั้งหมด']*0.5 ? '#e8a200' : '#2d9d5f'};font-weight:700">${r['จำนวนคงเหลือ']}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>รายงานสต็อกพัสดุ</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Sarabun',sans-serif; font-size:11pt; color:#1a1a2e; padding:20mm; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; border-bottom:2px solid #1a6ab5; padding-bottom:12px; }
    .title { font-size:16pt; font-weight:700; color:#1a6ab5; }
    .subtitle { font-size:9pt; color:#666; margin-top:4px; }
    .meta { text-align:right; font-size:9pt; color:#666; }
    .summary { display:flex; gap:16px; margin-bottom:16px; }
    .summary-box { background:#f0f4f8; border-radius:6px; padding:8px 16px; font-size:9pt; }
    .summary-box strong { font-size:14pt; color:#1a6ab5; display:block; }
    table { width:100%; border-collapse:collapse; font-size:9pt; }
    thead th { background:#1a6ab5; color:#fff; padding:7px 10px; text-align:left; font-weight:600; }
    tbody tr:nth-child(even) { background:#f5f7fa; }
    tbody td { padding:6px 10px; border-bottom:1px solid #e8ecf0; }
    .footer { margin-top:20px; font-size:8pt; color:#999; text-align:center; border-top:1px solid #e8ecf0; padding-top:10px; }
    @media print { body { padding:10mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">📦 รายงานสต็อกพัสดุ</div>
      <div class="subtitle">บริษัท บอสฟาร์มาแคร์ จำกัด — ระบบจัดการ Stock EN</div>
    </div>
    <div class="meta">วันที่ออกรายงาน: ${now}</div>
  </div>
  <div class="summary">
    <div class="summary-box"><strong>${items.length}</strong>รายการทั้งหมด</div>
    <div class="summary-box"><strong style="color:#d9263d">${items.filter(i=>i.remaining_quantity<=i.total_quantity*0.2).length}</strong>พัสดุใกล้หมด</div>
    <div class="summary-box"><strong style="color:#2d9d5f">${items.reduce((s,i)=>s+i.remaining_quantity,0).toLocaleString()}</strong>จำนวนคงเหลือรวม</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>รหัสพัสดุ</th>
        <th>ชื่อพัสดุ</th>
        <th>หมวดหมู่</th>
        <th>หน่วย</th>
        <th>จำนวนทั้งหมด</th>
        <th>คงเหลือ</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">สร้างโดยระบบบริหารคลังพัสดุ Bosspharmacare — ${now}</div>
</body>
</html>`;

  const printWin = window.open('', '_blank', 'width=900,height=700');
  if (!printWin) { toast('กรุณาอนุญาต Pop-up เพื่อ Export PDF', 'warn'); return; }
  printWin.document.write(html);
  printWin.document.close();
  printWin.onload = () => {
    setTimeout(() => {
      printWin.print();
      // printWin.close();
    }, 500);
  };
  toast('กำลังเปิด PDF สำหรับบันทึก...', 'info');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function statusBadge(status) {
  const map = { pending:'badge-pending', approved:'badge-approved', rejected:'badge-rejected' };
  const label = { pending:'รออนุมัติ', approved:'อนุมัติแล้ว', rejected:'ปฏิเสธ' };
  const icon = { pending:'fa-clock', approved:'fa-check-circle', rejected:'fa-times-circle' };
  return `<span class="badge ${map[status]||''}"><i class="fas ${icon[status]||'fa-circle'}"></i> ${label[status]||status}</span>`;
}
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
// ฟังก์ชันสำหรับเปิด/ปิดการมองเห็นรหัสผ่าน
function togglePassword() {
  const passwordInput = document.getElementById('login-password');
  const icon = document.getElementById('toggle-password');
  
  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    passwordInput.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}

// ─── Inject realtime banner CSS ──────────────────────────────────────────────
(function() {
  const s = document.createElement('style');
  s.textContent = `@keyframes slideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}
  #rt-banner{transition:opacity .3s ease}`;
  document.head.appendChild(s);
})();

// ─── Auto Login if token exists ───────────────────────────────────────────────
(async () => {
  if (authToken) {
    try {
      const me = await api('GET', '/me');
      currentUser = {
        id: me.id, name: `${me.first_name} ${me.last_name}`,
        username: me.username, role: me.role,
        employee_id: me.employee_id, department: me.dept_name, email: me.email
      };
      await initApp();
    } catch { authToken = ''; localStorage.removeItem('stock_token'); }
  }
  // Load site name for login page
  try {
    const s = await fetch(API + '/settings'); // no auth needed? Actually let's just show default
  } catch {}
})();
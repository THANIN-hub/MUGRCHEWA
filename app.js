/* ==========================================================
   ระบบบริหารจัดการแต้มสมาชิกดิจิทัล ร้านมักอาชีวะ
   ไฟล์: app.js (เชื่อมต่อฐานข้อมูลกลาง Supabase + QR Code + POS)
   ========================================================== */

const SUPABASE_URL = 'https://ziaekbkkadjpmgmhqlyk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppYWVrYmtrYWRqcG1nbWhxbHlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3NjA3MDcsImV4cCI6MjExMTMzNjcwN30.l7l0Y_HDeQR25f1KOer1RXGLTldIAiWEq3zFQptk1_c';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let db = {
    settings: {
        baht_per_point: 20,
        welcome_bonus: 5
    },
    users: [],
    rewards: [],
    point_history: [],
    redemptions: [],
    promotions: []
};

let currentUser = null;

// โหลดข้อมูลล่าสุดทั้งหมดจาก Supabase
async function syncFromCloud() {
    try {
        const [usersRes, rewardsRes, historyRes, redeemRes, promoRes, settingsRes] = await Promise.all([
            sb.from('users').select('*').order('id', { ascending: true }),
            sb.from('rewards').select('*').order('id', { ascending: true }),
            sb.from('point_history').select('*').order('id', { ascending: false }),
            sb.from('redemptions').select('*').order('id', { ascending: false }),
            sb.from('promotions').select('*').order('id', { ascending: false }),
            sb.from('settings').select('*')
        ]);

        if (usersRes.error) throw usersRes.error;

        db.users = usersRes.data || [];
        db.rewards = rewardsRes.data || [];
        db.point_history = historyRes.data || [];
        db.redemptions = redeemRes.data || [];
        db.promotions = promoRes.data || [];

        if (settingsRes.data) {
            settingsRes.data.forEach(s => {
                db.settings[s.setting_key] = parseInt(s.setting_value);
            });
        }
        return true;
    } catch (err) {
        console.error('Supabase Sync Error:', err);
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล');
        return false;
    }
}

async function refreshCurrentView() {
    showToast('กำลังซิงก์ข้อมูลล่าสุด...');
    const ok = await syncFromCloud();
    if (!ok || !currentUser) return;

    if (currentUser.role === 'admin') {
        renderAdminDashboard();
    } else {
        renderMemberDashboard();
    }
}

// ==========================================================
// ระบบแจ้งเตือน (Toast Notification) & Helper Functions
// ==========================================================
function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3500);
}

function formatDateTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
}

// ==========================================================
// ระบบยืนยันตัวตน (Authentication)
// ==========================================================
function switchAuthTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));

    if (tab === 'login') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('login-form').classList.add('active');
    } else {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('register-form').classList.add('active');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-login-submit');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเข้าสู่ระบบ...';

    await syncFromCloud();

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ';

    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) {
        showToast('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
        return;
    }

    currentUser = user;
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('nav-user-name').textContent = user.full_name;

    if (user.role === 'admin') {
        document.getElementById('nav-user-role').textContent = 'ผู้ดูแลร้าน';
        document.getElementById('member-dashboard').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        renderAdminDashboard();
    } else {
        document.getElementById('nav-user-role').textContent = 'สมาชิก';
        document.getElementById('admin-dashboard').classList.add('hidden');
        document.getElementById('member-dashboard').classList.remove('hidden');
        renderMemberDashboard();
    }
    showToast(`ยินดีต้อนรับคุณ ${user.full_name}`);
}

async function handleRegister(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-reg-submit');
    const fullName = document.getElementById('reg-fullname').value.trim();
    const studentId = document.getElementById('reg-studentid').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังสมัครสมาชิก...';

    await syncFromCloud();

    if (db.users.some(u => u.username === username)) {
        showToast('ชื่อผู้ใช้งาน (Username) นี้ถูกใช้งานแล้ว');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
        return;
    }
    if (db.users.some(u => u.student_id === studentId)) {
        showToast('รหัสนักศึกษา/บุคลากรนี้ลงทะเบียนแล้ว');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
        return;
    }

    const bonus = db.settings.welcome_bonus || 5;

    const { data: insertedUser, error } = await sb.from('users').insert([{
        username,
        password,
        full_name: fullName,
        student_id: studentId,
        role: 'member',
        points: bonus
    }]).select().single();

    if (error) {
        showToast('ไม่สามารถสมัครสมาชิกได้ กรุณาลองใหม่อีกครั้ง');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
        return;
    }

    await sb.from('point_history').insert([{
        user_id: insertedUser.id,
        amount: 0,
        points_earned: bonus,
        note: 'โบนัสต้อนรับสมาชิกใหม่'
    }]);

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
    e.target.reset();
    showToast(`สมัครสมาชิกสำเร็จ! ได้รับโบนัส ${bonus} แต้ม`);

    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
    await handleLogin(new Event('submit'));
}

function handleLogout() {
    currentUser = null;
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('login-form').reset();
    showToast('ออกจากระบบเรียบร้อยแล้ว');
}

// ==========================================================
// 1. ระบบสมาชิก (Member Functions)
// ==========================================================
async function switchMemberTab(tabName, btnElement) {
    document.querySelectorAll('#member-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#member-dashboard .tab-content').forEach(c => c.classList.remove('active'));

    btnElement.classList.add('active');
    document.getElementById(`mem-tab-${tabName}`).classList.add('active');

    await syncFromCloud();
    renderMemberDashboard();
}

function generateMemberQR(codeText) {
    const qrContainer = document.getElementById('member-qrcode');
    if (!qrContainer) return;
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
        text: String(codeText),
        width: 48,
        height: 48,
        colorDark: "#1E3A8A",
        colorLight: "#FFFFFF",
        correctLevel: QRCode.CorrectLevel.M
    });
}

function renderMemberDashboard() {
    const latestUser = db.users.find(u => u.id === currentUser.id);
    if (latestUser) currentUser = latestUser;

    document.getElementById('mem-card-name').textContent = currentUser.full_name;
    document.getElementById('mem-card-id').textContent = `รหัสนักศึกษา: ${currentUser.student_id || '-'}`;
    document.getElementById('mem-card-username').textContent = `@${currentUser.username}`;
    document.getElementById('mem-current-points').textContent = currentUser.points.toLocaleString();
    document.getElementById('mem-rate-info').textContent = `ทุกยอดซื้อ ${db.settings.baht_per_point} บาท รับ 1 แต้ม`;

    generateMemberQR(currentUser.student_id || currentUser.username);
    renderMemberPromotions();
    renderMemberRewards();
    renderMemberHistory();
}

function renderMemberPromotions() {
    const container = document.getElementById('member-promo-section');
    if (!container) return;
    const activePromos = (db.promotions || []).filter(p => p.is_active);

    if (!activePromos.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = activePromos.map(p => `
        <div class="promo-banner-card">
            <img src="${p.image}" alt="${p.title}" onerror="this.src='https://via.placeholder.com/600x200?text=Promotion'">
            <div class="promo-overlay">
                <span class="promo-tag"><i class="fa-solid fa-fire"></i> ${p.badge}</span>
                <h4>${p.title}</h4>
                <p>${p.description}</p>
            </div>
        </div>
    `).join('');
}

function renderMemberRewards() {
    const grid = document.getElementById('member-rewards-grid');
    grid.innerHTML = '';

    db.rewards.forEach(reward => {
        const canRedeem = currentUser.points >= reward.points_required && reward.stock > 0;
        let btnText = 'แลกของรางวัล';
        if (reward.stock <= 0) btnText = 'ของรางวัลหมด';
        else if (currentUser.points < reward.points_required) btnText = 'แต้มไม่เพียงพอ';

        const card = document.createElement('div');
        card.className = 'reward-card';
        card.innerHTML = `
            <img src="${reward.image}" alt="${reward.name}" class="reward-img" onerror="this.src='https://via.placeholder.com/400x200?text=Reward'">
            <div class="reward-body">
                <div>
                    <span class="reward-badge"><i class="fa-solid fa-coins"></i> ใช้ ${reward.points_required} แต้ม</span>
                    <h4 class="reward-title">${reward.name}</h4>
                    <p class="reward-desc">${reward.description}</p>
                </div>
                <div class="reward-footer">
                    <small class="text-muted">คงเหลือ: ${reward.stock} ชิ้น</small>
                    <button class="btn ${canRedeem ? 'btn-primary' : 'btn-outline'}" 
                            ${!canRedeem ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''} 
                            onclick="redeemReward(${reward.id})">
                        ${btnText}
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

async function redeemReward(rewardId) {
    await syncFromCloud();
    const latestUser = db.users.find(u => u.id === currentUser.id);
    const reward = db.rewards.find(r => r.id === rewardId);
    if (!reward || !latestUser) return;

    if (reward.stock <= 0) {
        showToast('ขออภัย ของรางวัลรายการนี้หมดแล้ว');
        renderMemberDashboard();
        return;
    }
    if (latestUser.points < reward.points_required) {
        showToast('แต้มสะสมของคุณไม่เพียงพอ');
        renderMemberDashboard();
        return;
    }

    if (!confirm(`ยืนยันการใช้ ${reward.points_required} แต้ม เพื่อแลก "${reward.name}" หรือไม่?`)) {
        return;
    }

    const newPoints = latestUser.points - reward.points_required;
    const newStock = reward.stock - 1;

    await Promise.all([
        sb.from('users').update({ points: newPoints }).eq('id', latestUser.id),
        sb.from('rewards').update({ stock: newStock }).eq('id', reward.id),
        sb.from('redemptions').insert([{
            user_id: latestUser.id,
            reward_id: reward.id,
            points_spent: reward.points_required,
            status: 'pending'
        }])
    ]);

    await syncFromCloud();
    renderMemberDashboard();
    showToast(`ส่งคำขอแลก "${reward.name}" สำเร็จ! กรุณาแสดงหน้าจอนี้ที่เคาน์เตอร์ร้าน`);
}

function renderMemberHistory() {
    const earnTbody = document.getElementById('mem-earn-tbody');
    const myEarnings = db.point_history.filter(h => h.user_id === currentUser.id);

    earnTbody.innerHTML = myEarnings.length ? myEarnings.map(item => `
        <tr>
            <td>${formatDateTime(item.created_at)}</td>
            <td>${item.note || 'ซื้อสินค้าภายในร้าน'}</td>
            <td>${Number(item.amount).toLocaleString()} บาท</td>
            <td><strong style="color:var(--success-green);">+${item.points_earned} แต้ม</strong></td>
        </tr>
    `).join('') : '<tr><td colspan="4" style="text-align:center;">ยังไม่มีประวัติการสะสมแต้ม</td></tr>';

    const redeemTbody = document.getElementById('mem-redeem-tbody');
    const myRedemptions = db.redemptions.filter(r => r.user_id === currentUser.id);

    redeemTbody.innerHTML = myRedemptions.length ? myRedemptions.map(item => {
        const reward = db.rewards.find(rw => rw.id === item.reward_id);
        const statusMap = {
            pending: '<span class="status-pill status-pending">รออนุมัติ / รอรับของ</span>',
            approved: '<span class="status-pill status-approved">แลกสำเร็จแล้ว</span>',
            rejected: '<span class="status-pill status-rejected">ยกเลิก (คืนแต้มแล้ว)</span>'
        };
        return `
            <tr>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${reward ? reward.name : 'ของรางวัลที่ถูกลบ'}</td>
                <td>-${item.points_spent} แต้ม</td>
                <td>${statusMap[item.status]}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="4" style="text-align:center;">ยังไม่มีประวัติการแลกของรางวัล</td></tr>';
}

// ==========================================================
// 2. ระบบผู้ดูแลร้าน (Admin Functions)
// ==========================================================
async function switchAdminTab(tabName, btnElement) {
    document.querySelectorAll('#admin-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#admin-dashboard .tab-content').forEach(c => c.classList.remove('active'));

    btnElement.classList.add('active');
    document.getElementById(`admin-tab-${tabName}`).classList.add('active');

    await syncFromCloud();
    renderAdminDashboard();
}

function renderAdminDashboard() {
    const members = db.users.filter(u => u.role === 'member');
    const totalPointsGiven = db.point_history.reduce((sum, h) => sum + Number(h.points_earned), 0);
    const totalSales = db.point_history.reduce((sum, h) => sum + Number(h.amount), 0);
    const pendingCount = db.redemptions.filter(r => r.status === 'pending').length;

    document.getElementById('stat-total-members').textContent = members.length.toLocaleString();
    document.getElementById('stat-total-points').textContent = totalPointsGiven.toLocaleString();
    document.getElementById('stat-total-redemptions').textContent = db.redemptions.length.toLocaleString();
    document.getElementById('stat-total-sales').textContent = totalSales.toLocaleString();
    document.getElementById('pending-badge').textContent = pendingCount;

    document.getElementById('setting-baht-per-point').value = db.settings.baht_per_point;

    renderPOSMemberSelect();
    renderRecentPOS();
    renderAdminRedemptions();
    renderAdminPromotions();
    renderAdminMembers();
    renderAdminRewards();
    renderAdminReports();
}

// --- ส่วนบันทึกยอดซื้อและคำนวณแต้มอัตโนมัติ (POS) ---
function renderPOSMemberSelect() {
    const datalist = document.getElementById('pos-members-datalist');
    if (!datalist) return;
    const members = db.users.filter(u => u.role === 'member');
    datalist.innerHTML = members.map(m =>
        `<option value="${m.student_id || m.username} | ${m.full_name}">มี ${m.points} แต้ม</option>`
    ).join('');
}

function handlePOSMemberSearch() {
    const input = document.getElementById('pos-member-search').value.trim();
    const hiddenId = document.getElementById('pos-selected-user-id');
    const statusText = document.getElementById('pos-member-status');

    const keyword = input.split('|')[0].trim().toLowerCase();
    const found = db.users.find(u =>
        u.role === 'member' &&
        ((u.student_id && u.student_id.toLowerCase() === keyword) ||
         u.username.toLowerCase() === keyword ||
         `${u.student_id || u.username} | ${u.full_name}`.toLowerCase() === input.toLowerCase())
    );

    if (found) {
        hiddenId.value = found.id;
        statusText.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success-green)"></i> พบสมาชิก: ${found.full_name} (แต้มปัจจุบัน: ${found.points})`;
    } else {
        hiddenId.value = '';
        statusText.textContent = input ? 'กำลังค้นหาสมาชิก...' : '';
    }
}

function setQuickAmount(val) {
    document.getElementById('pos-amount').value = val;
    calculatePreviewPoints();
}

function calculatePreviewPoints() {
    const amount = parseFloat(document.getElementById('pos-amount').value) || 0;
    const rate = parseInt(db.settings.baht_per_point) || 20;
    const earned = Math.floor(amount / rate);
    document.getElementById('pos-preview-points').textContent = `${earned} แต้ม`;
}

async function handleRecordPurchase(e) {
    e.preventDefault();
    const userId = parseInt(document.getElementById('pos-selected-user-id').value);
    const amount = parseFloat(document.getElementById('pos-amount').value);
    const note = document.getElementById('pos-note').value.trim();

    if (!userId) {
        showToast('ไม่พบข้อมูลสมาชิก กรุณาเลือกจากรายการที่ค้นหา');
        return;
    }

    const rate = parseInt(db.settings.baht_per_point) || 20;
    const pointsEarned = Math.floor(amount / rate);
    const member = db.users.find(u => u.id === userId);
    const newPoints = member.points + pointsEarned;

    await Promise.all([
        sb.from('users').update({ points: newPoints }).eq('id', userId),
        sb.from('point_history').insert([{
            user_id: userId,
            amount: amount,
            points_earned: pointsEarned,
            note: note || 'ซื้อสินค้าหน้าร้าน'
        }])
    ]);

    e.target.reset();
    document.getElementById('pos-selected-user-id').value = '';
    document.getElementById('pos-member-status').textContent = '';
    document.getElementById('pos-preview-points').textContent = '0 แต้ม';

    await syncFromCloud();
    renderAdminDashboard();
    showToast(`บันทึกยอดซื้อ ${amount} บาท ให้คุณ ${member.full_name} (+${pointsEarned} แต้ม)`);
}

async function handleUpdateRate(e) {
    e.preventDefault();
    const newRate = parseInt(document.getElementById('setting-baht-per-point').value);
    if (newRate < 1) return;

    await sb.from('settings').upsert({ setting_key: 'baht_per_point', setting_value: String(newRate) });
    await syncFromCloud();
    calculatePreviewPoints();
    showToast(`อัปเดตอัตราคำนวณแต้มเป็น ทุก ${newRate} บาท = 1 แต้ม`);
}

function renderRecentPOS() {
    const tbody = document.getElementById('admin-recent-pos-tbody');
    const recent = db.point_history.slice(0, 5);
    tbody.innerHTML = recent.map(item => {
        const user = db.users.find(u => u.id === item.user_id);
        return `
            <tr>
                <td>${user ? user.full_name : 'ไม่พบข้อมูล'}</td>
                <td>${Number(item.amount).toLocaleString()} ฿</td>
                <td><strong>+${item.points_earned}</strong></td>
            </tr>
        `;
    }).join('');
}

// --- ส่วนจัดการคำขอแลกของรางวัล ---
function renderAdminRedemptions() {
    const tbody = document.getElementById('admin-redemptions-tbody');
    tbody.innerHTML = db.redemptions.length ? db.redemptions.map(item => {
        const user = db.users.find(u => u.id === item.user_id);
        const reward = db.rewards.find(r => r.id === item.reward_id);

        let statusBadge = '';
        let actionBtns = '-';

        if (item.status === 'pending') {
            statusBadge = '<span class="status-pill status-pending">รออนุมัติ</span>';
            actionBtns = `
                <button class="btn btn-success" onclick="updateRedemptionStatus(${item.id}, 'approved')">
                    <i class="fa-solid fa-check"></i> อนุมัติ
                </button>
                <button class="btn btn-danger" onclick="updateRedemptionStatus(${item.id}, 'rejected')">
                    <i class="fa-solid fa-xmark"></i> ยกเลิก
                </button>
            `;
        } else if (item.status === 'approved') {
            statusBadge = '<span class="status-pill status-approved">อนุมัติแล้ว</span>';
        } else {
            statusBadge = '<span class="status-pill status-rejected">ยกเลิกแล้ว</span>';
        }

        return `
            <tr>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${user ? `${user.full_name} (${user.student_id || '-'})` : 'ไม่พบสมาชิก'}</td>
                <td>${reward ? reward.name : 'ไม่พบของรางวัล'}</td>
                <td>${item.points_spent} แต้ม</td>
                <td>${statusBadge}</td>
                <td>${actionBtns}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีรายการขอแลกของรางวัล</td></tr>';
}

async function updateRedemptionStatus(redemptionId, newStatus) {
    const item = db.redemptions.find(r => r.id === redemptionId);
    if (!item || item.status !== 'pending') return;

    await sb.from('redemptions').update({ status: newStatus }).eq('id', redemptionId);

    if (newStatus === 'rejected') {
        const user = db.users.find(u => u.id === item.user_id);
        const reward = db.rewards.find(r => r.id === item.reward_id);
        if (user) {
            await sb.from('users').update({ points: user.points + item.points_spent }).eq('id', user.id);
        }
        if (reward) {
            await sb.from('rewards').update({ stock: reward.stock + 1 }).eq('id', reward.id);
        }
        showToast('ยกเลิกรายการและคืนแต้มให้สมาชิกเรียบร้อยแล้ว');
    } else {
        showToast('อนุมัติการแลกของรางวัลเรียบร้อยแล้ว');
    }

    await syncFromCloud();
    renderAdminDashboard();
}

// --- ส่วนจัดการแบนเนอร์โปรโมชั่น (CRUD) ---
function renderAdminPromotions() {
    const grid = document.getElementById('admin-promos-grid');
    if (!grid) return;
    grid.innerHTML = (db.promotions || []).map(p => `
        <div class="reward-card" style="${!p.is_active ? 'opacity:0.6;' : ''}">
            <img src="${p.image}" alt="${p.title}" class="reward-img" onerror="this.src='https://via.placeholder.com/400x200?text=Banner'">
            <div class="reward-body">
                <div>
                    <span class="reward-badge">${p.badge} | ${p.is_active ? 'กำลังแสดง' : 'ซ่อนอยู่'}</span>
                    <h4 class="reward-title">${p.title}</h4>
                    <p class="reward-desc">${p.description}</p>
                </div>
                <div class="reward-footer">
                    <button class="btn btn-outline-sm" onclick="openPromoModal(${p.id})">
                        <i class="fa-solid fa-pen"></i> แก้ไข
                    </button>
                    <button class="btn btn-danger" onclick="deletePromotion(${p.id})">
                        <i class="fa-solid fa-trash"></i> ลบ
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function openPromoModal(promoId = null) {
    const modal = document.getElementById('promo-modal');
    const title = document.getElementById('promo-modal-title');

    if (promoId) {
        const p = db.promotions.find(item => item.id === promoId);
        title.textContent = 'แก้ไขแบนเนอร์โปรโมชั่น';
        document.getElementById('edit-promo-id').value = p.id;
        document.getElementById('modal-promo-badge').value = p.badge;
        document.getElementById('modal-promo-title').value = p.title;
        document.getElementById('modal-promo-desc').value = p.description;
        document.getElementById('modal-promo-image').value = p.image;
        document.getElementById('modal-promo-active').value = p.is_active ? '1' : '0';
    } else {
        title.textContent = 'เพิ่มแบนเนอร์โปรโมชั่น';
        document.getElementById('edit-promo-id').value = '';
        document.getElementById('modal-promo-badge').value = '';
        document.getElementById('modal-promo-title').value = '';
        document.getElementById('modal-promo-desc').value = '';
        document.getElementById('modal-promo-image').value = 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=800&q=80';
        document.getElementById('modal-promo-active').value = '1';
    }
    modal.classList.remove('hidden');
}

async function savePromotion(e) {
    e.preventDefault();
    const id = document.getElementById('edit-promo-id').value;
    const badge = document.getElementById('modal-promo-badge').value.trim();
    const title = document.getElementById('modal-promo-title').value.trim();
    const description = document.getElementById('modal-promo-desc').value.trim();
    const image = document.getElementById('modal-promo-image').value.trim();
    const is_active = document.getElementById('modal-promo-active').value === '1';

    if (id) {
        await sb.from('promotions').update({ badge, title, description, image, is_active }).eq('id', parseInt(id));
        showToast('อัปเดตแบนเนอร์โปรโมชั่นเรียบร้อยแล้ว');
    } else {
        await sb.from('promotions').insert([{ badge, title, description, image, is_active }]);
        showToast('เพิ่มแบนเนอร์โปรโมชั่นใหม่เรียบร้อยแล้ว');
    }

    closeModal('promo-modal');
    await syncFromCloud();
    renderAdminDashboard();
}

async function deletePromotion(promoId) {
    if (!confirm('ยืนยันการลบแบนเนอร์โปรโมชั่นนี้หรือไม่?')) return;
    await sb.from('promotions').delete().eq('id', promoId);
    await syncFromCloud();
    renderAdminDashboard();
    showToast('ลบแบนเนอร์โปรโมชั่นเรียบร้อยแล้ว');
}

// --- ส่วนจัดการสมาชิก (CRUD) ---
function renderAdminMembers() {
    const keyword = document.getElementById('member-search').value.toLowerCase().trim();
    const tbody = document.getElementById('admin-members-tbody');

    const members = db.users.filter(u =>
        u.role === 'member' &&
        (u.full_name.toLowerCase().includes(keyword) ||
         (u.student_id && u.student_id.toLowerCase().includes(keyword)) ||
         u.username.toLowerCase().includes(keyword))
    );

    tbody.innerHTML = members.length ? members.map(m => `
        <tr>
            <td>${m.student_id || '-'}</td>
            <td>${m.full_name}</td>
            <td>${m.username}</td>
            <td><strong>${m.points.toLocaleString()}</strong> แต้ม</td>
            <td>
                <button class="btn btn-outline-sm" onclick="openMemberModal(${m.id})">
                    <i class="fa-solid fa-pen"></i> แก้ไข
                </button>
                <button class="btn btn-danger" onclick="deleteMember(${m.id})">
                    <i class="fa-solid fa-trash"></i> ลบ
                </button>
            </td>
        </tr>
    `).join('') : '<tr><td colspan="5" style="text-align:center;">ไม่พบข้อมูลสมาชิก</td></tr>';
}

function openMemberModal(memberId = null) {
    const modal = document.getElementById('member-modal');
    const title = document.getElementById('member-modal-title');

    if (memberId) {
        const m = db.users.find(u => u.id === memberId);
        title.textContent = 'แก้ไขข้อมูลสมาชิก';
        document.getElementById('edit-member-id').value = m.id;
        document.getElementById('modal-mem-studentid').value = m.student_id || '';
        document.getElementById('modal-mem-fullname').value = m.full_name;
        document.getElementById('modal-mem-username').value = m.username;
        document.getElementById('modal-mem-password').value = m.password;
        document.getElementById('modal-mem-points').value = m.points;
    } else {
        title.textContent = 'เพิ่มสมาชิกใหม่';
        document.getElementById('edit-member-id').value = '';
        document.getElementById('modal-mem-studentid').value = '';
        document.getElementById('modal-mem-fullname').value = '';
        document.getElementById('modal-mem-username').value = '';
        document.getElementById('modal-mem-password').value = '1234';
        document.getElementById('modal-mem-points').value = 0;
    }
    modal.classList.remove('hidden');
}

async function saveMember(e) {
    e.preventDefault();
    const id = document.getElementById('edit-member-id').value;
    const studentId = document.getElementById('modal-mem-studentid').value.trim();
    const fullName = document.getElementById('modal-mem-fullname').value.trim();
    const username = document.getElementById('modal-mem-username').value.trim();
    const password = document.getElementById('modal-mem-password').value.trim();
    const points = parseInt(document.getElementById('modal-mem-points').value) || 0;

    if (id) {
        await sb.from('users').update({
            student_id: studentId,
            full_name: fullName,
            username,
            password,
            points
        }).eq('id', parseInt(id));
        showToast('แก้ไขข้อมูลสมาชิกเรียบร้อยแล้ว');
    } else {
        if (db.users.some(u => u.username === username)) {
            showToast('ชื่อผู้ใช้งานซ้ำในระบบ');
            return;
        }
        await sb.from('users').insert([{
            student_id: studentId,
            full_name: fullName,
            username,
            password,
            role: 'member',
            points
        }]);
        showToast('เพิ่มสมาชิกใหม่เรียบร้อยแล้ว');
    }

    closeModal('member-modal');
    await syncFromCloud();
    renderAdminDashboard();
}

async function deleteMember(memberId) {
    if (!confirm('ยืนยันการลบสมาชิกคนนี้หรือไม่? ประวัติที่เกี่ยวข้องจะถูกลบทั้งหมด')) return;
    await sb.from('users').delete().eq('id', memberId);
    await syncFromCloud();
    renderAdminDashboard();
    showToast('ลบข้อมูลสมาชิกเรียบร้อยแล้ว');
}

// --- ส่วนจัดการของรางวัล (CRUD) ---
function renderAdminRewards() {
    const grid = document.getElementById('admin-rewards-grid');
    grid.innerHTML = db.rewards.map(r => `
        <div class="reward-card">
            <img src="${r.image}" alt="${r.name}" class="reward-img" onerror="this.src='https://via.placeholder.com/400x200?text=Reward'">
            <div class="reward-body">
                <div>
                    <span class="reward-badge">${r.points_required} แต้ม | คงเหลือ ${r.stock} ชิ้น</span>
                    <h4 class="reward-title">${r.name}</h4>
                    <p class="reward-desc">${r.description}</p>
                </div>
                <div class="reward-footer">
                    <button class="btn btn-outline-sm" onclick="openRewardModal(${r.id})">
                        <i class="fa-solid fa-pen"></i> แก้ไข
                    </button>
                    <button class="btn btn-danger" onclick="deleteReward(${r.id})">
                        <i class="fa-solid fa-trash"></i> ลบ
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function openRewardModal(rewardId = null) {
    const modal = document.getElementById('reward-modal');
    const title = document.getElementById('reward-modal-title');

    if (rewardId) {
        const r = db.rewards.find(rw => rw.id === rewardId);
        title.textContent = 'แก้ไขรายการของรางวัล';
        document.getElementById('edit-reward-id').value = r.id;
        document.getElementById('modal-rew-name').value = r.name;
        document.getElementById('modal-rew-desc').value = r.description;
        document.getElementById('modal-rew-points').value = r.points_required;
        document.getElementById('modal-rew-stock').value = r.stock;
        document.getElementById('modal-rew-image').value = r.image;
    } else {
        title.textContent = 'เพิ่มของรางวัลใหม่';
        document.getElementById('edit-reward-id').value = '';
        document.getElementById('modal-rew-name').value = '';
        document.getElementById('modal-rew-desc').value = '';
        document.getElementById('modal-rew-points').value = 10;
        document.getElementById('modal-rew-stock').value = 10;
        document.getElementById('modal-rew-image').value = 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=500&q=80';
    }
    modal.classList.remove('hidden');
}

async function saveReward(e) {
    e.preventDefault();
    const id = document.getElementById('edit-reward-id').value;
    const name = document.getElementById('modal-rew-name').value.trim();
    const description = document.getElementById('modal-rew-desc').value.trim();
    const pointsRequired = parseInt(document.getElementById('modal-rew-points').value);
    const stock = parseInt(document.getElementById('modal-rew-stock').value);
    const image = document.getElementById('modal-rew-image').value.trim();

    if (id) {
        await sb.from('rewards').update({
            name,
            description,
            points_required: pointsRequired,
            stock,
            image
        }).eq('id', parseInt(id));
        showToast('แก้ไขข้อมูลของรางวัลเรียบร้อยแล้ว');
    } else {
        await sb.from('rewards').insert([{
            name,
            description,
            points_required: pointsRequired,
            stock,
            image
        }]);
        showToast('เพิ่มของรางวัลใหม่เรียบร้อยแล้ว');
    }

    closeModal('reward-modal');
    await syncFromCloud();
    renderAdminDashboard();
}

async function deleteReward(rewardId) {
    if (!confirm('ยืนยันการลบของรางวัลรายการนี้หรือไม่?')) return;
    await sb.from('rewards').delete().eq('id', rewardId);
    await syncFromCloud();
    renderAdminDashboard();
    showToast('ลบของรางวัลเรียบร้อยแล้ว');
}

// --- ส่วนรายงานสรุปการใช้งานระบบ & ส่งออก CSV ---
function renderAdminReports() {
    const container = document.getElementById('report-summary-content');
    const members = db.users.filter(u => u.role === 'member');
    const topMembers = [...members].sort((a, b) => b.points - a.points).slice(0, 5);

    container.innerHTML = `
        <div style="margin-top:16px;">
            <h4 style="color:var(--primary-blue); margin-bottom:10px;">5 อันดับสมาชิกที่มีแต้มสะสมสูงสุด</h4>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>อันดับ</th>
                        <th>รหัสนักศึกษา</th>
                        <th>ชื่อ-นามสกุล</th>
                        <th>แต้มสะสมปัจจุบัน</th>
                    </tr>
                </thead>
                <tbody>
                    ${topMembers.map((m, idx) => `
                        <tr>
                            <td>#${idx + 1}</td>
                            <td>${m.student_id || '-'}</td>
                            <td>${m.full_name}</td>
                            <td><strong>${m.points.toLocaleString()} แต้ม</strong></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function exportReportCSV() {
    let csv = '\uFEFFรหัสนักศึกษา,ชื่อ-นามสกุล,Username,แต้มสะสมปัจจุบัน\n';
    db.users.filter(u => u.role === 'member').forEach(m => {
        csv += `"${m.student_id || '-'}","${m.full_name}","${m.username}",${m.points}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'muk_rcheewa_members_report.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('ส่งออกไฟล์รายงาน CSV สำเร็จ');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}
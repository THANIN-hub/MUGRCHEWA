/* ==========================================================
   ระบบบริหารจัดการแต้มสมาชิกดิจิทัล ร้านมักอาชีวะ
   ไฟล์: app.js (เชื่อมต่อกับ index.html และ style.css)
   ========================================================== */

const STORAGE_KEY = 'muk_rcheewa_loyalty_db_v1';

// ข้อมูลเริ่มต้นสำหรับจำลองฐานข้อมูล (Seed Data)
const defaultDB = {
    settings: {
        baht_per_point: 20,
        welcome_bonus: 5
    },
    users: [
        {
            id: 1,
            username: 'admin',
            password: '1234',
            full_name: 'ผู้ดูแลร้านมักอาชีวะ',
            student_id: 'ADMIN-01',
            role: 'admin',
            points: 0
        },
        {
            id: 2,
            username: 'std001',
            password: '1234',
            full_name: 'นายกิตติพงษ์ รักเรียน',
            student_id: '66309010001',
            role: 'member',
            points: 25
        },
        {
            id: 3,
            username: 'std002',
            password: '1234',
            full_name: 'นางสาวกัญญาภัทร ใจดี',
            student_id: '66309010002',
            role: 'member',
            points: 12
        }
    ],
    rewards: [
        {
            id: 1,
            name: 'ส่วนลดเครื่องดื่ม 10 บาท',
            description: 'ใช้เป็นส่วนลดเครื่องดื่มทุกเมนูภายในร้านมักอาชีวะ',
            points_required: 10,
            stock: 50,
            image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=500&q=80'
        },
        {
            id: 2,
            name: 'สมุดโน้ตลายวิทยาลัยอาชีวศึกษามหาสารคาม',
            description: 'สมุดปกแข็งพิมพ์ลายพิเศษ ขนาด A5 พกพาสะดวก',
            points_required: 20,
            stock: 15,
            image: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=500&q=80'
        },
        {
            id: 3,
            name: 'แก้วน้ำเก็บความเย็นมักอาชีวะ',
            description: 'แก้วสแตนเลสเก็บอุณหภูมิ ขนาด 20 ออนซ์ พร้อมฝาปิด',
            points_required: 50,
            stock: 5,
            image: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=500&q=80'
        }
    ],
    point_history: [
        {
            id: 1,
            user_id: 2,
            amount: 100,
            points_earned: 5,
            note: 'ซื้อเครื่องดื่มและขนม',
            created_at: '2026-11-24 10:15'
        },
        {
            id: 2,
            user_id: 2,
            amount: 400,
            points_earned: 20,
            note: 'สั่งเครื่องดื่มรับรองกิจกรรมแผนก',
            created_at: '2026-11-25 14:30'
        }
    ],
    redemptions: [
        {
            id: 1,
            user_id: 2,
            reward_id: 1,
            points_spent: 10,
            status: 'approved',
            created_at: '2026-11-25 15:00'
        }
    ]
};

let db = loadDB();
let currentUser = null;

// โหลดและบันทึกข้อมูลลง LocalStorage
function loadDB() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        return JSON.parse(saved);
    }
    saveDB(defaultDB);
    return JSON.parse(JSON.stringify(defaultDB));
}

function saveDB(data = db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

function getCurrentDateTime() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
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

function quickLogin(username, password) {
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
    loginUser(username, password);
}

function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    loginUser(username, password);
}

function loginUser(username, password) {
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

function handleRegister(e) {
    e.preventDefault();
    const fullName = document.getElementById('reg-fullname').value.trim();
    const studentId = document.getElementById('reg-studentid').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();

    if (db.users.some(u => u.username === username)) {
        showToast('ชื่อผู้ใช้งาน (Username) นี้ถูกใช้งานแล้ว');
        return;
    }
    if (db.users.some(u => u.student_id === studentId)) {
        showToast('รหัสนักศึกษา/บุคลากรนี้ลงทะเบียนแล้ว');
        return;
    }

    const newUser = {
        id: Date.now(),
        username,
        password,
        full_name: fullName,
        student_id: studentId,
        role: 'member',
        points: db.settings.welcome_bonus
    };

    db.users.push(newUser);
    db.point_history.unshift({
        id: Date.now() + 1,
        user_id: newUser.id,
        amount: 0,
        points_earned: db.settings.welcome_bonus,
        note: 'โบนัสต้อนรับสมาชิกใหม่',
        created_at: getCurrentDateTime()
    });
    saveDB();

    e.target.reset();
    showToast(`สมัครสมาชิกสำเร็จ! ได้รับโบนัส ${db.settings.welcome_bonus} แต้ม`);
    loginUser(username, password);
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
function switchMemberTab(tabName, btnElement) {
    document.querySelectorAll('#member-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#member-dashboard .tab-content').forEach(c => c.classList.remove('active'));

    btnElement.classList.add('active');
    document.getElementById(`mem-tab-${tabName}`).classList.add('active');
}

function renderMemberDashboard() {
    // อัปเดตข้อมูลล่าสุดของสมาชิก
    currentUser = db.users.find(u => u.id === currentUser.id);

    document.getElementById('mem-card-name').textContent = currentUser.full_name;
    document.getElementById('mem-card-id').textContent = `รหัสนักศึกษา: ${currentUser.student_id || '-'}`;
    document.getElementById('mem-card-username').textContent = `@${currentUser.username}`;
    document.getElementById('mem-current-points').textContent = currentUser.points.toLocaleString();
    document.getElementById('mem-rate-info').textContent = `ทุกยอดซื้อ ${db.settings.baht_per_point} บาท รับ 1 แต้ม`;

    renderMemberRewards();
    renderMemberHistory();
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

function redeemReward(rewardId) {
    const reward = db.rewards.find(r => r.id === rewardId);
    if (!reward) return;

    if (reward.stock <= 0) {
        showToast('ขออภัย ของรางวัลรายการนี้หมดแล้ว');
        return;
    }
    if (currentUser.points < reward.points_required) {
        showToast('แต้มสะสมของคุณไม่เพียงพอ');
        return;
    }

    if (!confirm(`ยืนยันการใช้ ${reward.points_required} แต้ม เพื่อแลก "${reward.name}" หรือไม่?`)) {
        return;
    }

    // หักแต้มสมาชิก ลดสต็อก และบันทึกประวัติ
    currentUser.points -= reward.points_required;
    reward.stock -= 1;

    db.redemptions.unshift({
        id: Date.now(),
        user_id: currentUser.id,
        reward_id: reward.id,
        points_spent: reward.points_required,
        status: 'pending',
        created_at: getCurrentDateTime()
    });

    saveDB();
    renderMemberDashboard();
    showToast(`ส่งคำขอแลก "${reward.name}" สำเร็จ! กรุณาแสดงหน้าจอนี้ที่เคาน์เตอร์ร้าน`);
}

function renderMemberHistory() {
    // 1. ประวัติการสะสมแต้ม
    const earnTbody = document.getElementById('mem-earn-tbody');
    const myEarnings = db.point_history.filter(h => h.user_id === currentUser.id);

    earnTbody.innerHTML = myEarnings.length ? myEarnings.map(item => `
        <tr>
            <td>${item.created_at}</td>
            <td>${item.note || 'ซื้อสินค้าภายในร้าน'}</td>
            <td>${Number(item.amount).toLocaleString()} บาท</td>
            <td><strong style="color:var(--success-green);">+${item.points_earned} แต้ม</strong></td>
        </tr>
    `).join('') : '<tr><td colspan="4" style="text-align:center;">ยังไม่มีประวัติการสะสมแต้ม</td></tr>';

    // 2. ประวัติการแลกของรางวัล
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
                <td>${item.created_at}</td>
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
function switchAdminTab(tabName, btnElement) {
    document.querySelectorAll('#admin-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#admin-dashboard .tab-content').forEach(c => c.classList.remove('active'));

    btnElement.classList.add('active');
    document.getElementById(`admin-tab-${tabName}`).classList.add('active');

    if (tabName === 'reports') renderAdminReports();
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
    renderAdminMembers();
    renderAdminRewards();
    renderAdminReports();
}

// --- ส่วนบันทึกยอดซื้อและคำนวณแต้มอัตโนมัติ (POS) ---
function renderPOSMemberSelect() {
    const select = document.getElementById('pos-member-select');
    const members = db.users.filter(u => u.role === 'member');
    select.innerHTML = '<option value="">-- เลือกสมาชิก --</option>' + members.map(m =>
        `<option value="${m.id}">${m.student_id || 'ไม่มีรหัส'} - ${m.full_name} (มี ${m.points} แต้ม)</option>`
    ).join('');
}

function calculatePreviewPoints() {
    const amount = parseFloat(document.getElementById('pos-amount').value) || 0;
    const rate = parseInt(db.settings.baht_per_point) || 20;
    const earned = Math.floor(amount / rate);
    document.getElementById('pos-preview-points').textContent = `${earned} แต้ม`;
}

function handleRecordPurchase(e) {
    e.preventDefault();
    const userId = parseInt(document.getElementById('pos-member-select').value);
    const amount = parseFloat(document.getElementById('pos-amount').value);
    const note = document.getElementById('pos-note').value.trim();

    if (!userId) {
        showToast('กรุณาเลือกสมาชิกก่อนบันทึกยอดซื้อ');
        return;
    }

    const rate = parseInt(db.settings.baht_per_point) || 20;
    const pointsEarned = Math.floor(amount / rate);

    const member = db.users.find(u => u.id === userId);
    member.points += pointsEarned;

    db.point_history.unshift({
        id: Date.now(),
        user_id: userId,
        amount: amount,
        points_earned: pointsEarned,
        note: note || 'ซื้อสินค้าหน้าร้าน',
        created_at: getCurrentDateTime()
    });

    saveDB();
    e.target.reset();
    document.getElementById('pos-preview-points').textContent = '0 แต้ม';
    renderAdminDashboard();
    showToast(`บันทึกยอดซื้อ ${amount} บาท ให้คุณ ${member.full_name} (+${pointsEarned} แต้ม)`);
}

function handleUpdateRate(e) {
    e.preventDefault();
    const newRate = parseInt(document.getElementById('setting-baht-per-point').value);
    if (newRate < 1) return;

    db.settings.baht_per_point = newRate;
    saveDB();
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
                <td>${item.created_at}</td>
                <td>${user ? `${user.full_name} (${user.student_id || '-'})` : 'ไม่พบสมาชิก'}</td>
                <td>${reward ? reward.name : 'ไม่พบของรางวัล'}</td>
                <td>${item.points_spent} แต้ม</td>
                <td>${statusBadge}</td>
                <td>${actionBtns}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีรายการขอแลกของรางวัล</td></tr>';
}

function updateRedemptionStatus(redemptionId, newStatus) {
    const item = db.redemptions.find(r => r.id === redemptionId);
    if (!item || item.status !== 'pending') return;

    item.status = newStatus;

    // หากยกเลิกคำขอ ให้คืนแต้มให้สมาชิกและคืนสต็อกของรางวัล
    if (newStatus === 'rejected') {
        const user = db.users.find(u => u.id === item.user_id);
        const reward = db.rewards.find(r => r.id === item.reward_id);
        if (user) user.points += item.points_spent;
        if (reward) reward.stock += 1;
        showToast('ยกเลิกรายการและคืนแต้มให้สมาชิกเรียบร้อยแล้ว');
    } else {
        showToast('อนุมัติการแลกของรางวัลเรียบร้อยแล้ว');
    }

    saveDB();
    renderAdminDashboard();
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

function saveMember(e) {
    e.preventDefault();
    const id = document.getElementById('edit-member-id').value;
    const studentId = document.getElementById('modal-mem-studentid').value.trim();
    const fullName = document.getElementById('modal-mem-fullname').value.trim();
    const username = document.getElementById('modal-mem-username').value.trim();
    const password = document.getElementById('modal-mem-password').value.trim();
    const points = parseInt(document.getElementById('modal-mem-points').value) || 0;

    if (id) {
        const m = db.users.find(u => u.id === parseInt(id));
        m.student_id = studentId;
        m.full_name = fullName;
        m.username = username;
        m.password = password;
        m.points = points;
        showToast('แก้ไขข้อมูลสมาชิกเรียบร้อยแล้ว');
    } else {
        if (db.users.some(u => u.username === username)) {
            showToast('ชื่อผู้ใช้งานซ้ำในระบบ');
            return;
        }
        db.users.push({
            id: Date.now(),
            student_id: studentId,
            full_name: fullName,
            username,
            password,
            role: 'member',
            points
        });
        showToast('เพิ่มสมาชิกใหม่เรียบร้อยแล้ว');
    }

    saveDB();
    closeModal('member-modal');
    renderAdminDashboard();
}

function deleteMember(memberId) {
    if (!confirm('ยืนยันการลบสมาชิกคนนี้หรือไม่? ประวัติที่เกี่ยวข้องจะถูกลบทั้งหมด')) return;
    db.users = db.users.filter(u => u.id !== memberId);
    db.point_history = db.point_history.filter(h => h.user_id !== memberId);
    db.redemptions = db.redemptions.filter(r => r.user_id !== memberId);
    saveDB();
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

function saveReward(e) {
    e.preventDefault();
    const id = document.getElementById('edit-reward-id').value;
    const name = document.getElementById('modal-rew-name').value.trim();
    const description = document.getElementById('modal-rew-desc').value.trim();
    const pointsRequired = parseInt(document.getElementById('modal-rew-points').value);
    const stock = parseInt(document.getElementById('modal-rew-stock').value);
    const image = document.getElementById('modal-rew-image').value.trim();

    if (id) {
        const r = db.rewards.find(rw => rw.id === parseInt(id));
        r.name = name;
        r.description = description;
        r.points_required = pointsRequired;
        r.stock = stock;
        r.image = image;
        showToast('แก้ไขข้อมูลของรางวัลเรียบร้อยแล้ว');
    } else {
        db.rewards.push({
            id: Date.now(),
            name,
            description,
            points_required: pointsRequired,
            stock,
            image
        });
        showToast('เพิ่มของรางวัลใหม่เรียบร้อยแล้ว');
    }

    saveDB();
    closeModal('reward-modal');
    renderAdminDashboard();
}

function deleteReward(rewardId) {
    if (!confirm('ยืนยันการลบของรางวัลรายการนี้หรือไม่?')) return;
    db.rewards = db.rewards.filter(r => r.id !== rewardId);
    saveDB();
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

/* ==========================================================
   ระบบบริหารจัดการแต้มสมาชิกดิจิทัล ร้านมักอาชีวะ
   ไฟล์: app.js (เชื่อมต่อฐานข้อมูลกลาง Supabase + Barcode + POS + Tier + Check-in Calendar + Custom Lucky Spin + Audit Log)
   ========================================================== */

const SUPABASE_URL = 'https://ziaekbkkadjpmgmhqlyk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppYWVrYmtrYWRqcG1nbWhxbHlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3NjA3MDcsImV4cCI6MjExMTMzNjcwN30.l7l0Y_HDeQR25f1KOer1RXGLTldIAiWEq3zFQptk1_c';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const SESSION_KEY = 'muk_rcheewa_user_id';

const DEFAULT_SPIN_CONFIG = {
    enabled: true,
    cost: 3,
    prizes: [1, 3, 5, 2, 10, 15],
    weights: [30, 28, 18, 15, 7, 2]
};

let db = {
    settings: {
        baht_per_point: 20,
        welcome_bonus: 5,
        spin_config: { ...DEFAULT_SPIN_CONFIG }
    },
    users: [],
    rewards: [],
    point_history: [],
    redemptions: [],
    promotions: []
};

let currentUser = null;
let rewardFilterMode = 'all';
let reportPeriod = 'today';
let isSpinning = false;
let currentWheelRotation = 0;
let calViewYear = new Date().getFullYear();
let calViewMonth = new Date().getMonth();

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
                if (s.setting_key === 'lucky_spin_config') {
                    try {
                        const parsed = JSON.parse(s.setting_value);
                        db.settings.spin_config = {
                            enabled: parsed.enabled !== false,
                            cost: Number(parsed.cost) >= 0 ? Number(parsed.cost) : 3,
                            prizes: Array.isArray(parsed.prizes) && parsed.prizes.length === 6 ? parsed.prizes.map(Number) : [...DEFAULT_SPIN_CONFIG.prizes],
                            weights: Array.isArray(parsed.weights) && parsed.weights.length === 6 ? parsed.weights.map(Number) : [...DEFAULT_SPIN_CONFIG.weights]
                        };
                    } catch (e) {}
                } else if (!s.setting_key.startsWith('reset_req_')) {
                    db.settings[s.setting_key] = parseInt(s.setting_value);
                }
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

function formatTicketCode(id) {
    return `#${String(id).padStart(4, '0')}`;
}

function getLocalDateKey(isoString) {
    const d = isoString ? new Date(isoString) : new Date();
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// คำนวณระดับสมาชิก (Member Tier) จากยอดแต้มสะสมรวม
function getMemberTierInfo(userId, currentPoints = 0) {
    const earnedSum = db.point_history
        .filter(h => h.user_id === userId && Number(h.points_earned) > 0)
        .reduce((sum, h) => sum + Number(h.points_earned), 0);

    const lifetimePoints = Math.max(earnedSum, Number(currentPoints) || 0);

    if (lifetimePoints >= 150) {
        return {
            name: 'GOLD',
            label: 'ระดับ GOLD',
            cssClass: 'tier-gold',
            icon: 'fa-crown',
            lifetimePoints,
            nextText: `ระดับสูงสุดแล้ว (สะสมรวม ${lifetimePoints} แต้ม)`
        };
    } else if (lifetimePoints >= 50) {
        const diff = 150 - lifetimePoints;
        return {
            name: 'SILVER',
            label: 'ระดับ SILVER',
            cssClass: 'tier-silver',
            icon: 'fa-award',
            lifetimePoints,
            nextText: `อีก ${diff} แต้ม ขึ้นระดับ GOLD`
        };
    } else {
        const diff = 50 - lifetimePoints;
        return {
            name: 'MEMBER',
            label: 'ระดับ MEMBER',
            cssClass: 'tier-member',
            icon: 'fa-medal',
            lifetimePoints,
            nextText: `อีก ${diff} แต้ม ขึ้นระดับ SILVER`
        };
    }
}

// ==========================================================
// ระบบยืนยันตัวตน (Authentication, Auto-Login & Forgot Password)
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

function openForgotModal() {
    const loginVal = document.getElementById('login-username').value.replace(/\D/g, '');
    document.getElementById('forgot-phone').value = loginVal;
    document.getElementById('forgot-fullname').value = '';
    document.getElementById('forgot-new-password').value = '';
    document.getElementById('forgot-confirm-password').value = '';
    document.getElementById('forgot-modal').classList.remove('hidden');
}

async function handleForgotPassword(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-forgot-submit');
    const phone = document.getElementById('forgot-phone').value.replace(/\D/g, '');
    const fullName = document.getElementById('forgot-fullname').value.trim().replace(/\s+/g, ' ');
    const newPass = document.getElementById('forgot-new-password').value.trim();
    const confirmPass = document.getElementById('forgot-confirm-password').value.trim();

    if (phone.length < 9 || phone.length > 10) {
        showToast('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)');
        return;
    }

    if (!newPass) {
        showToast('กรุณากรอกรหัสผ่านใหม่');
        return;
    }

    if (newPass !== confirmPass) {
        showToast('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'กำลังตรวจสอบข้อมูล...';

    await syncFromCloud();

    const member = db.users.find(u =>
        u.role === 'member' &&
        u.student_id &&
        u.student_id.replace(/\D/g, '') === phone &&
        u.full_name &&
        u.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === fullName.toLowerCase()
    );

    if (!member) {
        showToast('เบอร์โทรศัพท์หรือชื่อ-นามสกุลไม่ตรงกับข้อมูลสมาชิกในระบบ');
        btn.disabled = false;
        btn.textContent = 'เปลี่ยนรหัสผ่านทันที';
        return;
    }

    const { error } = await sb.from('users').update({
        password: newPass
    }).eq('id', member.id);

    btn.disabled = false;
    btn.textContent = 'เปลี่ยนรหัสผ่านทันที';

    if (error) {
        showToast('เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน กรุณาลองใหม่อีกครั้ง');
        return;
    }

    closeModal('forgot-modal');
    document.getElementById('login-username').value = phone;
    document.getElementById('login-password').value = newPass;
    showToast('เปลี่ยนรหัสผ่านสำเร็จ! กดเข้าสู่ระบบด้วยรหัสผ่านใหม่ได้ทันที');
}

function applyLoggedInUI(user, rememberMe = null) {
    currentUser = user;
    sessionStorage.setItem(SESSION_KEY, String(user.id));

    if (rememberMe === true) {
        localStorage.setItem(SESSION_KEY, String(user.id));
    } else if (rememberMe === false) {
        localStorage.removeItem(SESSION_KEY);
    }

    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('nav-user-name').textContent = user.full_name;

    if (user.role === 'admin') {
        document.getElementById('nav-user-role').textContent = 'ผู้ดูแลร้าน';
        document.getElementById('member-dashboard').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        renderAdminDashboard();
        focusPOSBarcodeInput();
    } else {
        document.getElementById('nav-user-role').textContent = 'สมาชิก';
        document.getElementById('admin-dashboard').classList.add('hidden');
        document.getElementById('member-dashboard').classList.remove('hidden');
        renderMemberDashboard();
    }
}

async function restoreSession() {
    const savedUserId = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!savedUserId) return;

    const ok = await syncFromCloud();
    if (!ok) return;

    const user = db.users.find(u => String(u.id) === String(savedUserId));
    if (user) {
        applyLoggedInUI(user);
    } else {
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_KEY);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-login-submit');
    const rawInput = document.getElementById('login-username').value.trim();
    const cleanPhone = rawInput.replace(/\D/g, '');
    const password = document.getElementById('login-password').value.trim();

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเข้าสู่ระบบ...';

    await syncFromCloud();

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ';

    const user = db.users.find(u => {
        if (u.password !== password) return false;
        if (u.role === 'admin') {
            return u.username.toLowerCase() === rawInput.toLowerCase();
        }
        const dbPhone = (u.student_id || '').replace(/\D/g, '');
        return cleanPhone !== '' && dbPhone === cleanPhone;
    });

    if (!user) {
        showToast('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง');
        return;
    }

    const isRemember = document.getElementById('login-remember')?.checked ?? true;
    applyLoggedInUI(user, isRemember);
    showToast(`ยินดีต้อนรับคุณ ${user.full_name}`);
}

async function handleRegister(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-reg-submit');
    const fullName = document.getElementById('reg-fullname').value.trim().replace(/\s+/g, ' ');
    const phone = document.getElementById('reg-studentid').value.replace(/\D/g, '');
    const username = fullName;
    const password = document.getElementById('reg-password').value.trim();

    if (phone.length < 9 || phone.length > 10) {
        showToast('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบข้อมูล...';

    await syncFromCloud();

    const isNameDuplicate = db.users.some(u =>
        (u.username && u.username.trim().replace(/\s+/g, ' ').toLowerCase() === username.toLowerCase()) ||
        (u.full_name && u.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === fullName.toLowerCase())
    );

    if (isNameDuplicate) {
        showToast('ไม่สามารถสมัครได้: ชื่อ-นามสกุลนี้มีผู้ใช้งานในระบบแล้ว');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
        return;
    }

    const isPhoneDuplicate = db.users.some(u =>
        u.student_id && u.student_id.replace(/\D/g, '') === phone
    );

    if (isPhoneDuplicate) {
        showToast('ไม่สามารถสมัครได้: เบอร์โทรศัพท์นี้ลงทะเบียนในระบบแล้ว');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
        return;
    }

    const bonus = db.settings.welcome_bonus || 5;

    const { data: insertedUser, error } = await sb.from('users').insert([{
        username,
        password,
        full_name: fullName,
        student_id: phone,
        role: 'member',
        points: bonus
    }]).select().single();

    if (error) {
        showToast('ไม่สามารถสมัครสมาชิกได้: ชื่อหรือเบอร์โทรอาจซ้ำในระบบ');
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

    document.getElementById('login-username').value = phone;
    document.getElementById('login-password').value = password;
    await handleLogin(new Event('submit'));
}

function handleLogout() {
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('login-form').reset();
    showToast('ออกจากระบบเรียบร้อยแล้ว');
}

// ==========================================================
// 1. ระบบสมาชิก (Member Functions: Barcode, Tier, Check-in Calendar, Lucky Spin)
// ==========================================================
function generateMemberBarcode(codeText) {
    const svgEl = document.getElementById('member-barcode');
    if (!svgEl || typeof JsBarcode === 'undefined') return;
    JsBarcode(svgEl, String(codeText), {
        format: "CODE128",
        lineColor: "#0F172A",
        background: "#FFFFFF",
        width: 2,
        height: 46,
        displayValue: true,
        fontSize: 13,
        font: "Prompt",
        margin: 4
    });
}

function openMemberBarcodeModal() {
    if (!currentUser) return;
    const codeText = currentUser.student_id || currentUser.username;
    const svgLarge = document.getElementById('member-barcode-large');
    if (svgLarge && typeof JsBarcode !== 'undefined') {
        JsBarcode(svgLarge, String(codeText), {
            format: "CODE128",
            lineColor: "#0F172A",
            background: "#FFFFFF",
            width: 2.6,
            height: 85,
            displayValue: true,
            fontSize: 16,
            font: "Prompt",
            margin: 6
        });
    }
    document.getElementById('barcode-modal-name').textContent = currentUser.full_name;
    document.getElementById('barcode-modal-phone').textContent = currentUser.student_id || '-';
    document.getElementById('barcode-modal').classList.remove('hidden');
}

// เช็กอินรายวันรับแต้มฟรี (+1 แต้ม) & ปฏิทินการเช็กอิน
function getMemberCheckinDatesSet() {
    const set = new Set();
    if (!currentUser) return set;
    db.point_history.forEach(h => {
        if (h.user_id === currentUser.id && h.note === 'เช็กอินรายวันรับแต้มฟรี') {
            const key = getLocalDateKey(h.created_at);
            if (key) set.add(key);
        }
    });
    return set;
}

function hasCheckedInToday() {
    if (!currentUser) return false;
    const todayKey = getLocalDateKey();
    return getMemberCheckinDatesSet().has(todayKey);
}

function updateCheckinButtonUI() {
    const btn = document.getElementById('btn-daily-checkin');
    if (!btn) return;
    if (hasCheckedInToday()) {
        btn.disabled = true;
        btn.classList.add('checked');
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> เช็กอินวันนี้แล้ว';
    } else {
        btn.disabled = false;
        btn.classList.remove('checked');
        btn.innerHTML = '<i class="fa-solid fa-calendar-check"></i> เช็กอิน (+1 แต้ม)';
    }
}

async function handleDailyCheckin() {
    if (!currentUser) return;
    const btn = document.getElementById('btn-daily-checkin');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเช็กอิน...';

    await syncFromCloud();
    if (hasCheckedInToday()) {
        updateCheckinButtonUI();
        showToast('วันนี้คุณเช็กอินรับแต้มไปแล้ว พรุ่งนี้มาใหม่นะครับ!');
        return;
    }

    const latestUser = db.users.find(u => u.id === currentUser.id);
    const newPoints = (latestUser ? latestUser.points : currentUser.points) + 1;

    await Promise.all([
        sb.from('users').update({ points: newPoints }).eq('id', currentUser.id),
        sb.from('point_history').insert([{
            user_id: currentUser.id,
            amount: 0,
            points_earned: 1,
            note: 'เช็กอินรายวันรับแต้มฟรี'
        }])
    ]);

    await syncFromCloud();
    renderMemberDashboard();
    showToast('เช็กอินสำเร็จ! รับฟรี +1 แต้ม');
}

function openCheckinCalendarModal() {
    const now = new Date();
    calViewYear = now.getFullYear();
    calViewMonth = now.getMonth();
    renderCheckinCalendar();
    document.getElementById('checkin-calendar-modal').classList.remove('hidden');
}

function changeCalendarMonth(delta) {
    calViewMonth += delta;
    if (calViewMonth < 0) {
        calViewMonth = 11;
        calViewYear -= 1;
    } else if (calViewMonth > 11) {
        calViewMonth = 0;
        calViewYear += 1;
    }
    renderCheckinCalendar();
}

function renderCheckinCalendar() {
    const monthNames = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiYear = calViewYear + 543;
    document.getElementById('cal-month-title').textContent = `${monthNames[calViewMonth]} ${thaiYear}`;

    const checkedSet = getMemberCheckinDatesSet();
    const todayKey = getLocalDateKey();

    const firstDayOfWeek = new Date(calViewYear, calViewMonth, 1).getDay();
    const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

    const grid = document.getElementById('cal-days-grid');
    let html = '';
    let checkedThisMonth = 0;

    for (let i = 0; i < firstDayOfWeek; i++) {
        html += `<div class="cal-cell empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isChecked = checkedSet.has(dateKey);
        const isToday = dateKey === todayKey;

        if (isChecked) checkedThisMonth++;

        const classes = ['cal-cell'];
        if (isChecked) classes.push('checked');
        if (isToday) classes.push('today');

        html += `
            <div class="${classes.join(' ')}">
                <span>${day}</span>
                ${isChecked ? '<i class="fa-solid fa-check"></i>' : ''}
            </div>
        `;
    }

    grid.innerHTML = html;
    document.getElementById('cal-month-summary').textContent = `เช็กอินเดือนนี้ ${checkedThisMonth} วัน`;
}

// วงล้อสุ่มแต้มลุ้นโชค (Lucky Spin - ใช้ค่าจากแอดมิน)
function syncWheelLabelsUI() {
    const cfg = db.settings.spin_config || DEFAULT_SPIN_CONFIG;
    for (let i = 0; i < 6; i++) {
        const lbl = document.getElementById(`wheel-lbl-${i}`);
        if (lbl) {
            const val = Number(cfg.prizes[i]) || 0;
            lbl.textContent = val > 0 ? `+${val} แต้ม` : 'ไม่ได้แต้ม';
        }
    }

    const openBtn = document.getElementById('btn-open-lucky-spin');
    if (openBtn) {
        openBtn.style.display = cfg.enabled ? 'inline-flex' : 'none';
    }

    const descEl = document.getElementById('spin-desc-text');
    if (descEl) {
        const maxPrize = Math.max(...cfg.prizes.map(Number));
        descEl.innerHTML = cfg.cost > 0
            ? `ใช้ <strong>${cfg.cost} แต้ม</strong> ต่อการหมุน 1 ครั้ง ลุ้นรับสูงสุด <strong>${maxPrize} แต้ม!</strong>`
            : `หมุนวงล้อ<strong>ฟรี!</strong> ลุ้นรับโบนัสสูงสุด <strong>${maxPrize} แต้ม!</strong>`;
    }

    const spinNowBtn = document.getElementById('btn-spin-now');
    if (spinNowBtn && !isSpinning) {
        spinNowBtn.innerHTML = cfg.cost > 0
            ? `<i class="fa-solid fa-play"></i> หมุนวงล้อเลย! (ใช้ ${cfg.cost} แต้ม)`
            : `<i class="fa-solid fa-play"></i> หมุนวงล้อฟรีเลย!`;
    }
}

function openLuckySpinModal() {
    if (!currentUser) return;
    syncWheelLabelsUI();
    document.getElementById('spin-user-points').textContent = currentUser.points.toLocaleString();
    document.getElementById('spin-result-box').textContent = '';
    document.getElementById('spin-modal').classList.remove('hidden');
}

async function handleSpinWheel() {
    if (!currentUser || isSpinning) return;

    await syncFromCloud();
    const cfg = db.settings.spin_config || DEFAULT_SPIN_CONFIG;
    if (!cfg.enabled) {
        showToast('วงล้อลุ้นแต้มปิดให้บริการชั่วคราว');
        closeModal('spin-modal');
        return;
    }

    const spinCost = Number(cfg.cost) || 0;
    const latestUser = db.users.find(u => u.id === currentUser.id);
    if (!latestUser || latestUser.points < spinCost) {
        showToast(`แต้มไม่พอหมุนวงล้อ (ต้องใช้ ${spinCost} แต้ม)`);
        return;
    }

    isSpinning = true;
    const btn = document.getElementById('btn-spin-now');
    const resultBox = document.getElementById('spin-result-box');
    const wheel = document.getElementById('lucky-wheel');

    btn.disabled = true;
    resultBox.textContent = 'กำลังหมุนลุ้นรางวัล...';

    const prizes = cfg.prizes.map(Number);
    const weights = cfg.weights.map(w => Math.max(1, Number(w) || 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalWeight;
    let chosenIdx = 0;
    for (let i = 0; i < weights.length; i++) {
        if (rand < weights[i]) {
            chosenIdx = i;
            break;
        }
        rand -= weights[i];
    }

    const wonPoints = prizes[chosenIdx];
    const sliceCenterAngle = chosenIdx * 60 + 30;
    const targetMod = (360 - sliceCenterAngle) % 360;
    const currentMod = ((currentWheelRotation % 360) + 360) % 360;
    const delta = (targetMod - currentMod + 360) % 360;

    currentWheelRotation += 1800 + delta;
    wheel.style.transform = `rotate(${currentWheelRotation}deg)`;

    const netPoints = latestUser.points - spinCost + wonPoints;

    setTimeout(async () => {
        await Promise.all([
            sb.from('users').update({ points: netPoints }).eq('id', latestUser.id),
            sb.from('point_history').insert([{
                user_id: latestUser.id,
                amount: 0,
                points_earned: wonPoints - spinCost,
                note: `หมุนวงล้อลุ้นโชค (ใช้ ${spinCost} แต้ม, ได้รับ +${wonPoints} แต้ม)`
            }])
        ]);

        await syncFromCloud();
        renderMemberDashboard();

        document.getElementById('spin-user-points').textContent = netPoints.toLocaleString();
        if (wonPoints > 0) {
            resultBox.style.color = 'var(--success-green)';
            resultBox.innerHTML = `<i class="fa-solid fa-sparkles"></i> ยินดีด้วย! คุณได้รับ +${wonPoints} แต้ม!`;
            showToast(`หมุนวงล้อได้ +${wonPoints} แต้ม!`);
        } else {
            resultBox.style.color = 'var(--danger-red)';
            resultBox.innerHTML = `เสียดายจัง รอบนี้ไม่ได้รับแต้ม ลองใหม่อีกครั้งนะ!`;
            showToast('รอบนี้ไม่ได้รับแต้ม ลองใหม่อีกครั้งนะครับ');
        }

        isSpinning = false;
        btn.disabled = false;
        syncWheelLabelsUI();
    }, 3600);
}

function openTicketModal(redemptionId) {
    const item = db.redemptions.find(r => r.id === redemptionId);
    if (!item) return;

    const reward = db.rewards.find(rw => rw.id === item.reward_id);
    const code = formatTicketCode(item.id);

    const imgEl = document.getElementById('ticket-reward-img');
    if (imgEl) {
        imgEl.src = (reward && reward.image) ? reward.image : 'https://via.placeholder.com/400x200?text=Reward';
    }

    document.getElementById('ticket-reward-name').textContent = reward ? `แลก "${reward.name}"` : 'แลกของรางวัล';
    document.getElementById('ticket-points-spent').textContent = `ใช้แต้มสะสมไป ${item.points_spent} แต้ม`;
    document.getElementById('ticket-code').textContent = `รหัสอ้างอิง: ${code}`;
    document.getElementById('ticket-member-info').textContent = `ผู้แลก: ${currentUser.full_name} (${currentUser.student_id || '-'})`;
    document.getElementById('ticket-date').textContent = `วัน-เวลาที่แลก: ${formatDateTime(item.created_at)}`;

    document.getElementById('ticket-modal').classList.remove('hidden');
}

function openProfileModal() {
    if (!currentUser) return;
    document.getElementById('prof-fullname').value = currentUser.full_name || '';
    document.getElementById('prof-phone').value = currentUser.student_id || '';
    document.getElementById('prof-old-password').value = '';
    document.getElementById('prof-new-password').value = '';
    document.getElementById('prof-confirm-password').value = '';
    document.getElementById('profile-modal').classList.remove('hidden');
}

async function saveMemberProfile(e) {
    e.preventDefault();
    if (!currentUser) return;

    const btn = document.getElementById('btn-save-profile');
    const fullName = document.getElementById('prof-fullname').value.trim().replace(/\s+/g, ' ');
    const phone = document.getElementById('prof-phone').value.replace(/\D/g, '');
    const oldPass = document.getElementById('prof-old-password').value.trim();
    const newPass = document.getElementById('prof-new-password').value.trim();
    const confirmPass = document.getElementById('prof-confirm-password').value.trim();

    if (!fullName) {
        showToast('กรุณากรอกชื่อ-นามสกุล');
        return;
    }

    if (phone.length < 9 || phone.length > 10) {
        showToast('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)');
        return;
    }

    let updatedPassword = currentUser.password;

    if (oldPass || newPass || confirmPass) {
        if (!oldPass) {
            showToast('กรุณากรอกรหัสผ่านเดิมเพื่อยืนยัน');
            return;
        }
        if (oldPass !== currentUser.password) {
            showToast('รหัสผ่านเดิมไม่ถูกต้อง');
            return;
        }
        if (!newPass) {
            showToast('กรุณากรอกรหัสผ่านใหม่');
            return;
        }
        if (newPass !== confirmPass) {
            showToast('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');
            return;
        }
        updatedPassword = newPass;
    }

    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';

    await syncFromCloud();

    const isNameDuplicate = db.users.some(u =>
        u.id !== currentUser.id &&
        ((u.username && u.username.trim().replace(/\s+/g, ' ').toLowerCase() === fullName.toLowerCase()) ||
         (u.full_name && u.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === fullName.toLowerCase()))
    );

    if (isNameDuplicate) {
        showToast('ไม่สามารถบันทึกได้: ชื่อ-นามสกุลนี้มีผู้ใช้งานแล้ว');
        btn.disabled = false;
        btn.textContent = 'บันทึกการเปลี่ยนแปลง';
        return;
    }

    const isPhoneDuplicate = db.users.some(u =>
        u.id !== currentUser.id &&
        (u.student_id && u.student_id.replace(/\D/g, '') === phone)
    );

    if (isPhoneDuplicate) {
        showToast('ไม่สามารถบันทึกได้: เบอร์โทรศัพท์นี้ลงทะเบียนในระบบแล้ว');
        btn.disabled = false;
        btn.textContent = 'บันทึกการเปลี่ยนแปลง';
        return;
    }

    const { error } = await sb.from('users').update({
        full_name: fullName,
        username: fullName,
        student_id: phone,
        password: updatedPassword
    }).eq('id', currentUser.id);

    btn.disabled = false;
    btn.textContent = 'บันทึกการเปลี่ยนแปลง';

    if (error) {
        showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        return;
    }

    await syncFromCloud();
    const updatedUser = db.users.find(u => u.id === currentUser.id);
    if (updatedUser) {
        currentUser = updatedUser;
        document.getElementById('nav-user-name').textContent = updatedUser.full_name;
    }

    closeModal('profile-modal');
    renderMemberDashboard();
    showToast('บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว');
}

async function switchMemberTab(tabName, btnElement) {
    document.querySelectorAll('#member-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#member-dashboard .tab-content').forEach(c => c.classList.remove('active'));

    btnElement.classList.add('active');
    document.getElementById(`mem-tab-${tabName}`).classList.add('active');

    await syncFromCloud();
    renderMemberDashboard();
}

function renderMemberPointsGoal() {
    const goalText = document.getElementById('mem-goal-text');
    const goalPercent = document.getElementById('mem-goal-percent');
    const goalBar = document.getElementById('mem-goal-bar');
    if (!goalText || !goalPercent || !goalBar) return;

    const availableRewards = db.rewards.filter(r => r.stock > 0).sort((a, b) => a.points_required - b.points_required);
    if (!availableRewards.length) {
        goalText.textContent = 'สะสมแต้มต่อเนื่องเพื่อแลกของรางวัลพิเศษ';
        goalPercent.textContent = '100%';
        goalBar.style.width = '100%';
        return;
    }

    const nextTarget = availableRewards.find(r => r.points_required > currentUser.points);
    if (nextTarget) {
        const diff = nextTarget.points_required - currentUser.points;
        const pct = Math.min(100, Math.round((currentUser.points / nextTarget.points_required) * 100));
        goalText.textContent = `อีก ${diff} แต้ม แลก "${nextTarget.name}"`;
        goalPercent.textContent = `${pct}%`;
        goalBar.style.width = `${pct}%`;
    } else {
        const maxReward = availableRewards[availableRewards.length - 1];
        goalText.textContent = `แต้มของคุณแลกได้ทุกรายการ (สูงสุด: ${maxReward.name})`;
        goalPercent.textContent = '100%';
        goalBar.style.width = '100%';
    }
}

function renderMemberDashboard() {
    const latestUser = db.users.find(u => u.id === currentUser.id);
    if (latestUser) currentUser = latestUser;

    document.getElementById('mem-card-name').textContent = currentUser.full_name;
    document.getElementById('mem-card-id').textContent = `เบอร์โทรศัพท์: ${currentUser.student_id || '-'}`;
    document.getElementById('mem-current-points').textContent = currentUser.points.toLocaleString();
    document.getElementById('mem-rate-info').textContent = `ทุกยอดซื้อ ${db.settings.baht_per_point} บาท รับ 1 แต้ม`;

    const tier = getMemberTierInfo(currentUser.id, currentUser.points);
    const tierBadge = document.getElementById('mem-tier-badge');
    const tierNext = document.getElementById('mem-tier-next-text');
    if (tierBadge) {
        tierBadge.className = `tier-badge ${tier.cssClass}`;
        tierBadge.innerHTML = `<i class="fa-solid ${tier.icon}"></i> ${tier.label}`;
    }
    if (tierNext) {
        tierNext.textContent = tier.nextText;
    }

    updateCheckinButtonUI();
    syncWheelLabelsUI();
    generateMemberBarcode(currentUser.student_id || currentUser.username);
    renderMemberPointsGoal();
    renderMemberPromotions();
    renderMemberRewards();
    renderMemberHistory();
}

let promoSlideIndex = 0;
let promoSlideTimer = null;

function renderMemberPromotions() {
    const container = document.getElementById('member-promo-section');
    if (!container) return;
    const activePromos = (db.promotions || []).filter(p => p.is_active);

    if (promoSlideTimer) clearInterval(promoSlideTimer);

    if (!activePromos.length) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    promoSlideIndex = 0;

    const slidesHTML = activePromos.map(p => `
        <div class="promo-banner-card">
            <img src="${p.image}" alt="${p.title}" onerror="this.src='https://via.placeholder.com/800x250?text=Promotion'">
            <div class="promo-overlay">
                <span class="promo-tag"><i class="fa-solid fa-fire"></i> ${p.badge}</span>
                <h4>${p.title}</h4>
                <p>${p.description}</p>
            </div>
        </div>
    `).join('');

    const controlsHTML = activePromos.length > 1 ? `
        <button class="promo-nav-btn promo-prev" onclick="movePromoSlide(-1)" title="ก่อนหน้า">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button class="promo-nav-btn promo-next" onclick="movePromoSlide(1)" title="ถัดไป">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
        <div class="promo-dots">
            ${activePromos.map((_, idx) => `
                <button class="promo-dot ${idx === 0 ? 'active' : ''}" onclick="goToPromoSlide(${idx})"></button>
            `).join('')}
        </div>
    ` : '';

    container.innerHTML = `
        <div class="promo-track" id="promo-track">${slidesHTML}</div>
        ${controlsHTML}
    `;

    if (activePromos.length > 1) {
        promoSlideTimer = setInterval(() => {
            movePromoSlide(1);
        }, 4000);
    }
}

function movePromoSlide(step) {
    const track = document.getElementById('promo-track');
    if (!track) return;
    const total = track.children.length;
    if (total <= 1) return;

    promoSlideIndex = (promoSlideIndex + step + total) % total;
    updatePromoSlideUI();
}

function goToPromoSlide(index) {
    promoSlideIndex = index;
    updatePromoSlideUI();
}

function updatePromoSlideUI() {
    const track = document.getElementById('promo-track');
    if (!track) return;
    track.style.transform = `translateX(-${promoSlideIndex * 100}%)`;

    document.querySelectorAll('.promo-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx === promoSlideIndex);
    });
}

function setRewardFilter(mode) {
    rewardFilterMode = mode;
    const btnAll = document.getElementById('filter-rew-all');
    const btnCan = document.getElementById('filter-rew-can');
    if (btnAll && btnCan) {
        btnAll.className = mode === 'all' ? 'btn btn-primary' : 'btn btn-outline';
        btnCan.className = mode === 'can_redeem' ? 'btn btn-primary' : 'btn btn-outline';
    }
    renderMemberRewards();
}

function renderMemberRewards() {
    const grid = document.getElementById('member-rewards-grid');
    grid.innerHTML = '';

    const filteredRewards = rewardFilterMode === 'can_redeem'
        ? db.rewards.filter(r => currentUser.points >= r.points_required && r.stock > 0)
        : db.rewards;

    if (!filteredRewards.length) {
        grid.innerHTML = `<div class="card-box" style="grid-column: 1 / -1; text-align: center; color: var(--text-muted);">ยังไม่มีรายการของรางวัลที่แลกได้ในขณะนี้ ลองสะสมแต้มเพิ่มอีกนิดนะครับ!</div>`;
        return;
    }

    filteredRewards.forEach(reward => {
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

    const [, , insertRes] = await Promise.all([
        sb.from('users').update({ points: newPoints }).eq('id', latestUser.id),
        sb.from('rewards').update({ stock: newStock }).eq('id', reward.id),
        sb.from('redemptions').insert([{
            user_id: latestUser.id,
            reward_id: reward.id,
            points_spent: reward.points_required,
            status: 'approved'
        }]).select().single()
    ]);

    await syncFromCloud();
    renderMemberDashboard();
    showToast(`แลก "${reward.name}" สำเร็จ! บันทึกประวัติเรียบร้อยแล้ว`);

    if (insertRes && insertRes.data) {
        openTicketModal(insertRes.data.id);
    }
}

function renderMemberHistory() {
    const earnTbody = document.getElementById('mem-earn-tbody');
    const myEarnings = db.point_history.filter(h => h.user_id === currentUser.id);

    earnTbody.innerHTML = myEarnings.length ? myEarnings.map(item => {
        const pts = Number(item.points_earned);
        const ptsDisplay = pts >= 0
            ? `<strong style="color:var(--success-green);">+${pts} แต้ม</strong>`
            : `<strong style="color:var(--danger-red);">${pts} แต้ม</strong>`;
        return `
            <tr>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${item.note || 'ซื้อสินค้าภายในร้าน'}</td>
                <td>${Number(item.amount).toLocaleString()} บาท</td>
                <td>${ptsDisplay}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="4" style="text-align:center;">ยังไม่มีประวัติการสะสมแต้ม</td></tr>';

    const redeemTbody = document.getElementById('mem-redeem-tbody');
    const myRedemptions = db.redemptions.filter(r => r.user_id === currentUser.id);

    redeemTbody.innerHTML = myRedemptions.length ? myRedemptions.map(item => {
        const reward = db.rewards.find(rw => rw.id === item.reward_id);
        const statusMap = {
            pending: '<span class="status-pill status-approved">แลกสำเร็จแล้ว</span>',
            approved: '<span class="status-pill status-approved">แลกสำเร็จแล้ว</span>',
            rejected: '<span class="status-pill status-rejected">ยกเลิก (คืนแต้มแล้ว)</span>'
        };

        return `
            <tr>
                <td><strong>${formatTicketCode(item.id)}</strong></td>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${reward ? reward.name : 'ของรางวัลที่ถูกลบ'}</td>
                <td>-${item.points_spent} แต้ม</td>
                <td>${statusMap[item.status] || statusMap.approved}</td>
                <td>
                    <button class="btn btn-outline-sm" onclick="openTicketModal(${item.id})">
                        <i class="fa-solid fa-image"></i> ดูหลักฐาน
                    </button>
                </td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีประวัติการแลกของรางวัล</td></tr>';
}

// ==========================================================
// 2. ระบบผู้ดูแลร้าน (Admin Functions & Barcode POS Scanner)
// ==========================================================
function focusPOSBarcodeInput() {
    setTimeout(() => {
        const searchInput = document.getElementById('pos-member-search');
        if (searchInput) searchInput.focus();
    }, 100);
}

function clearPOSMember() {
    const searchInput = document.getElementById('pos-member-search');
    const hiddenId = document.getElementById('pos-selected-user-id');
    const statusBox = document.getElementById('pos-member-status');

    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    if (hiddenId) hiddenId.value = '';
    if (statusBox) statusBox.innerHTML = '';
}

function handlePOSBarcodeKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        handlePOSMemberSearch(true);
    }
}

async function switchAdminTab(tabName, btnElement) {
    document.querySelectorAll('#admin-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#admin-dashboard .tab-content').forEach(c => c.classList.remove('active'));

    btnElement.classList.add('active');
    document.getElementById(`admin-tab-${tabName}`).classList.add('active');

    await syncFromCloud();
    renderAdminDashboard();

    if (tabName === 'pos') {
        focusPOSBarcodeInput();
    }
}

function renderAdminDashboard() {
    const members = db.users.filter(u => u.role === 'member');
    const totalPointsGiven = db.point_history
        .filter(h => Number(h.points_earned) > 0)
        .reduce((sum, h) => sum + Number(h.points_earned), 0);
    const totalSales = db.point_history.reduce((sum, h) => sum + Number(h.amount), 0);

    document.getElementById('stat-total-members').textContent = members.length.toLocaleString();
    document.getElementById('stat-total-points').textContent = totalPointsGiven.toLocaleString();
    document.getElementById('stat-total-redemptions').textContent = db.redemptions.length.toLocaleString();
    document.getElementById('stat-total-sales').textContent = totalSales.toLocaleString();

    document.getElementById('setting-baht-per-point').value = db.settings.baht_per_point;

    renderSpinSettingsForm();
    renderPOSMemberSelect();
    renderRecentPOS();
    renderAdminRedemptions();
    renderAdminPromotions();
    renderAdminMembers();
    renderAdminRewards();
    renderAdminReports();
}

// --- ตั้งค่ารางวัลในวงล้อลุ้นแต้ม (Admin) ---
function renderSpinSettingsForm() {
    const cfg = db.settings.spin_config || DEFAULT_SPIN_CONFIG;
    const enabledEl = document.getElementById('spin-cfg-enabled');
    const costEl = document.getElementById('spin-cfg-cost');
    if (enabledEl) enabledEl.value = cfg.enabled ? '1' : '0';
    if (costEl) costEl.value = cfg.cost;

    for (let i = 0; i < 6; i++) {
        const prizeInput = document.getElementById(`spin-prize-${i}`);
        const weightInput = document.getElementById(`spin-weight-${i}`);
        if (prizeInput) prizeInput.value = cfg.prizes[i];
        if (weightInput) weightInput.value = cfg.weights[i];
    }
}

async function handleSaveSpinSettings(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-spin-cfg');
    const enabled = document.getElementById('spin-cfg-enabled').value === '1';
    const cost = Math.max(0, parseInt(document.getElementById('spin-cfg-cost').value) || 0);

    const prizes = [];
    const weights = [];
    for (let i = 0; i < 6; i++) {
        prizes.push(Math.max(0, parseInt(document.getElementById(`spin-prize-${i}`).value) || 0));
        weights.push(Math.max(1, parseInt(document.getElementById(`spin-weight-${i}`).value) || 1));
    }

    const newConfig = { enabled, cost, prizes, weights };

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';

    const { error } = await sb.from('settings').upsert({
        setting_key: 'lucky_spin_config',
        setting_value: JSON.stringify(newConfig)
    });

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกการตั้งค่าวงล้อ';

    if (error) {
        showToast('เกิดข้อผิดพลาดในการบันทึกการตั้งค่าวงล้อ');
        return;
    }

    await syncFromCloud();
    renderSpinSettingsForm();
    showToast('บันทึกการตั้งค่าวงล้อลุ้นแต้มเรียบร้อยแล้ว!');
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

function handlePOSMemberSearch(fromScannerEnter = false) {
    const searchInput = document.getElementById('pos-member-search');
    const input = searchInput.value.trim();
    const hiddenId = document.getElementById('pos-selected-user-id');
    const statusBox = document.getElementById('pos-member-status');

    const rawKeyword = input.split('|')[0].trim().toLowerCase();
    const cleanDigits = rawKeyword.replace(/\D/g, '');

    const found = db.users.find(u => {
        if (u.role !== 'member') return false;
        const dbPhone = (u.student_id || '').replace(/\D/g, '');
        return (
            (cleanDigits !== '' && dbPhone === cleanDigits) ||
            (u.student_id && u.student_id.toLowerCase() === rawKeyword) ||
            u.username.toLowerCase() === rawKeyword ||
            `${u.student_id || u.username} | ${u.full_name}`.toLowerCase() === input.toLowerCase()
        );
    });

    if (found) {
        hiddenId.value = found.id;
        const tier = getMemberTierInfo(found.id, found.points);
        statusBox.innerHTML = `
            <div style="background: #DCFCE7; border: 1.5px solid #16A34A; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="font-size: 12px; color: #166534; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> พบข้อมูลสมาชิก (${tier.name})</span>
                    <div style="font-size: 16px; font-weight: 700; color: #0F172A;">${found.full_name}</div>
                    <small style="color: #334155;">เบอร์โทร: ${found.student_id || '-'}</small>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 11px; color: #166534;">แต้มสะสม</span>
                    <div style="font-size: 22px; font-weight: 700; color: #1E3A8A;">${found.points.toLocaleString()}</div>
                </div>
            </div>
        `;

        if (fromScannerEnter || (cleanDigits.length === 10 && found.student_id === cleanDigits)) {
            searchInput.value = `${found.student_id || found.username} | ${found.full_name}`;
            const amountInput = document.getElementById('pos-amount');
            if (amountInput) {
                amountInput.focus();
                amountInput.select();
            }
            if (fromScannerEnter) {
                showToast(`สแกนพบคุณ ${found.full_name} กรอกยอดซื้อได้เลย`);
            }
        }
    } else {
        hiddenId.value = '';
        if (input) {
            statusBox.innerHTML = `<small style="color: var(--danger-red);"><i class="fa-solid fa-magnifying-glass"></i> ${fromScannerEnter ? 'ไม่พบข้อมูลบาร์โค้ดนี้ในระบบสมาชิก' : 'กำลังค้นหาสมาชิก...'}</small>`;
            if (fromScannerEnter) {
                showToast('ไม่พบข้อมูลบาร์โค้ดสมาชิกนี้ในระบบ');
                searchInput.select();
            }
        } else {
            statusBox.innerHTML = '';
        }
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
        showToast('ไม่พบข้อมูลสมาชิก กรุณายิงบาร์โค้ดหรือเลือกจากรายการ');
        focusPOSBarcodeInput();
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
    document.getElementById('pos-member-status').innerHTML = '';
    document.getElementById('pos-preview-points').textContent = '0 แต้ม';

    await syncFromCloud();
    renderAdminDashboard();
    showToast(`บันทึกยอดซื้อ ${amount} บาท ให้คุณ ${member.full_name} (+${pointsEarned} แต้ม)`);

    focusPOSBarcodeInput();
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
    const recent = db.point_history.filter(h => Number(h.amount) > 0).slice(0, 5);
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

// --- ส่วนแสดงประวัติการแลกของรางวัลอัตโนมัติ ---
function renderAdminRedemptions() {
    const tbody = document.getElementById('admin-redemptions-tbody');
    tbody.innerHTML = db.redemptions.length ? db.redemptions.map(item => {
        const user = db.users.find(u => u.id === item.user_id);
        const reward = db.rewards.find(r => r.id === item.reward_id);

        const statusBadge = item.status === 'rejected'
            ? '<span class="status-pill status-rejected">ยกเลิกแล้ว</span>'
            : '<span class="status-pill status-approved">แลกสำเร็จอัตโนมัติ</span>';

        return `
            <tr>
                <td><strong>${formatTicketCode(item.id)}</strong></td>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${user ? `${user.full_name} (${user.student_id || '-'})` : 'ไม่พบสมาชิก'}</td>
                <td>${reward ? reward.name : 'ไม่พบของรางวัล'}</td>
                <td>${item.points_spent} แต้ม</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีประวัติการแลกของรางวัล</td></tr>';
}

// ==========================================================
// ฟังก์ชันช่วยจัดการลากวางและย่อขนาดรูปภาพอัตโนมัติ (Drag & Drop)
// ==========================================================
function setupImageDropzone(prefix) {
    const dropzone = document.getElementById(`${prefix}-dropzone`);
    const fileInput = document.getElementById(`${prefix}-file-input`);
    if (!dropzone || !fileInput) return;

    dropzone.onclick = () => fileInput.click();
    dropzone.ondragover = (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processUploadedImage(e.dataTransfer.files[0], prefix);
        }
    };
    fileInput.onchange = (e) => {
        if (e.target.files && e.target.files[0]) {
            processUploadedImage(e.target.files[0], prefix);
        }
    };
}

function processUploadedImage(file, prefix) {
    if (!file.type.startsWith('image/')) {
        showToast('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
        return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxWidth = 900;
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);

            const compressed = canvas.toDataURL('image/jpeg', 0.8);
            setDropzonePreview(prefix, compressed);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function setDropzonePreview(prefix, imageUrl) {
    const hiddenInput = document.getElementById(`modal-${prefix}-image`);
    const previewBox = document.getElementById(`${prefix}-preview-box`);
    const previewImg = document.getElementById(`${prefix}-preview-img`);
    const fileInput = document.getElementById(`${prefix}-file-input`);

    if (hiddenInput) hiddenInput.value = imageUrl || '';
    if (fileInput && !imageUrl) fileInput.value = '';

    if (imageUrl && imageUrl.trim() !== '') {
        if (previewImg) previewImg.src = imageUrl;
        if (previewBox) previewBox.style.display = 'block';
    } else {
        if (previewBox) previewBox.style.display = 'none';
    }
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
    setupImageDropzone('promo');

    if (promoId) {
        const p = db.promotions.find(item => item.id === promoId);
        title.textContent = 'แก้ไขแบนเนอร์โปรโมชั่น';
        document.getElementById('edit-promo-id').value = p.id;
        document.getElementById('modal-promo-badge').value = p.badge;
        document.getElementById('modal-promo-title').value = p.title;
        document.getElementById('modal-promo-desc').value = p.description;
        document.getElementById('modal-promo-active').value = p.is_active ? '1' : '0';
        setDropzonePreview('promo', p.image);
    } else {
        title.textContent = 'เพิ่มแบนเนอร์โปรโมชั่น';
        document.getElementById('edit-promo-id').value = '';
        document.getElementById('modal-promo-badge').value = '';
        document.getElementById('modal-promo-title').value = '';
        document.getElementById('modal-promo-desc').value = '';
        document.getElementById('modal-promo-active').value = '1';
        setDropzonePreview('promo', '');
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

    if (!image) {
        showToast('กรุณาอัปโหลดรูปภาพแบนเนอร์ก่อนบันทึก');
        return;
    }

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

// --- ส่วนจัดการสมาชิก (CRUD + Audit Log บันทึกประวัติแก้แต้ม) ---
function renderAdminMembers() {
    const keyword = document.getElementById('member-search').value.toLowerCase().trim();
    const tbody = document.getElementById('admin-members-tbody');

    const members = db.users.filter(u =>
        u.role === 'member' &&
        (u.full_name.toLowerCase().includes(keyword) ||
         (u.student_id && u.student_id.toLowerCase().includes(keyword)) ||
         u.username.toLowerCase().includes(keyword))
    );

    tbody.innerHTML = members.length ? members.map(m => {
        const tier = getMemberTierInfo(m.id, m.points);
        return `
            <tr>
                <td>${m.student_id || '-'}</td>
                <td>${m.full_name}</td>
                <td><span class="tier-pill ${tier.cssClass}">${tier.name}</span></td>
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
        `;
    }).join('') : '<tr><td colspan="5" style="text-align:center;">ไม่พบข้อมูลสมาชิก</td></tr>';
}

function openMemberModal(memberId = null) {
    const modal = document.getElementById('member-modal');
    const title = document.getElementById('member-modal-title');
    const reasonGroup = document.getElementById('member-edit-reason-group');
    const reasonInput = document.getElementById('modal-mem-reason');

    if (memberId) {
        const m = db.users.find(u => u.id === memberId);
        title.textContent = 'แก้ไขข้อมูลสมาชิก';
        document.getElementById('edit-member-id').value = m.id;
        document.getElementById('modal-mem-studentid').value = m.student_id || '';
        document.getElementById('modal-mem-fullname').value = m.full_name;
        document.getElementById('modal-mem-password').value = m.password;
        document.getElementById('modal-mem-points').value = m.points;
        if (reasonGroup) reasonGroup.style.display = 'block';
        if (reasonInput) reasonInput.value = '';
    } else {
        title.textContent = 'เพิ่มสมาชิกใหม่';
        document.getElementById('edit-member-id').value = '';
        document.getElementById('modal-mem-studentid').value = '';
        document.getElementById('modal-mem-fullname').value = '';
        document.getElementById('modal-mem-password').value = '1234';
        document.getElementById('modal-mem-points').value = 0;
        if (reasonGroup) reasonGroup.style.display = 'none';
    }
    modal.classList.remove('hidden');
}

async function saveMember(e) {
    e.preventDefault();
    const id = document.getElementById('edit-member-id').value;
    const phone = document.getElementById('modal-mem-studentid').value.replace(/\D/g, '');
    const fullName = document.getElementById('modal-mem-fullname').value.trim().replace(/\s+/g, ' ');
    const username = fullName;
    const password = document.getElementById('modal-mem-password').value.trim();
    const points = parseInt(document.getElementById('modal-mem-points').value) || 0;
    const reason = (document.getElementById('modal-mem-reason')?.value || '').trim();

    if (phone.length < 9 || phone.length > 10) {
        showToast('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)');
        return;
    }

    await syncFromCloud();
    const currentId = id ? parseInt(id) : null;

    const isNameDuplicate = db.users.some(u =>
        u.id !== currentId &&
        ((u.username && u.username.trim().replace(/\s+/g, ' ').toLowerCase() === username.toLowerCase()) ||
         (u.full_name && u.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === fullName.toLowerCase()))
    );

    if (isNameDuplicate) {
        showToast('ไม่สามารถบันทึกได้: ชื่อ-นามสกุลนี้ซ้ำกับสมาชิกอื่นในระบบ');
        return;
    }

    const isPhoneDuplicate = db.users.some(u =>
        u.id !== currentId &&
        (u.student_id && u.student_id.replace(/\D/g, '') === phone)
    );

    if (isPhoneDuplicate) {
        showToast('ไม่สามารถบันทึกได้: เบอร์โทรศัพท์นี้ซ้ำกับสมาชิกอื่นในระบบ');
        return;
    }

    if (currentId) {
        const oldMember = db.users.find(u => u.id === currentId);
        const oldPoints = oldMember ? Number(oldMember.points) : 0;
        const pointDiff = points - oldPoints;

        const { error } = await sb.from('users').update({
            student_id: phone,
            full_name: fullName,
            username,
            password,
            points
        }).eq('id', currentId);

        if (error) {
            showToast('เกิดข้อผิดพลาดในการแก้ไขข้อมูล');
            return;
        }

        if (pointDiff !== 0) {
            const sign = pointDiff > 0 ? `+${pointDiff}` : `${pointDiff}`;
            await sb.from('point_history').insert([{
                user_id: currentId,
                amount: 0,
                points_earned: pointDiff,
                note: `[แอดมินปรับแต้ม ${sign} แต้ม (${oldPoints}→${points})] ${reason || 'แก้ไขผ่านหน้าจัดการสมาชิก'}`
            }]);
        }

        showToast('แก้ไขข้อมูลสมาชิกเรียบร้อยแล้ว');
    } else {
        const { data: inserted, error } = await sb.from('users').insert([{
            student_id: phone,
            full_name: fullName,
            username,
            password,
            role: 'member',
            points
        }]).select().single();

        if (error) {
            showToast('เกิดข้อผิดพลาดในการเพิ่มสมาชิก');
            return;
        }

        if (inserted && points > 0) {
            await sb.from('point_history').insert([{
                user_id: inserted.id,
                amount: 0,
                points_earned: points,
                note: `[แอดมินปรับแต้ม +${points} แต้ม] เพิ่มสมาชิกใหม่พร้อมแต้มเริ่มต้น`
            }]);
        }

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
    setupImageDropzone('rew');

    if (rewardId) {
        const r = db.rewards.find(rw => rw.id === rewardId);
        title.textContent = 'แก้ไขรายการของรางวัล';
        document.getElementById('edit-reward-id').value = r.id;
        document.getElementById('modal-rew-name').value = r.name;
        document.getElementById('modal-rew-desc').value = r.description;
        document.getElementById('modal-rew-points').value = r.points_required;
        document.getElementById('modal-rew-stock').value = r.stock;
        setDropzonePreview('rew', r.image);
    } else {
        title.textContent = 'เพิ่มของรางวัลใหม่';
        document.getElementById('edit-reward-id').value = '';
        document.getElementById('modal-rew-name').value = '';
        document.getElementById('modal-rew-desc').value = '';
        document.getElementById('modal-rew-points').value = 10;
        document.getElementById('modal-rew-stock').value = 10;
        setDropzonePreview('rew', '');
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

    if (!image) {
        showToast('กรุณาอัปโหลดรูปภาพของรางวัลก่อนบันทึก');
        return;
    }

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

// --- ส่วนรายงานสรุปยอดขายรายวัน/รายเดือน & Audit Log ---
function setReportPeriod(period) {
    reportPeriod = period;
    ['today', 'week', 'month', 'all'].forEach(p => {
        const btn = document.getElementById(`rep-filter-${p}`);
        if (btn) {
            btn.className = p === period ? 'btn btn-primary' : 'btn btn-outline';
        }
    });
    renderAdminReports();
}

function isInSelectedPeriod(isoString) {
    if (reportPeriod === 'all') return true;
    if (!isoString) return false;
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return false;

    const now = new Date();
    if (reportPeriod === 'today') {
        return getLocalDateKey(isoString) === getLocalDateKey();
    } else if (reportPeriod === 'week') {
        const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
        return d >= sevenDaysAgo;
    } else if (reportPeriod === 'month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    return true;
}

function renderAdminReports() {
    const container = document.getElementById('report-summary-content');
    const periodNames = {
        today: 'วันนี้',
        week: '7 วันล่าสุด',
        month: 'เดือนนี้',
        all: 'ทั้งหมด'
    };

    const filteredHistory = db.point_history.filter(h => isInSelectedPeriod(h.created_at));
    const filteredRedemptions = db.redemptions.filter(r => isInSelectedPeriod(r.created_at));

    const periodSales = filteredHistory.reduce((sum, h) => sum + Number(h.amount), 0);
    const periodOrders = filteredHistory.filter(h => Number(h.amount) > 0).length;
    const periodPointsGiven = filteredHistory
        .filter(h => Number(h.points_earned) > 0)
        .reduce((sum, h) => sum + Number(h.points_earned), 0);
    const periodRedeemedCount = filteredRedemptions.length;

    const members = db.users.filter(u => u.role === 'member');
    const topMembers = [...members].sort((a, b) => b.points - a.points).slice(0, 5);

    const auditLogs = db.point_history
        .filter(h => h.note && h.note.startsWith('[แอดมินปรับแต้ม'))
        .slice(0, 15);

    container.innerHTML = `
        <div class="report-kpi-grid">
            <div class="report-kpi-box">
                <span>ยอดขาย (${periodNames[reportPeriod]})</span>
                <strong>${periodSales.toLocaleString()} ฿</strong>
                <small>${periodOrders} บิลขาย</small>
            </div>
            <div class="report-kpi-box">
                <span>แต้มที่แจก (${periodNames[reportPeriod]})</span>
                <strong style="color: #D97706;">+${periodPointsGiven.toLocaleString()} แต้ม</strong>
                <small>รวมทุกช่องทาง</small>
            </div>
            <div class="report-kpi-box">
                <span>แลกของรางวัล (${periodNames[reportPeriod]})</span>
                <strong style="color: #16A34A;">${periodRedeemedCount.toLocaleString()} ครั้ง</strong>
                <small>รายการแลกสำเร็จ</small>
            </div>
        </div>

        <div style="margin-top: 22px;">
            <h4 style="color:var(--primary-blue); margin-bottom:10px;"><i class="fa-solid fa-trophy"></i> 5 อันดับสมาชิกที่มีแต้มสะสมสูงสุด</h4>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>อันดับ</th>
                            <th>เบอร์โทรศัพท์</th>
                            <th>ชื่อ-นามสกุล</th>
                            <th>ระดับ</th>
                            <th>แต้มสะสมปัจจุบัน</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topMembers.map((m, idx) => {
                            const tier = getMemberTierInfo(m.id, m.points);
                            return `
                                <tr>
                                    <td>#${idx + 1}</td>
                                    <td>${m.student_id || '-'}</td>
                                    <td>${m.full_name}</td>
                                    <td><span class="tier-pill ${tier.cssClass}">${tier.name}</span></td>
                                    <td><strong>${m.points.toLocaleString()} แต้ม</strong></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div style="margin-top: 26px;">
            <h4 style="color:var(--primary-blue); margin-bottom:10px;"><i class="fa-solid fa-shield-halved"></i> ประวัติการแก้ไขแต้มด้วยมือ (Audit Log)</h4>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>วัน-เวลา</th>
                            <th>สมาชิก</th>
                            <th>จำนวนที่ปรับ</th>
                            <th>รายละเอียด / เหตุผล</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${auditLogs.length ? auditLogs.map(log => {
                            const user = db.users.find(u => u.id === log.user_id);
                            const pts = Number(log.points_earned);
                            return `
                                <tr>
                                    <td>${formatDateTime(log.created_at)}</td>
                                    <td>${user ? `${user.full_name} (${user.student_id || '-'})` : 'ไม่พบสมาชิก'}</td>
                                    <td><strong style="color: ${pts >= 0 ? 'var(--success-green)' : 'var(--danger-red)'};">${pts >= 0 ? '+' + pts : pts} แต้ม</strong></td>
                                    <td>${log.note}</td>
                                </tr>
                            `;
                        }).join('') : '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">ยังไม่มีประวัติการแก้ไขแต้มด้วยมือ</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function exportReportCSV() {
    let csv = '\uFEFFเบอร์โทรศัพท์,ชื่อ-นามสกุล,ระดับสมาชิก,แต้มสะสมปัจจุบัน\n';
    db.users.filter(u => u.role === 'member').forEach(m => {
        const tier = getMemberTierInfo(m.id, m.points);
        csv += `"${m.student_id || '-'}","${m.full_name}","${tier.name}",${m.points}\n`;
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

// ==========================================================
// ระบบซิงก์ข้อมูลอัตโนมัติแบบเรียลไทม์ (Supabase Realtime)
// ==========================================================
let realtimeChannel = null;

function startRealtimeSync() {
    if (realtimeChannel) return;

    realtimeChannel = sb.channel('muk-rcheewa-live')
        .on('postgres_changes', { event: '*', schema: 'public' }, async (payload) => {
            if (!currentUser) return;

            const oldPoints = currentUser.points;
            const ok = await syncFromCloud();
            if (!ok) return;

            if (currentUser.role === 'admin') {
                renderAdminDashboard();
                if (payload.table === 'redemptions' && payload.eventType === 'INSERT' && payload.new) {
                    const buyer = db.users.find(u => u.id === payload.new.user_id);
                    const rw = db.rewards.find(r => r.id === payload.new.reward_id);

                    const imgEl = document.getElementById('admin-alert-reward-img');
                    if (imgEl) {
                        imgEl.src = (rw && rw.image) ? rw.image : 'https://via.placeholder.com/400x200?text=Reward';
                    }
                    document.getElementById('admin-alert-reward-name').textContent = rw ? rw.name : 'ของรางวัล';
                    document.getElementById('admin-alert-points').textContent = `ใช้แต้มสะสมไป ${payload.new.points_spent} แต้ม`;
                    document.getElementById('admin-alert-member').textContent = buyer ? buyer.full_name : 'สมาชิก';
                    document.getElementById('admin-alert-phone').textContent = buyer ? (buyer.student_id || '-') : '-';
                    document.getElementById('admin-alert-code').textContent = formatTicketCode(payload.new.id);
                    document.getElementById('admin-alert-time').textContent = formatDateTime(payload.new.created_at);

                    const alertModal = document.getElementById('admin-redeem-alert-modal');
                    if (alertModal) alertModal.classList.remove('hidden');

                    try {
                        const ctx = new (window.AudioContext || window.webkitAudioContext)();
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(880, ctx.currentTime);
                        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
                        gain.gain.setValueAtTime(0.3, ctx.currentTime);
                        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start();
                        osc.stop(ctx.currentTime + 0.4);
                    } catch (e) {}
                }
            } else {
                renderMemberDashboard();
                const updatedUser = db.users.find(u => u.id === currentUser.id);
                if (updatedUser && updatedUser.points > oldPoints) {
                    const diff = updatedUser.points - oldPoints;
                    showToast(`คุณได้รับเพิ่ม +${diff} แต้ม!`);
                }
            }
        })
        .subscribe();
}

// เริ่มทำงานทันทีที่เปิดหน้าเว็บ: กู้คืนสถานะล็อกอิน + ซิงก์เรียลไทม์
restoreSession();
startRealtimeSync();
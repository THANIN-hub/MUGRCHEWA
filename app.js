/* ==========================================================
   ระบบบริหารจัดการแต้มสมาชิกดิจิทัล ร้านมักอาชีวะ
   ไฟล์: app.js (เชื่อมต่อฐานข้อมูลกลาง Supabase + Barcode + POS + Tier + Check-in Calendar + Custom Lucky Spin + Spin History + Audit Log)
   ========================================================== */

const SUPABASE_URL = 'https://ziaekbkkadjpmgmhqlyk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppYWVrYmtrYWRqcG1nbWhxbHlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3NjA3MDcsImV4cCI6MjExMTMzNjcwN30.l7l0Y_HDeQR25f1KOer1RXGLTldIAiWEq3zFQptk1_c';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const SESSION_KEY = 'muk_rcheewa_user_id';

const DEFAULT_SPIN_CONFIG = {
    enabled: true,
    cost: 3,
    labels: ['+1 แต้ม', '+3 แต้ม', '+5 แต้ม', '+2 แต้ม', '+10 แต้ม', '+15 แต้ม'],
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
let isRedeeming = false;
let currentWheelRotation = 0;
let calViewYear = new Date().getFullYear();
let calViewMonth = new Date().getMonth();
let promoSlideIndex = 0;
let promoSlideTimer = null;
let realtimeChannel = null;

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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
        if (rewardsRes.error) throw rewardsRes.error;
        if (historyRes.error) throw historyRes.error;
        if (redeemRes.error) throw redeemRes.error;
        if (promoRes.error) throw promoRes.error;
        if (settingsRes.error) throw settingsRes.error;

        db.users = usersRes.data || [];
        db.rewards = rewardsRes.data || [];
        db.point_history = historyRes.data || [];
        db.redemptions = redeemRes.data || [];
        db.promotions = promoRes.data || [];

        db.settings = {
            baht_per_point: 20,
            welcome_bonus: 5,
            spin_config: { ...DEFAULT_SPIN_CONFIG }
        };

        if (Array.isArray(settingsRes.data)) {
            settingsRes.data.forEach(s => {
                if (!s || !s.setting_key) return;
                if (s.setting_key === 'lucky_spin_config') {
                    try {
                        const parsed = JSON.parse(s.setting_value);
                        const prizes = Array.isArray(parsed.prizes) && parsed.prizes.length === 6
                            ? parsed.prizes.map(v => Math.max(0, Number(v) || 0))
                            : [...DEFAULT_SPIN_CONFIG.prizes];
                        const labels = Array.isArray(parsed.labels) && parsed.labels.length === 6
                            ? parsed.labels.map((lbl, idx) => String(lbl || '').trim() || (prizes[idx] > 0 ? `+${prizes[idx]} แต้ม` : 'ไม่ได้แต้ม'))
                            : prizes.map(p => (p > 0 ? `+${p} แต้ม` : 'ไม่ได้แต้ม'));
                        const weights = Array.isArray(parsed.weights) && parsed.weights.length === 6
                            ? parsed.weights.map(v => Math.max(0, Number(v) || 0))
                            : [...DEFAULT_SPIN_CONFIG.weights];

                        db.settings.spin_config = {
                            enabled: parsed.enabled !== false,
                            cost: Number.isFinite(Number(parsed.cost)) && Number(parsed.cost) >= 0 ? Number(parsed.cost) : 3,
                            labels,
                            prizes,
                            weights
                        };
                    } catch (e) {
                        db.settings.spin_config = { ...DEFAULT_SPIN_CONFIG };
                    }
                } else if (!s.setting_key.startsWith('reset_req_')) {
                    const numVal = parseInt(s.setting_value, 10);
                    if (Number.isFinite(numVal) && numVal > 0) {
                        db.settings[s.setting_key] = numVal;
                    }
                }
            });
        }

        if (currentUser) {
            const refreshedMe = db.users.find(u => String(u.id) === String(currentUser.id));
            if (refreshedMe) {
                currentUser = refreshedMe;
            }
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
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${escapeHTML(message)}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3500);
}

function formatDateTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
}

function formatTicketCode(id) {
    const num = Number(id);
    return `#${Number.isFinite(num) ? String(num).padStart(4, '0') : String(id || '0000')}`;
}

function formatSpinTicketCode(id) {
    const num = Number(id);
    return `#S${Number.isFinite(num) ? String(num).padStart(4, '0') : String(id || '0000')}`;
}

function parseSpinHistoryRecord(item) {
    const note = String(item?.note || '');
    const costMatch = note.match(/ใช้\s*(\d+)\s*แต้ม/);
    const cost = costMatch ? Number(costMatch[1]) : 0;

    let prizeLabel = '-';
    const quoteMatch = note.match(/ได้รับ\s*"([^"]+)"/);
    if (quoteMatch) {
        prizeLabel = quoteMatch[1];
    } else {
        const legacyMatch = note.match(/ได้รับ\s*\+?(\d+)\s*แต้ม/);
        if (legacyMatch) {
            const pts = Number(legacyMatch[1]);
            prizeLabel = pts > 0 ? `+${pts} แต้ม` : 'ไม่ได้แต้ม';
        }
    }

    const netDelta = Number(item?.points_earned) || 0;
    const isNoPrize = prizeLabel.includes('ไม่ได้') || prizeLabel.includes('เกลือ') || prizeLabel.includes('เสียใจ');

    return { cost, prizeLabel, netDelta, isNoPrize };
}

function openSpinTicketModal(historyId) {
    const item = db.point_history.find(h => String(h.id) === String(historyId));
    if (!item) return;

    const parsed = parseSpinHistoryRecord(item);
    const owner = db.users.find(u => String(u.id) === String(item.user_id)) || currentUser;

    document.getElementById('spin-ticket-reward').textContent = parsed.prizeLabel;
    document.getElementById('spin-ticket-cost').textContent = parsed.cost > 0 ? `ใช้แต้มหมุน ${parsed.cost} แต้ม` : 'หมุนวงล้อฟรี (0 แต้ม)';
    document.getElementById('spin-ticket-code').textContent = `รหัสอ้างอิง: ${formatSpinTicketCode(item.id)}`;
    document.getElementById('spin-ticket-member').textContent = owner ? `ผู้หมุน: ${owner.full_name} (${owner.student_id || '-'})` : 'ผู้หมุน: -';
    document.getElementById('spin-ticket-date').textContent = `วัน-เวลาที่หมุน: ${formatDateTime(item.created_at)}`;

    document.getElementById('spin-ticket-modal')?.classList.remove('hidden');
}

function getLocalDateKey(isoString) {
    const d = isoString ? new Date(isoString) : new Date();
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// คำนวณระดับสมาชิก (Member Tier) 4 ระดับ: MEMBER (0) -> SILVER (50) -> GOLD (150) -> PLATINUM (300)
function getMemberTierInfo(userId, currentPoints = 0) {
    const earnedSum = db.point_history
        .filter(h => String(h.user_id) === String(userId) && Number(h.points_earned) > 0)
        .reduce((sum, h) => sum + (Number(h.points_earned) || 0), 0);

    const lifetimePoints = Math.max(earnedSum, Number(currentPoints) || 0);

    let barPercent = 0;
    if (lifetimePoints >= 300) {
        barPercent = 100;
    } else if (lifetimePoints >= 150) {
        barPercent = 66.66 + ((lifetimePoints - 150) / 150) * 33.34;
    } else if (lifetimePoints >= 50) {
        barPercent = 33.33 + ((lifetimePoints - 50) / 100) * 33.33;
    } else {
        barPercent = (lifetimePoints / 50) * 33.33;
    }
    barPercent = Math.max(0, Math.min(100, Math.round(barPercent)));

    if (lifetimePoints >= 300) {
        return {
            name: 'PLATINUM',
            label: 'ระดับ PLATINUM',
            cssClass: 'tier-platinum',
            fillClass: 'fill-platinum',
            icon: 'fa-gem',
            lifetimePoints,
            barPercent: 100,
            nextText: `ระดับสูงสุด PLATINUM (สะสมรวม ${lifetimePoints} แต้ม)`,
            goalShortText: `ถึงระดับสูงสุด PLATINUM แล้ว (${lifetimePoints} แต้ม)`
        };
    } else if (lifetimePoints >= 150) {
        const diff = 300 - lifetimePoints;
        return {
            name: 'GOLD',
            label: 'ระดับ GOLD',
            cssClass: 'tier-gold',
            fillClass: 'fill-gold',
            icon: 'fa-crown',
            lifetimePoints,
            barPercent,
            nextText: `อีก ${diff} แต้ม ขึ้นระดับ PLATINUM`,
            goalShortText: `อีก ${diff} แต้ม ➔ PLATINUM`
        };
    } else if (lifetimePoints >= 50) {
        const diff = 150 - lifetimePoints;
        return {
            name: 'SILVER',
            label: 'ระดับ SILVER',
            cssClass: 'tier-silver',
            fillClass: 'fill-silver',
            icon: 'fa-award',
            lifetimePoints,
            barPercent,
            nextText: `อีก ${diff} แต้ม ขึ้นระดับ GOLD`,
            goalShortText: `อีก ${diff} แต้ม ➔ GOLD`
        };
    } else {
        const diff = 50 - lifetimePoints;
        return {
            name: 'MEMBER',
            label: 'ระดับ MEMBER',
            cssClass: 'tier-member',
            fillClass: '',
            icon: 'fa-medal',
            lifetimePoints,
            barPercent,
            nextText: `อีก ${diff} แต้ม ขึ้นระดับ SILVER`,
            goalShortText: `อีก ${diff} แต้ม ➔ SILVER`
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
        document.querySelectorAll('.tab-btn')[0]?.classList.add('active');
        document.getElementById('login-form')?.classList.add('active');
    } else {
        document.querySelectorAll('.tab-btn')[1]?.classList.add('active');
        document.getElementById('register-form')?.classList.add('active');
    }
}

function openForgotModal() {
    const loginVal = (document.getElementById('login-username')?.value || '').replace(/\D/g, '');
    document.getElementById('forgot-phone').value = loginVal;
    document.getElementById('forgot-fullname').value = '';
    document.getElementById('forgot-new-password').value = '';
    document.getElementById('forgot-confirm-password').value = '';
    document.getElementById('forgot-modal')?.classList.remove('hidden');
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

    const ok = await syncFromCloud();
    if (!ok) {
        btn.disabled = false;
        btn.textContent = 'เปลี่ยนรหัสผ่านทันที';
        return;
    }

    const member = db.users.find(u =>
        u.role === 'member' &&
        u.student_id &&
        String(u.student_id).replace(/\D/g, '') === phone &&
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

    document.getElementById('auth-view')?.classList.add('hidden');
    document.getElementById('main-app')?.classList.remove('hidden');
    document.getElementById('nav-user-name').textContent = user.full_name;

    if (user.role === 'admin') {
        document.getElementById('nav-user-role').textContent = 'ผู้ดูแลร้าน';
        document.getElementById('member-dashboard')?.classList.add('hidden');
        document.getElementById('admin-dashboard')?.classList.remove('hidden');
        renderAdminDashboard();
        focusPOSBarcodeInput();
    } else {
        document.getElementById('nav-user-role').textContent = 'สมาชิก';
        document.getElementById('admin-dashboard')?.classList.add('hidden');
        document.getElementById('member-dashboard')?.classList.remove('hidden');
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
    if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
    }
    const btn = document.getElementById('btn-login-submit');
    const rawInput = document.getElementById('login-username').value.trim();
    const cleanPhone = rawInput.replace(/\D/g, '');
    const password = document.getElementById('login-password').value.trim();

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเข้าสู่ระบบ...';
    }

    const ok = await syncFromCloud();

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ';
    }

    if (!ok) return;

    const user = db.users.find(u => {
        if (String(u.password) !== password) return false;
        if (u.role === 'admin') {
            return String(u.username || '').toLowerCase() === rawInput.toLowerCase();
        }
        const dbPhone = String(u.student_id || '').replace(/\D/g, '');
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

    if (!fullName) {
        showToast('กรุณากรอกชื่อ-นามสกุล');
        return;
    }

    if (phone.length < 9 || phone.length > 10) {
        showToast('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)');
        return;
    }

    if (!password) {
        showToast('กรุณากำหนดรหัสผ่าน');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบข้อมูล...';

    const ok = await syncFromCloud();
    if (!ok) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
        return;
    }

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
        u.student_id && String(u.student_id).replace(/\D/g, '') === phone
    );

    if (isPhoneDuplicate) {
        showToast('ไม่สามารถสมัครได้: เบอร์โทรศัพท์นี้ลงทะเบียนในระบบแล้ว');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
        return;
    }

    const bonus = Number.isFinite(Number(db.settings.welcome_bonus)) ? Number(db.settings.welcome_bonus) : 5;

    const { data: insertedUser, error } = await sb.from('users').insert([{
        username,
        password,
        full_name: fullName,
        student_id: phone,
        role: 'member',
        points: bonus
    }]).select().single();

    if (error || !insertedUser) {
        showToast('ไม่สามารถสมัครสมาชิกได้: ชื่อหรือเบอร์โทรอาจซ้ำในระบบ');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
        return;
    }

    if (bonus > 0) {
        await sb.from('point_history').insert([{
            user_id: insertedUser.id,
            amount: 0,
            points_earned: bonus,
            note: 'โบนัสต้อนรับสมาชิกใหม่'
        }]);
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรีแต้มโบนัส!)';
    e.target.reset();

    await syncFromCloud();
    const freshUser = db.users.find(u => String(u.id) === String(insertedUser.id)) || insertedUser;
    const isRemember = document.getElementById('login-remember')?.checked ?? true;
    applyLoggedInUI(freshUser, isRemember);
    showToast(`สมัครสมาชิกสำเร็จ! ได้รับโบนัส ${bonus} แต้ม`);
}

function handleLogout() {
    currentUser = null;
    if (promoSlideTimer) {
        clearInterval(promoSlideTimer);
        promoSlideTimer = null;
    }
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    document.getElementById('main-app')?.classList.add('hidden');
    document.getElementById('auth-view')?.classList.remove('hidden');
    document.getElementById('login-form')?.reset();
    showToast('ออกจากระบบเรียบร้อยแล้ว');
}

// ==========================================================
// 1. ระบบสมาชิก (Member Functions: Barcode, Tier, Check-in Calendar, Lucky Spin)
// ==========================================================
function generateMemberBarcode(codeText) {
    const svgEl = document.getElementById('member-barcode');
    if (!svgEl || typeof JsBarcode === 'undefined' || !codeText) return;
    try {
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
    } catch (e) {
        console.warn('Barcode render error:', e);
    }
}

function openMemberBarcodeModal() {
    if (!currentUser) return;
    const codeText = currentUser.student_id || currentUser.username || String(currentUser.id);
    const svgLarge = document.getElementById('member-barcode-large');
    if (svgLarge && typeof JsBarcode !== 'undefined') {
        try {
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
        } catch (e) {
            console.warn('Large barcode render error:', e);
        }
    }
    document.getElementById('barcode-modal-name').textContent = currentUser.full_name;
    document.getElementById('barcode-modal-phone').textContent = currentUser.student_id || '-';
    document.getElementById('barcode-modal')?.classList.remove('hidden');
}

function getMemberCheckinDatesSet() {
    const set = new Set();
    if (!currentUser) return set;
    db.point_history.forEach(h => {
        if (String(h.user_id) === String(currentUser.id) && h.note === 'เช็กอินรายวันรับแต้มฟรี') {
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
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเช็กอิน...';
    }

    const ok = await syncFromCloud();
    if (!ok) {
        updateCheckinButtonUI();
        return;
    }

    if (hasCheckedInToday()) {
        updateCheckinButtonUI();
        showToast('วันนี้คุณเช็กอินรับแต้มไปแล้ว พรุ่งนี้มาใหม่นะครับ!');
        return;
    }

    const latestUser = db.users.find(u => String(u.id) === String(currentUser.id));
    const basePoints = latestUser ? Number(latestUser.points) || 0 : Number(currentUser.points) || 0;
    const newPoints = basePoints + 1;

    const [updRes, insRes] = await Promise.all([
        sb.from('users').update({ points: newPoints }).eq('id', currentUser.id),
        sb.from('point_history').insert([{
            user_id: currentUser.id,
            amount: 0,
            points_earned: 1,
            note: 'เช็กอินรายวันรับแต้มฟรี'
        }])
    ]);

    if (updRes.error || insRes.error) {
        showToast('เกิดข้อผิดพลาดในการเช็กอิน กรุณาลองใหม่');
        updateCheckinButtonUI();
        return;
    }

    await syncFromCloud();
    renderMemberDashboard();
    showToast('เช็กอินสำเร็จ! รับฟรี +1 แต้ม');
}

function openCheckinCalendarModal() {
    const now = new Date();
    calViewYear = now.getFullYear();
    calViewMonth = now.getMonth();
    renderCheckinCalendar();
    document.getElementById('checkin-calendar-modal')?.classList.remove('hidden');
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
    const titleEl = document.getElementById('cal-month-title');
    if (titleEl) titleEl.textContent = `${monthNames[calViewMonth]} ${thaiYear}`;

    const checkedSet = getMemberCheckinDatesSet();
    const todayKey = getLocalDateKey();

    const firstDayOfWeek = new Date(calViewYear, calViewMonth, 1).getDay();
    const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

    const grid = document.getElementById('cal-days-grid');
    if (!grid) return;

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
    const summaryEl = document.getElementById('cal-month-summary');
    if (summaryEl) summaryEl.textContent = `เช็กอินเดือนนี้ ${checkedThisMonth} วัน`;
}

// วงล้อสุ่มแต้มลุ้นโชค (Lucky Spin)
function syncWheelLabelsUI() {
    const cfg = db.settings.spin_config || DEFAULT_SPIN_CONFIG;
    const labels = cfg.labels || cfg.prizes.map(p => (p > 0 ? `+${p} แต้ม` : 'ไม่ได้แต้ม'));

    for (let i = 0; i < 6; i++) {
        const lbl = document.getElementById(`wheel-lbl-${i}`);
        if (lbl) {
            lbl.textContent = labels[i] || '';
        }
    }

    const openBtn = document.getElementById('btn-open-lucky-spin');
    if (openBtn) {
        openBtn.style.display = cfg.enabled ? 'inline-flex' : 'none';
    }

    const descEl = document.getElementById('spin-desc-text');
    if (descEl) {
        const rewardListText = labels.filter((v, idx, arr) => arr.indexOf(v) === idx).join(' / ');
        descEl.innerHTML = cfg.cost > 0
            ? `ใช้ <strong>${cfg.cost} แต้ม</strong> ต่อการหมุน 1 ครั้ง<br><small style="color:var(--primary-blue);">รางวัลในวงล้อ: ${escapeHTML(rewardListText)}</small>`
            : `หมุนวงล้อ<strong>ฟรี!</strong><br><small style="color:var(--primary-blue);">รางวัลในวงล้อ: ${escapeHTML(rewardListText)}</small>`;
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
    document.getElementById('spin-user-points').textContent = (Number(currentUser.points) || 0).toLocaleString();
    document.getElementById('spin-result-box').textContent = '';
    document.getElementById('spin-modal')?.classList.remove('hidden');
}

async function handleSpinWheel() {
    if (!currentUser || isSpinning) return;

    const ok = await syncFromCloud();
    if (!ok) return;

    const cfg = db.settings.spin_config || DEFAULT_SPIN_CONFIG;
    if (!cfg.enabled) {
        showToast('วงล้อลุ้นแต้มปิดให้บริการชั่วคราว');
        closeModal('spin-modal');
        return;
    }

    const spinCost = Math.max(0, Number(cfg.cost) || 0);
    const latestUser = db.users.find(u => String(u.id) === String(currentUser.id));
    const currentPts = latestUser ? Number(latestUser.points) || 0 : 0;

    if (!latestUser || currentPts < spinCost) {
        showToast(`แต้มไม่พอหมุนวงล้อ (ต้องใช้ ${spinCost} แต้ม)`);
        return;
    }

    const prizes = cfg.prizes.map(p => Math.max(0, Number(p) || 0));
    const labels = cfg.labels || prizes.map(p => (p > 0 ? `+${p} แต้ม` : 'ไม่ได้แต้ม'));
    const weights = cfg.weights.map(w => Math.max(0, Number(w) || 0));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    if (totalWeight <= 0) {
        showToast('ยังไม่ได้กำหนดโอกาสออกรางวัลในวงล้อ กรุณาติดต่อแอดมิน');
        return;
    }

    isSpinning = true;
    const btn = document.getElementById('btn-spin-now');
    const resultBox = document.getElementById('spin-result-box');
    const wheel = document.getElementById('lucky-wheel');

    if (btn) btn.disabled = true;
    if (resultBox) {
        resultBox.style.color = 'var(--primary-blue)';
        resultBox.textContent = 'กำลังหมุนลุ้นรางวัล...';
    }

    let rand = Math.random() * totalWeight;
    let chosenIdx = 0;

    for (let i = 0; i < weights.length; i++) {
        if (weights[i] > 0 && rand < weights[i]) {
            chosenIdx = i;
            break;
        }
        rand -= weights[i];
    }

    const wonPoints = prizes[chosenIdx];
    const wonLabel = labels[chosenIdx];
    const sliceCenterAngle = chosenIdx * 60 + 30;
    const targetMod = (360 - sliceCenterAngle) % 360;
    const currentMod = ((currentWheelRotation % 360) + 360) % 360;
    const delta = (targetMod - currentMod + 360) % 360;

    currentWheelRotation += 1800 + delta;
    if (wheel) {
        wheel.style.transform = `rotate(${currentWheelRotation}deg)`;
    }

    const netPoints = Math.max(0, currentPts - spinCost + wonPoints);
    const netDelta = netPoints - currentPts;

    setTimeout(async () => {
        try {
            const [updRes, insRes] = await Promise.all([
                sb.from('users').update({ points: netPoints }).eq('id', latestUser.id),
                sb.from('point_history').insert([{
                    user_id: latestUser.id,
                    amount: 0,
                    points_earned: netDelta,
                    note: `หมุนวงล้อลุ้นโชค (ใช้ ${spinCost} แต้ม ➔ ได้รับ "${wonLabel}")`
                }])
            ]);

            if (updRes.error || insRes.error) {
                throw new Error(updRes.error?.message || insRes.error?.message || 'Spin update failed');
            }

            await syncFromCloud();
            renderMemberDashboard();

            const ptsEl = document.getElementById('spin-user-points');
            if (ptsEl) ptsEl.textContent = netPoints.toLocaleString();

            const isNoPrize = wonPoints === 0 && (wonLabel.includes('ไม่ได้') || wonLabel.includes('เกลือ') || wonLabel.includes('เสียใจ'));
            if (resultBox) {
                if (!isNoPrize) {
                    resultBox.style.color = 'var(--success-green)';
                    resultBox.innerHTML = `<i class="fa-solid fa-sparkles"></i> ยินดีด้วย! คุณได้รับ "${escapeHTML(wonLabel)}"`;
                    showToast(`หมุนวงล้อได้รับ "${wonLabel}"!`);
                } else {
                    resultBox.style.color = 'var(--danger-red)';
                    resultBox.textContent = `ผลการหมุน: ${wonLabel} ลองใหม่อีกครั้งนะ!`;
                    showToast(`${wonLabel} ลองใหม่อีกครั้งนะครับ`);
                }
            }
        } catch (err) {
            console.error('Spin settlement error:', err);
            showToast('บันทึกผลวงล้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
            if (resultBox) {
                resultBox.style.color = 'var(--danger-red)';
                resultBox.textContent = 'เกิดข้อผิดพลาดในการบันทึกผล';
            }
        } finally {
            isSpinning = false;
            if (btn) btn.disabled = false;
            syncWheelLabelsUI();
        }
    }, 3600);
}

function openTicketModal(redemptionId) {
    const item = db.redemptions.find(r => String(r.id) === String(redemptionId));
    if (!item) return;

    const reward = db.rewards.find(rw => String(rw.id) === String(item.reward_id));
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

    document.getElementById('ticket-modal')?.classList.remove('hidden');
}

function openProfileModal() {
    if (!currentUser) return;
    document.getElementById('prof-fullname').value = currentUser.full_name || '';
    document.getElementById('prof-phone').value = currentUser.student_id || '';
    document.getElementById('prof-old-password').value = '';
    document.getElementById('prof-new-password').value = '';
    document.getElementById('prof-confirm-password').value = '';
    document.getElementById('profile-modal')?.classList.remove('hidden');
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

    const ok = await syncFromCloud();
    if (!ok) {
        btn.disabled = false;
        btn.textContent = 'บันทึกการเปลี่ยนแปลง';
        return;
    }

    const isNameDuplicate = db.users.some(u =>
        String(u.id) !== String(currentUser.id) &&
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
        String(u.id) !== String(currentUser.id) &&
        (u.student_id && String(u.student_id).replace(/\D/g, '') === phone)
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
    const updatedUser = db.users.find(u => String(u.id) === String(currentUser.id));
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

    btnElement?.classList.add('active');
    document.getElementById(`mem-tab-${tabName}`)?.classList.add('active');

    await syncFromCloud();
    renderMemberDashboard();
}

function renderMemberPointsGoal() {
    const goalText = document.getElementById('mem-goal-text');
    const goalPercent = document.getElementById('mem-goal-percent');
    const goalBar = document.getElementById('mem-goal-bar');
    if (!goalText || !goalPercent || !goalBar) return;

    const currentPts = Number(currentUser?.points) || 0;
    const availableRewards = db.rewards
        .filter(r => (Number(r.stock) || 0) > 0 && (Number(r.points_required) || 0) > 0)
        .sort((a, b) => Number(a.points_required) - Number(b.points_required));

    if (!availableRewards.length) {
        goalText.textContent = 'สะสมแต้มต่อเนื่องเพื่อแลกของรางวัลพิเศษ';
        goalPercent.textContent = '100%';
        goalBar.style.width = '100%';
        return;
    }

    const nextTarget = availableRewards.find(r => Number(r.points_required) > currentPts);
    if (nextTarget) {
        const req = Number(nextTarget.points_required);
        const diff = req - currentPts;
        const pct = Math.max(0, Math.min(100, Math.round((currentPts / req) * 100)));
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
    if (!currentUser) return;
    const latestUser = db.users.find(u => String(u.id) === String(currentUser.id));
    if (latestUser) currentUser = latestUser;

    const currentPts = Number(currentUser.points) || 0;
    document.getElementById('mem-card-name').textContent = currentUser.full_name;
    document.getElementById('mem-card-id').textContent = `เบอร์โทรศัพท์: ${currentUser.student_id || '-'}`;
    document.getElementById('mem-current-points').textContent = currentPts.toLocaleString();
    document.getElementById('mem-rate-info').textContent = `ทุกยอดซื้อ ${db.settings.baht_per_point} บาท รับ 1 แต้ม`;

    const tier = getMemberTierInfo(currentUser.id, currentPts);
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
    generateMemberBarcode(currentUser.student_id || currentUser.username || String(currentUser.id));
    renderMemberPointsGoal();
    renderMemberPromotions();
    renderMemberRewards();
    renderMemberHistory();
}

function renderMemberPromotions() {
    const container = document.getElementById('member-promo-section');
    if (!container) return;
    const activePromos = (db.promotions || []).filter(p => Boolean(p.is_active));

    if (promoSlideTimer) {
        clearInterval(promoSlideTimer);
        promoSlideTimer = null;
    }

    if (!activePromos.length) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    promoSlideIndex = 0;

    const slidesHTML = activePromos.map(p => `
        <div class="promo-banner-card">
            <img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.title)}" onerror="this.src='https://via.placeholder.com/800x250?text=Promotion'">
            <div class="promo-overlay">
                <span class="promo-tag"><i class="fa-solid fa-fire"></i> ${escapeHTML(p.badge)}</span>
                <h4>${escapeHTML(p.title)}</h4>
                <p>${escapeHTML(p.description)}</p>
            </div>
        </div>
    `).join('');

    const controlsHTML = activePromos.length > 1 ? `
        <button type="button" class="promo-nav-btn promo-prev" onclick="movePromoSlide(-1)" title="ก่อนหน้า">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button type="button" class="promo-nav-btn promo-next" onclick="movePromoSlide(1)" title="ถัดไป">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
        <div class="promo-dots">
            ${activePromos.map((_, idx) => `
                <button type="button" class="promo-dot ${idx === 0 ? 'active' : ''}" onclick="goToPromoSlide(${idx})"></button>
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
    if (!grid || !currentUser) return;
    grid.innerHTML = '';

    const currentPts = Number(currentUser.points) || 0;
    const filteredRewards = rewardFilterMode === 'can_redeem'
        ? db.rewards.filter(r => currentPts >= Number(r.points_required) && Number(r.stock) > 0)
        : db.rewards;

    if (!filteredRewards.length) {
        grid.innerHTML = `<div class="card-box" style="grid-column: 1 / -1; text-align: center; color: var(--text-muted);">ยังไม่มีรายการของรางวัลที่แลกได้ในขณะนี้ ลองสะสมแต้มเพิ่มอีกนิดนะครับ!</div>`;
        return;
    }

    filteredRewards.forEach(reward => {
        const stock = Number(reward.stock) || 0;
        const ptsReq = Number(reward.points_required) || 0;
        const canRedeem = currentPts >= ptsReq && stock > 0;
        let btnText = 'แลกของรางวัล';
        if (stock <= 0) btnText = 'ของรางวัลหมด';
        else if (currentPts < ptsReq) btnText = 'แต้มไม่เพียงพอ';

        const card = document.createElement('div');
        card.className = 'reward-card';
        card.innerHTML = `
            <img src="${escapeHTML(reward.image)}" alt="${escapeHTML(reward.name)}" class="reward-img" onerror="this.src='https://via.placeholder.com/400x200?text=Reward'">
            <div class="reward-body">
                <div>
                    <span class="reward-badge"><i class="fa-solid fa-coins"></i> ใช้ ${ptsReq} แต้ม</span>
                    <h4 class="reward-title">${escapeHTML(reward.name)}</h4>
                    <p class="reward-desc">${escapeHTML(reward.description)}</p>
                </div>
                <div class="reward-footer">
                    <small class="text-muted">คงเหลือ: ${stock} ชิ้น</small>
                    <button type="button" class="btn ${canRedeem ? 'btn-primary' : 'btn-outline'}" 
                            ${!canRedeem ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''} 
                            onclick="redeemReward(${Number(reward.id)})">
                        ${btnText}
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

async function redeemReward(rewardId) {
    if (!currentUser || isRedeeming) return;
    isRedeeming = true;

    try {
        const ok = await syncFromCloud();
        if (!ok) return;

        const latestUser = db.users.find(u => String(u.id) === String(currentUser.id));
        const reward = db.rewards.find(r => String(r.id) === String(rewardId));
        if (!reward || !latestUser) return;

        const currentPts = Number(latestUser.points) || 0;
        const stock = Number(reward.stock) || 0;
        const ptsReq = Number(reward.points_required) || 0;

        if (stock <= 0) {
            showToast('ขออภัย ของรางวัลรายการนี้หมดแล้ว');
            renderMemberDashboard();
            return;
        }
        if (currentPts < ptsReq) {
            showToast('แต้มสะสมของคุณไม่เพียงพอ');
            renderMemberDashboard();
            return;
        }

        if (!confirm(`ยืนยันการใช้ ${ptsReq} แต้ม เพื่อแลก "${reward.name}" หรือไม่?`)) {
            return;
        }

        const newPoints = currentPts - ptsReq;
        const newStock = stock - 1;

        const ptsUpd = await sb.from('users').update({ points: newPoints }).eq('id', latestUser.id);
        if (ptsUpd.error) {
            showToast('เกิดข้อผิดพลาดในการหักแต้ม กรุณาลองใหม่');
            return;
        }

        const stockUpd = await sb.from('rewards').update({ stock: newStock }).eq('id', reward.id);
        if (stockUpd.error) {
            await sb.from('users').update({ points: currentPts }).eq('id', latestUser.id);
            showToast('เกิดข้อผิดพลาดในการตัดสต็อก ระบบคืนแต้มให้แล้ว');
            return;
        }

        const insertRes = await sb.from('redemptions').insert([{
            user_id: latestUser.id,
            reward_id: reward.id,
            points_spent: ptsReq,
            status: 'approved'
        }]).select().single();

        if (insertRes.error) {
            await Promise.all([
                sb.from('users').update({ points: currentPts }).eq('id', latestUser.id),
                sb.from('rewards').update({ stock }).eq('id', reward.id)
            ]);
            showToast('บันทึกรายการแลกไม่สำเร็จ ระบบคืนแต้มและสต็อกให้แล้ว');
            return;
        }

        await syncFromCloud();
        renderMemberDashboard();
        showToast(`แลก "${reward.name}" สำเร็จ! บันทึกประวัติเรียบร้อยแล้ว`);

        if (insertRes.data) {
            openTicketModal(insertRes.data.id);
        }
    } finally {
        isRedeeming = false;
    }
}

function renderMemberHistory() {
    if (!currentUser) return;
    const earnTbody = document.getElementById('mem-earn-tbody');
    const myEarnings = db.point_history.filter(h => String(h.user_id) === String(currentUser.id));

    earnTbody.innerHTML = myEarnings.length ? myEarnings.map(item => {
        const pts = Number(item.points_earned) || 0;
        const ptsDisplay = pts >= 0
            ? `<strong style="color:var(--success-green);">+${pts} แต้ม</strong>`
            : `<strong style="color:var(--danger-red);">${pts} แต้ม</strong>`;
        return `
            <tr>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${escapeHTML(item.note || 'ซื้อสินค้าภายในร้าน')}</td>
                <td>${(Number(item.amount) || 0).toLocaleString()} บาท</td>
                <td>${ptsDisplay}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="4" style="text-align:center;">ยังไม่มีประวัติการสะสมแต้ม</td></tr>';

    const redeemTbody = document.getElementById('mem-redeem-tbody');
    const myRedemptions = db.redemptions.filter(r => String(r.user_id) === String(currentUser.id));

    redeemTbody.innerHTML = myRedemptions.length ? myRedemptions.map(item => {
        const reward = db.rewards.find(rw => String(rw.id) === String(item.reward_id));
        const statusMap = {
            pending: '<span class="status-pill status-approved">แลกสำเร็จแล้ว</span>',
            approved: '<span class="status-pill status-approved">แลกสำเร็จแล้ว</span>',
            rejected: '<span class="status-pill status-rejected">ยกเลิก (คืนแต้มแล้ว)</span>'
        };

        return `
            <tr>
                <td><strong>${formatTicketCode(item.id)}</strong></td>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${escapeHTML(reward ? reward.name : 'ของรางวัลที่ถูกลบ')}</td>
                <td>-${Number(item.points_spent) || 0} แต้ม</td>
                <td>${statusMap[item.status] || statusMap.approved}</td>
                <td>
                    <button type="button" class="btn btn-outline-sm" onclick="openTicketModal(${Number(item.id)})">
                        <i class="fa-solid fa-image"></i> ดูหลักฐาน
                    </button>
                </td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีประวัติการแลกของรางวัล</td></tr>';

    const spinTbody = document.getElementById('mem-spin-tbody');
    if (spinTbody) {
        const mySpins = db.point_history.filter(h =>
            String(h.user_id) === String(currentUser.id) &&
            String(h.note || '').startsWith('หมุนวงล้อลุ้นโชค')
        );

        spinTbody.innerHTML = mySpins.length ? mySpins.map(item => {
            const parsed = parseSpinHistoryRecord(item);
            const netDisplay = parsed.netDelta > 0
                ? `<strong style="color:var(--success-green);">+${parsed.netDelta} แต้ม</strong>`
                : parsed.netDelta < 0
                    ? `<strong style="color:var(--danger-red);">${parsed.netDelta} แต้ม</strong>`
                    : `<span style="color:var(--text-muted);">0 แต้ม</span>`;

            const rewardBadge = parsed.isNoPrize
                ? `<span class="status-pill status-rejected">${escapeHTML(parsed.prizeLabel)}</span>`
                : `<span class="status-pill status-approved"><i class="fa-solid fa-gift"></i> ${escapeHTML(parsed.prizeLabel)}</span>`;

            return `
                <tr>
                    <td><strong>${formatSpinTicketCode(item.id)}</strong></td>
                    <td>${formatDateTime(item.created_at)}</td>
                    <td>${rewardBadge}</td>
                    <td>${parsed.cost} แต้ม</td>
                    <td>${netDisplay}</td>
                    <td>
                        <button type="button" class="btn btn-outline-sm" onclick="openSpinTicketModal(${Number(item.id)})">
                            <i class="fa-solid fa-ticket"></i> ดูหลักฐาน
                        </button>
                    </td>
                </tr>
            `;
        }).join('') : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีประวัติการหมุนวงล้อ</td></tr>';
    }
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

    btnElement?.classList.add('active');
    document.getElementById(`admin-tab-${tabName}`)?.classList.add('active');

    await syncFromCloud();
    renderAdminDashboard();

    if (tabName === 'pos') {
        focusPOSBarcodeInput();
    }
}

function renderAdminDashboard() {
    const members = db.users.filter(u => u.role === 'member');
    const totalPointsGiven = db.point_history
        .filter(h => (Number(h.points_earned) || 0) > 0)
        .reduce((sum, h) => sum + (Number(h.points_earned) || 0), 0);
    const totalSales = db.point_history.reduce((sum, h) => sum + (Number(h.amount) || 0), 0);

    document.getElementById('stat-total-members').textContent = members.length.toLocaleString();
    document.getElementById('stat-total-points').textContent = totalPointsGiven.toLocaleString();
    document.getElementById('stat-total-redemptions').textContent = db.redemptions.length.toLocaleString();
    document.getElementById('stat-total-sales').textContent = totalSales.toLocaleString();

    document.getElementById('setting-baht-per-point').value = db.settings.baht_per_point;

    renderSpinSettingsForm();
    renderPOSMemberSelect();
    renderRecentPOS();
    renderAdminRedemptions();
    renderAdminSpinHistory();
    renderAdminPromotions();
    renderAdminMembers();
    renderAdminRewards();
    renderAdminReports();
}

// --- ตั้งค่ารางวัลในวงล้อลุ้นแต้ม (Admin) ---
function updateSpinWeightSummary() {
    let total = 0;
    for (let i = 0; i < 6; i++) {
        total += Math.max(0, Number(document.getElementById(`spin-weight-${i}`)?.value) || 0);
    }
    const badge = document.getElementById('spin-total-weight-badge');
    if (!badge) return;

    badge.textContent = `ผลรวมโอกาสออกรางวัล: ${total}%`;
    if (total === 100) {
        badge.style.background = '#DCFCE7';
        badge.style.color = '#166534';
    } else {
        badge.style.background = '#FEE2E2';
        badge.style.color = '#991B1B';
    }
}

function resetSpinSettingsDefault() {
    if (!confirm('ต้องการคืนค่าการตั้งค่าวงล้อกลับเป็นค่าเริ่มต้นหรือไม่?')) return;
    document.getElementById('spin-cfg-enabled').value = '1';
    document.getElementById('spin-cfg-cost').value = DEFAULT_SPIN_CONFIG.cost;
    for (let i = 0; i < 6; i++) {
        const lblEl = document.getElementById(`spin-label-${i}`);
        if (lblEl) lblEl.value = DEFAULT_SPIN_CONFIG.labels[i];
        document.getElementById(`spin-prize-${i}`).value = DEFAULT_SPIN_CONFIG.prizes[i];
        document.getElementById(`spin-weight-${i}`).value = DEFAULT_SPIN_CONFIG.weights[i];
    }
    updateSpinWeightSummary();
    showToast('คืนค่าเริ่มต้นในฟอร์มแล้ว กด "บันทึกการตั้งค่าวงล้อ" เพื่อยืนยัน');
}

function renderSpinSettingsForm() {
    const cfg = db.settings.spin_config || DEFAULT_SPIN_CONFIG;
    const labels = cfg.labels || cfg.prizes.map(p => (p > 0 ? `+${p} แต้ม` : 'ไม่ได้แต้ม'));
    const enabledEl = document.getElementById('spin-cfg-enabled');
    const costEl = document.getElementById('spin-cfg-cost');
    if (enabledEl) enabledEl.value = cfg.enabled ? '1' : '0';
    if (costEl) costEl.value = cfg.cost;

    for (let i = 0; i < 6; i++) {
        const labelInput = document.getElementById(`spin-label-${i}`);
        const prizeInput = document.getElementById(`spin-prize-${i}`);
        const weightInput = document.getElementById(`spin-weight-${i}`);
        if (labelInput) labelInput.value = labels[i] ?? '';
        if (prizeInput) prizeInput.value = cfg.prizes[i];
        if (weightInput) weightInput.value = cfg.weights[i];
    }
    updateSpinWeightSummary();
}

async function handleSaveSpinSettings(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-spin-cfg');
    const enabled = document.getElementById('spin-cfg-enabled').value === '1';
    const cost = Math.max(0, parseInt(document.getElementById('spin-cfg-cost').value, 10) || 0);

    const labels = [];
    const prizes = [];
    const weights = [];
    let totalWeight = 0;

    for (let i = 0; i < 6; i++) {
        const prizeVal = Math.max(0, parseInt(document.getElementById(`spin-prize-${i}`).value, 10) || 0);
        const rawLabel = (document.getElementById(`spin-label-${i}`)?.value || '').trim();
        const labelVal = rawLabel || (prizeVal > 0 ? `+${prizeVal} แต้ม` : 'ไม่ได้แต้ม');
        const weightVal = Math.max(0, parseFloat(document.getElementById(`spin-weight-${i}`).value) || 0);

        labels.push(labelVal);
        prizes.push(prizeVal);
        weights.push(weightVal);
        totalWeight += weightVal;
    }

    if (totalWeight !== 100) {
        showToast(`ผลรวมโอกาสออกรางวัลทั้ง 6 ช่องต้องเท่ากับ 100% (ปัจจุบันรวมได้ ${totalWeight}%)`);
        return;
    }

    const newConfig = { enabled, cost, labels, prizes, weights };

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';

    const { error } = await sb.from('settings').upsert({
        setting_key: 'lucky_spin_config',
        setting_value: JSON.stringify(newConfig)
    }, { onConflict: 'setting_key' });

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกการตั้งค่าวงล้อ';

    if (error) {
        console.error('Save spin settings error:', error);
        showToast('บันทึกไม่สำเร็จ: กรุณาตรวจสอบสิทธิ์ตาราง settings ใน Supabase');
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
        `<option value="${escapeHTML(m.student_id || m.username)} | ${escapeHTML(m.full_name)}">มี ${Number(m.points) || 0} แต้ม</option>`
    ).join('');
}

function handlePOSMemberSearch(fromScannerEnter = false) {
    const searchInput = document.getElementById('pos-member-search');
    const input = (searchInput?.value || '').trim();
    const hiddenId = document.getElementById('pos-selected-user-id');
    const statusBox = document.getElementById('pos-member-status');

    const rawKeyword = input.split('|')[0].trim().toLowerCase();
    const cleanDigits = rawKeyword.replace(/\D/g, '');

    const found = db.users.find(u => {
        if (u.role !== 'member') return false;
        const dbPhone = String(u.student_id || '').replace(/\D/g, '');
        return (
            (cleanDigits !== '' && dbPhone === cleanDigits) ||
            (u.student_id && String(u.student_id).toLowerCase() === rawKeyword) ||
            String(u.username || '').toLowerCase() === rawKeyword ||
            `${u.student_id || u.username} | ${u.full_name}`.toLowerCase() === input.toLowerCase()
        );
    });

    if (found) {
        hiddenId.value = found.id;
        const pts = Number(found.points) || 0;
        const tier = getMemberTierInfo(found.id, pts);
        statusBox.innerHTML = `
            <div style="background: #DCFCE7; border: 1.5px solid #16A34A; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="font-size: 12px; color: #166534; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> พบข้อมูลสมาชิก (${escapeHTML(tier.name)})</span>
                    <div style="font-size: 16px; font-weight: 700; color: #0F172A;">${escapeHTML(found.full_name)}</div>
                    <small style="color: #334155;">เบอร์โทร: ${escapeHTML(found.student_id || '-')}</small>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 11px; color: #166534;">แต้มสะสม</span>
                    <div style="font-size: 22px; font-weight: 700; color: #1E3A8A;">${pts.toLocaleString()}</div>
                </div>
            </div>
        `;

        if (fromScannerEnter || (cleanDigits.length === 10 && String(found.student_id).replace(/\D/g, '') === cleanDigits)) {
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
    const rate = Math.max(1, parseInt(db.settings.baht_per_point, 10) || 20);
    const earned = amount > 0 ? Math.floor(amount / rate) : 0;
    document.getElementById('pos-preview-points').textContent = `${earned} แต้ม`;
}

async function handleRecordPurchase(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-pos-submit');
    const userId = document.getElementById('pos-selected-user-id').value;
    const amount = parseFloat(document.getElementById('pos-amount').value);
    const note = document.getElementById('pos-note').value.trim();

    if (!userId) {
        showToast('ไม่พบข้อมูลสมาชิก กรุณายิงบาร์โค้ดหรือเลือกจากรายการ');
        focusPOSBarcodeInput();
        return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
        showToast('กรุณากรอกยอดซื้อให้ถูกต้อง');
        return;
    }

    if (btn) btn.disabled = true;

    try {
        const ok = await syncFromCloud();
        if (!ok) return;

        const member = db.users.find(u => String(u.id) === String(userId));
        if (!member) {
            showToast('ไม่พบข้อมูลสมาชิกในระบบ');
            return;
        }

        const rate = Math.max(1, parseInt(db.settings.baht_per_point, 10) || 20);
        const pointsEarned = Math.floor(amount / rate);
        const newPoints = (Number(member.points) || 0) + pointsEarned;

        const [updRes, insRes] = await Promise.all([
            sb.from('users').update({ points: newPoints }).eq('id', member.id),
            sb.from('point_history').insert([{
                user_id: member.id,
                amount: amount,
                points_earned: pointsEarned,
                note: note || 'ซื้อสินค้าหน้าร้าน'
            }])
        ]);

        if (updRes.error || insRes.error) {
            showToast('เกิดข้อผิดพลาดในการบันทึกยอดซื้อ');
            return;
        }

        e.target.reset();
        document.getElementById('pos-selected-user-id').value = '';
        document.getElementById('pos-member-status').innerHTML = '';
        document.getElementById('pos-preview-points').textContent = '0 แต้ม';

        await syncFromCloud();
        renderAdminDashboard();
        showToast(`บันทึกยอดซื้อ ${amount} บาท ให้คุณ ${member.full_name} (+${pointsEarned} แต้ม)`);
        focusPOSBarcodeInput();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleUpdateRate(e) {
    e.preventDefault();
    const newRate = parseInt(document.getElementById('setting-baht-per-point').value, 10);
    if (!Number.isFinite(newRate) || newRate < 1) {
        showToast('กรุณากรอกอัตราบาทต่อแต้มตั้งแต่ 1 ขึ้นไป');
        return;
    }

    const { error } = await sb.from('settings').upsert({ setting_key: 'baht_per_point', setting_value: String(newRate) });
    if (error) {
        showToast('บันทึกอัตราคำนวณแต้มไม่สำเร็จ');
        return;
    }

    await syncFromCloud();
    calculatePreviewPoints();
    showToast(`อัปเดตอัตราคำนวณแต้มเป็น ทุก ${newRate} บาท = 1 แต้ม`);
}

function renderRecentPOS() {
    const tbody = document.getElementById('admin-recent-pos-tbody');
    if (!tbody) return;
    const recent = db.point_history.filter(h => (Number(h.amount) || 0) > 0).slice(0, 5);
    tbody.innerHTML = recent.map(item => {
        const user = db.users.find(u => String(u.id) === String(item.user_id));
        return `
            <tr>
                <td>${escapeHTML(user ? user.full_name : 'ไม่พบข้อมูล')}</td>
                <td>${(Number(item.amount) || 0).toLocaleString()} ฿</td>
                <td><strong>+${Number(item.points_earned) || 0}</strong></td>
            </tr>
        `;
    }).join('');
}

// --- ส่วนแสดงประวัติการแลกของรางวัลอัตโนมัติ ---
function renderAdminRedemptions() {
    const tbody = document.getElementById('admin-redemptions-tbody');
    if (!tbody) return;
    tbody.innerHTML = db.redemptions.length ? db.redemptions.map(item => {
        const user = db.users.find(u => String(u.id) === String(item.user_id));
        const reward = db.rewards.find(r => String(r.id) === String(item.reward_id));

        const statusBadge = item.status === 'rejected'
            ? '<span class="status-pill status-rejected">ยกเลิกแล้ว</span>'
            : '<span class="status-pill status-approved">แลกสำเร็จอัตโนมัติ</span>';

        return `
            <tr>
                <td><strong>${formatTicketCode(item.id)}</strong></td>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${user ? `${escapeHTML(user.full_name)} (${escapeHTML(user.student_id || '-')})` : 'ไม่พบสมาชิก'}</td>
                <td>${escapeHTML(reward ? reward.name : 'ไม่พบของรางวัล')}</td>
                <td>${Number(item.points_spent) || 0} แต้ม</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีประวัติการแลกของรางวัล</td></tr>';
}

// --- ส่วนแสดงประวัติการหมุนวงล้อและรางวัลวงล้อทั้งหมด (Admin) ---
function renderAdminSpinHistory() {
    const tbody = document.getElementById('admin-spins-tbody');
    const kpiBox = document.getElementById('admin-spin-kpi');
    if (!tbody) return;

    const allSpins = db.point_history.filter(h => String(h.note || '').startsWith('หมุนวงล้อลุ้นโชค'));

    if (kpiBox) {
        let totalCost = 0;
        let totalNetDelta = 0;
        allSpins.forEach(item => {
            const p = parseSpinHistoryRecord(item);
            totalCost += p.cost;
            totalNetDelta += p.netDelta;
        });
        const totalPointsAwarded = totalNetDelta + totalCost;

        kpiBox.innerHTML = `
            <div class="report-kpi-box">
                <span>จำนวนการหมุนวงล้อทั้งหมด</span>
                <strong>${allSpins.length.toLocaleString()} ครั้ง</strong>
                <small>สะสมตั้งแต่เปิดใช้งาน</small>
            </div>
            <div class="report-kpi-box">
                <span>แต้มที่สมาชิกใช้หมุนรวม</span>
                <strong style="color: #D97706;">${totalCost.toLocaleString()} แต้ม</strong>
                <small>หักจากกระเป๋าสมาชิก</small>
            </div>
            <div class="report-kpi-box">
                <span>แต้มรางวัลที่แจกออกรวม</span>
                <strong style="color: #16A34A;">+${Math.max(0, totalPointsAwarded).toLocaleString()} แต้ม</strong>
                <small>รวมรางวัลแต้มจากวงล้อ</small>
            </div>
        `;
    }

    const keyword = (document.getElementById('admin-spin-search')?.value || '').toLowerCase().trim();
    const filteredSpins = allSpins.filter(item => {
        if (!keyword) return true;
        const user = db.users.find(u => String(u.id) === String(item.user_id));
        const parsed = parseSpinHistoryRecord(item);
        const ticketCode = formatSpinTicketCode(item.id).toLowerCase();
        return (
            ticketCode.includes(keyword) ||
            parsed.prizeLabel.toLowerCase().includes(keyword) ||
            (user && (
                String(user.full_name || '').toLowerCase().includes(keyword) ||
                String(user.student_id || '').toLowerCase().includes(keyword)
            ))
        );
    });

    tbody.innerHTML = filteredSpins.length ? filteredSpins.map(item => {
        const user = db.users.find(u => String(u.id) === String(item.user_id));
        const parsed = parseSpinHistoryRecord(item);

        const netDisplay = parsed.netDelta > 0
            ? `<strong style="color:var(--success-green);">+${parsed.netDelta} แต้ม</strong>`
            : parsed.netDelta < 0
                ? `<strong style="color:var(--danger-red);">${parsed.netDelta} แต้ม</strong>`
                : `<span style="color:var(--text-muted);">0 แต้ม</span>`;

        const rewardBadge = parsed.isNoPrize
            ? `<span class="status-pill status-rejected">${escapeHTML(parsed.prizeLabel)}</span>`
            : `<span class="status-pill status-approved"><i class="fa-solid fa-trophy"></i> ${escapeHTML(parsed.prizeLabel)}</span>`;

        return `
            <tr>
                <td><strong>${formatSpinTicketCode(item.id)}</strong></td>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${user ? `${escapeHTML(user.full_name)} (${escapeHTML(user.student_id || '-')})` : 'ไม่พบสมาชิก'}</td>
                <td>${rewardBadge}</td>
                <td>${parsed.cost} แต้ม</td>
                <td>${netDisplay}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center;">ไม่พบประวัติการหมุนวงล้อ</td></tr>';
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
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
            processUploadedImage(e.dataTransfer.files[0], prefix);
        }
    };
    fileInput.onchange = (e) => {
        if (e.target && e.target.files && e.target.files[0]) {
            processUploadedImage(e.target.files[0], prefix);
        }
    };
}

function processUploadedImage(file, prefix) {
    if (!file.type || !file.type.startsWith('image/')) {
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
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, width, height);

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
            <img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.title)}" class="reward-img" onerror="this.src='https://via.placeholder.com/400x200?text=Banner'">
            <div class="reward-body">
                <div>
                    <span class="reward-badge">${escapeHTML(p.badge)} | ${p.is_active ? 'กำลังแสดง' : 'ซ่อนอยู่'}</span>
                    <h4 class="reward-title">${escapeHTML(p.title)}</h4>
                    <p class="reward-desc">${escapeHTML(p.description)}</p>
                </div>
                <div class="reward-footer">
                    <button type="button" class="btn btn-outline-sm" onclick="openPromoModal(${Number(p.id)})">
                        <i class="fa-solid fa-pen"></i> แก้ไข
                    </button>
                    <button type="button" class="btn btn-danger" onclick="deletePromotion(${Number(p.id)})">
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
        const p = db.promotions.find(item => String(item.id) === String(promoId));
        if (!p) return;
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
    modal?.classList.remove('hidden');
}

async function savePromotion(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-promo');
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

    if (btn) btn.disabled = true;

    try {
        if (id) {
            const { error } = await sb.from('promotions').update({ badge, title, description, image, is_active }).eq('id', parseInt(id, 10));
            if (error) {
                showToast('อัปเดตแบนเนอร์ไม่สำเร็จ');
                return;
            }
            showToast('อัปเดตแบนเนอร์โปรโมชั่นเรียบร้อยแล้ว');
        } else {
            const { error } = await sb.from('promotions').insert([{ badge, title, description, image, is_active }]);
            if (error) {
                showToast('เพิ่มแบนเนอร์ไม่สำเร็จ');
                return;
            }
            showToast('เพิ่มแบนเนอร์โปรโมชั่นใหม่เรียบร้อยแล้ว');
        }

        closeModal('promo-modal');
        await syncFromCloud();
        renderAdminDashboard();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deletePromotion(promoId) {
    if (!confirm('ยืนยันการลบแบนเนอร์โปรโมชั่นนี้หรือไม่?')) return;
    const { error } = await sb.from('promotions').delete().eq('id', promoId);
    if (error) {
        showToast('ลบแบนเนอร์ไม่สำเร็จ');
        return;
    }
    await syncFromCloud();
    renderAdminDashboard();
    showToast('ลบแบนเนอร์โปรโมชั่นเรียบร้อยแล้ว');
}

// --- ส่วนจัดการสมาชิก (CRUD + Audit Log บันทึกประวัติแก้แต้ม) ---
function renderAdminMembers() {
    const keyword = (document.getElementById('member-search')?.value || '').toLowerCase().trim();
    const tbody = document.getElementById('admin-members-tbody');
    if (!tbody) return;

    const members = db.users.filter(u =>
        u.role === 'member' &&
        (String(u.full_name || '').toLowerCase().includes(keyword) ||
         (u.student_id && String(u.student_id).toLowerCase().includes(keyword)) ||
         String(u.username || '').toLowerCase().includes(keyword))
    );

    tbody.innerHTML = members.length ? members.map(m => {
        const pts = Number(m.points) || 0;
        const tier = getMemberTierInfo(m.id, pts);
        return `
            <tr>
                <td>${escapeHTML(m.student_id || '-')}</td>
                <td>${escapeHTML(m.full_name)}</td>
                <td><span class="tier-pill ${tier.cssClass}">${escapeHTML(tier.name)}</span></td>
                <td><strong>${pts.toLocaleString()}</strong> แต้ม</td>
                <td>
                    <button type="button" class="btn btn-outline-sm" onclick="openMemberModal(${Number(m.id)})">
                        <i class="fa-solid fa-pen"></i> แก้ไข
                    </button>
                    <button type="button" class="btn btn-danger" onclick="deleteMember(${Number(m.id)})">
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
        const m = db.users.find(u => String(u.id) === String(memberId));
        if (!m) return;
        title.textContent = 'แก้ไขข้อมูลสมาชิก';
        document.getElementById('edit-member-id').value = m.id;
        document.getElementById('modal-mem-studentid').value = m.student_id || '';
        document.getElementById('modal-mem-fullname').value = m.full_name;
        document.getElementById('modal-mem-password').value = m.password;
        document.getElementById('modal-mem-points').value = Number(m.points) || 0;
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
    modal?.classList.remove('hidden');
}

async function saveMember(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-member');
    const id = document.getElementById('edit-member-id').value;
    const phone = document.getElementById('modal-mem-studentid').value.replace(/\D/g, '');
    const fullName = document.getElementById('modal-mem-fullname').value.trim().replace(/\s+/g, ' ');
    const username = fullName;
    const password = document.getElementById('modal-mem-password').value.trim();
    const rawPoints = parseInt(document.getElementById('modal-mem-points').value, 10);
    const points = Math.max(0, Number.isFinite(rawPoints) ? rawPoints : 0);
    const reason = (document.getElementById('modal-mem-reason')?.value || '').trim();

    if (!fullName) {
        showToast('กรุณากรอกชื่อ-นามสกุล');
        return;
    }

    if (phone.length < 9 || phone.length > 10) {
        showToast('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)');
        return;
    }

    if (btn) btn.disabled = true;

    try {
        const ok = await syncFromCloud();
        if (!ok) return;

        const isNameDuplicate = db.users.some(u =>
            String(u.id) !== String(id) &&
            ((u.username && u.username.trim().replace(/\s+/g, ' ').toLowerCase() === username.toLowerCase()) ||
             (u.full_name && u.full_name.trim().replace(/\s+/g, ' ').toLowerCase() === fullName.toLowerCase()))
        );

        if (isNameDuplicate) {
            showToast('ไม่สามารถบันทึกได้: ชื่อ-นามสกุลนี้ซ้ำกับสมาชิกอื่นในระบบ');
            return;
        }

        const isPhoneDuplicate = db.users.some(u =>
            String(u.id) !== String(id) &&
            (u.student_id && String(u.student_id).replace(/\D/g, '') === phone)
        );

        if (isPhoneDuplicate) {
            showToast('ไม่สามารถบันทึกได้: เบอร์โทรศัพท์นี้ซ้ำกับสมาชิกอื่นในระบบ');
            return;
        }

        if (id) {
            const oldMember = db.users.find(u => String(u.id) === String(id));
            const oldPoints = oldMember ? (Number(oldMember.points) || 0) : 0;
            const pointDiff = points - oldPoints;

            const { error } = await sb.from('users').update({
                student_id: phone,
                full_name: fullName,
                username,
                password,
                points
            }).eq('id', oldMember ? oldMember.id : id);

            if (error) {
                showToast('เกิดข้อผิดพลาดในการแก้ไขข้อมูล');
                return;
            }

            if (pointDiff !== 0) {
                const sign = pointDiff > 0 ? `+${pointDiff}` : `${pointDiff}`;
                await sb.from('point_history').insert([{
                    user_id: oldMember ? oldMember.id : id,
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
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteMember(memberId) {
    if (!confirm('ยืนยันการลบสมาชิกคนนี้หรือไม่? ประวัติที่เกี่ยวข้องจะถูกลบทั้งหมด')) return;
    const { error } = await sb.from('users').delete().eq('id', memberId);
    if (error) {
        showToast('ลบข้อมูลสมาชิกไม่สำเร็จ');
        return;
    }
    await syncFromCloud();
    renderAdminDashboard();
    showToast('ลบข้อมูลสมาชิกเรียบร้อยแล้ว');
}

// --- ส่วนจัดการของรางวัล (CRUD) ---
function renderAdminRewards() {
    const grid = document.getElementById('admin-rewards-grid');
    if (!grid) return;
    grid.innerHTML = db.rewards.map(r => `
        <div class="reward-card">
            <img src="${escapeHTML(r.image)}" alt="${escapeHTML(r.name)}" class="reward-img" onerror="this.src='https://via.placeholder.com/400x200?text=Reward'">
            <div class="reward-body">
                <div>
                    <span class="reward-badge">${Number(r.points_required) || 0} แต้ม | คงเหลือ ${Number(r.stock) || 0} ชิ้น</span>
                    <h4 class="reward-title">${escapeHTML(r.name)}</h4>
                    <p class="reward-desc">${escapeHTML(r.description)}</p>
                </div>
                <div class="reward-footer">
                    <button type="button" class="btn btn-outline-sm" onclick="openRewardModal(${Number(r.id)})">
                        <i class="fa-solid fa-pen"></i> แก้ไข
                    </button>
                    <button type="button" class="btn btn-danger" onclick="deleteReward(${Number(r.id)})">
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
        const r = db.rewards.find(rw => String(rw.id) === String(rewardId));
        if (!r) return;
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
    modal?.classList.remove('hidden');
}

async function saveReward(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-reward');
    const id = document.getElementById('edit-reward-id').value;
    const name = document.getElementById('modal-rew-name').value.trim();
    const description = document.getElementById('modal-rew-desc').value.trim();
    const pointsRequired = Math.max(1, parseInt(document.getElementById('modal-rew-points').value, 10) || 1);
    const stock = Math.max(0, parseInt(document.getElementById('modal-rew-stock').value, 10) || 0);
    const image = document.getElementById('modal-rew-image').value.trim();

    if (!image) {
        showToast('กรุณาอัปโหลดรูปภาพของรางวัลก่อนบันทึก');
        return;
    }

    if (btn) btn.disabled = true;

    try {
        if (id) {
            const { error } = await sb.from('rewards').update({
                name,
                description,
                points_required: pointsRequired,
                stock,
                image
            }).eq('id', parseInt(id, 10));
            if (error) {
                showToast('แก้ไขข้อมูลของรางวัลไม่สำเร็จ');
                return;
            }
            showToast('แก้ไขข้อมูลของรางวัลเรียบร้อยแล้ว');
        } else {
            const { error } = await sb.from('rewards').insert([{
                name,
                description,
                points_required: pointsRequired,
                stock,
                image
            }]);
            if (error) {
                showToast('เพิ่มของรางวัลไม่สำเร็จ');
                return;
            }
            showToast('เพิ่มของรางวัลใหม่เรียบร้อยแล้ว');
        }

        closeModal('reward-modal');
        await syncFromCloud();
        renderAdminDashboard();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteReward(rewardId) {
    if (!confirm('ยืนยันการลบของรางวัลรายการนี้หรือไม่?')) return;
    const { error } = await sb.from('rewards').delete().eq('id', rewardId);
    if (error) {
        showToast('ลบของรางวัลไม่สำเร็จ (อาจมีประวัติการแลกอ้างอิงอยู่)');
        return;
    }
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
        return getLocalDateKey(isoString) === getLocalDateKey(now.toISOString());
    } else if (reportPeriod === 'week') {
        const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        return d >= sevenDaysAgo && d <= endOfToday;
    } else if (reportPeriod === 'month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    return true;
}

function renderAdminReports() {
    const container = document.getElementById('report-summary-content');
    if (!container) return;

    const periodNames = {
        today: 'วันนี้',
        week: '7 วันล่าสุด',
        month: 'เดือนนี้',
        all: 'ทั้งหมด'
    };

    const filteredHistory = db.point_history.filter(h => isInSelectedPeriod(h.created_at));
    const filteredRedemptions = db.redemptions.filter(r => isInSelectedPeriod(r.created_at));

    const periodSales = filteredHistory.reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
    const periodOrders = filteredHistory.filter(h => (Number(h.amount) || 0) > 0).length;
    const periodPointsGiven = filteredHistory
        .filter(h => (Number(h.points_earned) || 0) > 0)
        .reduce((sum, h) => sum + (Number(h.points_earned) || 0), 0);
    const periodRedeemedCount = filteredRedemptions.length;

    const members = db.users.filter(u => u.role === 'member');
    const topMembers = [...members].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0)).slice(0, 5);

    const auditLogs = db.point_history
        .filter(h => h.note && String(h.note).startsWith('[แอดมินปรับแต้ม'))
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
                            const pts = Number(m.points) || 0;
                            const tier = getMemberTierInfo(m.id, pts);
                            return `
                                <tr>
                                    <td>#${idx + 1}</td>
                                    <td>${escapeHTML(m.student_id || '-')}</td>
                                    <td>${escapeHTML(m.full_name)}</td>
                                    <td><span class="tier-pill ${tier.cssClass}">${escapeHTML(tier.name)}</span></td>
                                    <td><strong>${pts.toLocaleString()} แต้ม</strong></td>
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
                            const user = db.users.find(u => String(u.id) === String(log.user_id));
                            const pts = Number(log.points_earned) || 0;
                            return `
                                <tr>
                                    <td>${formatDateTime(log.created_at)}</td>
                                    <td>${user ? `${escapeHTML(user.full_name)} (${escapeHTML(user.student_id || '-')})` : 'ไม่พบสมาชิก'}</td>
                                    <td><strong style="color: ${pts >= 0 ? 'var(--success-green)' : 'var(--danger-red)'};">${pts >= 0 ? '+' + pts : pts} แต้ม</strong></td>
                                    <td>${escapeHTML(log.note)}</td>
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
        const pts = Number(m.points) || 0;
        const tier = getMemberTierInfo(m.id, pts);
        const safeName = String(m.full_name || '').replace(/"/g, '""');
        const safePhone = String(m.student_id || '-').replace(/"/g, '""');
        csv += `"${safePhone}","${safeName}","${tier.name}",${pts}\n`;
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
    document.getElementById(modalId)?.classList.add('hidden');
}

// ปิด Modal เมื่อกดปุ่ม ESC หรือคลิกพื้นที่สีดำด้านนอกกรอบ Modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
});

document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal')) {
        e.target.classList.add('hidden');
    }
});

// ==========================================================
// ระบบซิงก์ข้อมูลอัตโนมัติแบบเรียลไทม์ (Supabase Realtime)
// ==========================================================
function startRealtimeSync() {
    if (realtimeChannel) return;

    realtimeChannel = sb.channel('muk-rcheewa-live')
        .on('postgres_changes', { event: '*', schema: 'public' }, async (payload) => {
            if (!currentUser) return;

            const oldPoints = Number(currentUser.points) || 0;
            const ok = await syncFromCloud();
            if (!ok) return;

            if (currentUser.role === 'admin') {
                renderAdminDashboard();
                if (payload.table === 'redemptions' && payload.eventType === 'INSERT' && payload.new) {
                    const buyer = db.users.find(u => String(u.id) === String(payload.new.user_id));
                    const rw = db.rewards.find(r => String(r.id) === String(payload.new.reward_id));

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
                        const AudioCtx = window.AudioContext || window.webkitAudioContext;
                        if (AudioCtx) {
                            const ctx = new AudioCtx();
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
                        }
                    } catch (e) {}
                }
            } else {
                renderMemberDashboard();
                const updatedUser = db.users.find(u => String(u.id) === String(currentUser.id));
                const newPts = updatedUser ? (Number(updatedUser.points) || 0) : oldPoints;
                if (updatedUser && newPts > oldPoints) {
                    const diff = newPts - oldPoints;
                    showToast(`คุณได้รับเพิ่ม +${diff} แต้ม!`);
                }
            }
        })
        .subscribe();
}

// เริ่มทำงานทันทีที่เปิดหน้าเว็บ: กู้คืนสถานะล็อกอิน + ซิงก์เรียลไทม์
restoreSession();
startRealtimeSync();
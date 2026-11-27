/* ==========================================================
   ระบบบริหารจัดการแต้มสมาชิกดิจิทัล ร้านมักอาชีวะ (Supabase Cloud)
   ========================================================== */

const SUPABASE_URL = 'https://zswuxvtrdmlhbrhuxpjk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpzd3V4dnRyZG1saGJyaHV4cGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2ODk3NTcsImV4cCI6MjA4ODI2NTc1N30.XEQf07R3n-x2Q-Q1a9K--G29Y5cE0X-W2R7G8v8dG5A';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let appState = {
    currentUser: null,
    users: [],
    rewards: [],
    promotions: [],
    earnHistory: [],
    redeemHistory: [],
    auditLogs: [],
    settings: { bahtPerPoint: 20 }
};

let promoSlideIndex = 0;
let promoAutoTimer = null;
let rewardFilter = 'all';
let reportPeriod = 'today';

const SLOT_COLORS = ['#FACC15', '#3B82F6', '#16A34A', '#F97316', '#8B5CF6', '#EF4444'];

const DEFAULT_SPIN_CONFIG = {
    enabled: true,
    cost: 3,
    slots: [
        { label: '+1 แต้ม', points: 1, weight: 35 },
        { label: '+2 แต้ม', points: 2, weight: 28 },
        { label: '+5 แต้ม', points: 5, weight: 15 },
        { label: '0 แต้ม', points: 0, weight: 12 },
        { label: '+10 แต้ม', points: 10, weight: 7 },
        { label: '+15 แต้ม', points: 15, weight: 3 }
    ]
};

let spinConfig = JSON.parse(JSON.stringify(DEFAULT_SPIN_CONFIG));
let currentWheelRotation = 0;
let isWheelSpinning = false;
let isCheckinBusy = false;

// ตารางรางวัล Daily Login 30 วัน (5x6 ช่อง)
const DAILY_LOGIN_30_REWARDS = Array.from({ length: 30 }, (_, idx) => {
    const day = idx + 1;
    if (day === 30) return { day, points: 10, icon: '👑', isBonus: true };
    if (day === 20 || day === 25) return { day, points: 5, icon: '🏆', isBonus: true };
    if (day === 10 || day === 15) return { day, points: 3, icon: '🎁', isBonus: true };
    if (day === 5) return { day, points: 2, icon: '✨', isBonus: true };
    return { day, points: 1, icon: '🪙', isBonus: false };
});

/* ==========================================================
   1. ฟังก์ชันช่วยเหลือพื้นฐาน & การดึงข้อมูลจาก Supabase
   ========================================================== */
function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-bell"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function formatDate(isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return d.toLocaleDateString('th-TH', {
        year: '2-digit', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function getLocalDateStr(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getMonthPrefix(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function renderBarcodeSafe(selector, value, options = {}) {
    const el = document.querySelector(selector);
    if (!el || !value) return;
    el.innerHTML = '';
    if (typeof JsBarcode === 'function') {
        try {
            JsBarcode(el, String(value), {
                format: 'CODE128',
                lineColor: '#0F172A',
                background: '#FFFFFF',
                width: options.width || 2,
                height: options.height || 44,
                displayValue: options.displayValue !== undefined ? options.displayValue : true,
                fontSize: options.fontSize || 13,
                font: 'Prompt',
                margin: 2
            });
        } catch (e) {
            console.warn('Barcode render error:', e);
        }
    }
}

function calculateMemberTier(userId) {
    const totalEarned = appState.earnHistory
        .filter(e => String(e.userId) === String(userId) && Number(e.pointsEarned) > 0)
        .reduce((sum, e) => sum + Number(e.pointsEarned), 0);

    if (totalEarned >= 150) {
        return { name: 'GOLD', cssClass: 'tier-gold', icon: 'fa-crown', totalEarned, nextText: `สะสมรวม ${totalEarned} แต้ม (ระดับสูงสุด)` };
    }
    if (totalEarned >= 50) {
        return { name: 'SILVER', cssClass: 'tier-silver', icon: 'fa-gem', totalEarned, nextText: `อีก ${150 - totalEarned} แต้ม ขึ้นระดับ GOLD` };
    }
    return { name: 'MEMBER', cssClass: 'tier-member', icon: 'fa-medal', totalEarned, nextText: `อีก ${50 - totalEarned} แต้ม ขึ้นระดับ SILVER` };
}

async function syncAllDataFromCloud() {
    try {
        const [
            { data: settingsData },
            { data: usersData },
            { data: rewardsData },
            { data: promosData },
            { data: earnData },
            { data: redeemData }
        ] = await Promise.all([
            sb.from('settings').select('*').eq('id', 1).single(),
            sb.from('users').select('*').order('id', { ascending: true }),
            sb.from('rewards').select('*').order('points_required', { ascending: true }),
            sb.from('promotions').select('*').order('id', { ascending: false }),
            sb.from('earn_history').select('*').order('created_at', { ascending: false }),
            sb.from('redeem_history').select('*').order('created_at', { ascending: false })
        ]);

        if (settingsData) {
            appState.settings.bahtPerPoint = settingsData.baht_per_point || 20;
            if (settingsData.spin_config && Array.isArray(settingsData.spin_config.slots)) {
                spinConfig = settingsData.spin_config;
            }
        }

        if (usersData) {
            appState.users = usersData.map(u => ({
                id: u.id,
                username: u.username,
                password: u.password,
                fullName: u.full_name,
                studentId: u.student_id,
                role: u.role,
                points: u.points
            }));
        }

        if (rewardsData) {
            appState.rewards = rewardsData.map(r => ({
                id: r.id,
                name: r.name,
                desc: r.description,
                pointsRequired: r.points_required,
                stock: r.stock,
                image: r.image
            }));
        }

        if (promosData) {
            appState.promotions = promosData.map(p => ({
                id: p.id,
                badge: p.badge,
                title: p.title,
                desc: p.description,
                image: p.image
            }));
        }

        if (earnData) {
            appState.earnHistory = earnData.map(e => ({
                id: e.id,
                userId: e.user_id,
                userName: e.user_name,
                amount: Number(e.amount),
                pointsEarned: e.points_earned,
                note: e.note,
                createdAt: e.created_at
            }));
        }

        if (redeemData) {
            appState.redeemHistory = redeemData.map(r => ({
                id: r.id,
                refCode: r.ref_code,
                userId: r.user_id,
                userName: r.user_name,
                rewardId: r.reward_id,
                rewardName: r.reward_name,
                pointsUsed: r.points_used,
                status: r.status,
                createdAt: r.created_at
            }));
        }

        if (appState.currentUser) {
            const freshMe = appState.users.find(u => u.id === appState.currentUser.id);
            if (freshMe) appState.currentUser = freshMe;
        }
    } catch (err) {
        console.error('Supabase sync error:', err);
        showToast('ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาตรวจสอบอินเทอร์เน็ต');
    }
}

async function refreshCurrentView() {
    showToast('กำลังอัปเดตข้อมูลล่าสุด...');
    await syncAllDataFromCloud();
    if (appState.currentUser) {
        if (appState.currentUser.role === 'admin') {
            renderAdminDashboard();
        } else {
            renderMemberDashboard();
        }
    }
}

function saveSessionUser(user, remember = true) {
    const payload = JSON.stringify({ id: user.id, role: user.role });
    if (remember) {
        localStorage.setItem('muk_session_user', payload);
        sessionStorage.removeItem('muk_session_user');
    } else {
        sessionStorage.setItem('muk_session_user', payload);
        localStorage.removeItem('muk_session_user');
    }
}

function getSavedSessionUser() {
    const raw = localStorage.getItem('muk_session_user') || sessionStorage.getItem('muk_session_user');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function clearSessionUser() {
    localStorage.removeItem('muk_session_user');
    sessionStorage.removeItem('muk_session_user');
}

/* ==========================================================
   2. ระบบเข้าสู่ระบบ & สมัครสมาชิก (Auth)
   ========================================================== */
function switchAuthTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
        btn.classList.toggle('active', (tab === 'login' && idx === 0) || (tab === 'register' && idx === 1));
    });
    document.getElementById('login-form').classList.toggle('active', tab === 'login');
    document.getElementById('register-form').classList.toggle('active', tab === 'register');
}

function openForgotModal() {
    document.getElementById('forgot-modal').classList.remove('hidden');
}

async function handleLogin(e) {
    e.preventDefault();
    const inputLogin = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const rememberMe = document.getElementById('login-remember')?.checked ?? true;
    const btn = document.getElementById('btn-login-submit');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเข้าสู่ระบบ...';

    await syncAllDataFromCloud();

    const user = appState.users.find(u =>
        (u.studentId === inputLogin || u.username.toLowerCase() === inputLogin.toLowerCase()) &&
        u.password === password
    );

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ';

    if (!user) {
        showToast('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง!');
        return;
    }

    appState.currentUser = user;
    saveSessionUser(user, rememberMe);
    showToast(`ยินดีต้อนรับคุณ ${user.fullName}`);
    initAppView();
}

async function handleRegister(e) {
    e.preventDefault();
    const fullName = document.getElementById('reg-fullname').value.trim();
    const studentId = document.getElementById('reg-studentid').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const btn = document.getElementById('btn-reg-submit');

    if (!/^0\d{9}$/.test(studentId)) {
        showToast('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (ตัวเลข 10 หลัก ขึ้นต้นด้วย 0)');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังสมัครสมาชิก...';

    await syncAllDataFromCloud();

    if (appState.users.some(u => u.studentId === studentId)) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรี 10 แต้ม!)';
        showToast('เบอร์โทรศัพท์นี้ถูกสมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบ');
        return;
    }

    const { data: newUserData, error } = await sb.from('users').insert([{
        username: fullName,
        password: password,
        full_name: fullName,
        student_id: studentId,
        role: 'member',
        points: 10
    }]).select().single();

    if (error) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรี 10 แต้ม!)';
        showToast('เกิดข้อผิดพลาดในการสมัครสมาชิก: ' + error.message);
        return;
    }

    await sb.from('earn_history').insert([{
        user_id: newUserData.id,
        user_name: fullName,
        amount: 0,
        points_earned: 10,
        note: 'โบนัสต้อนรับสมาชิกใหม่'
    }]);

    await syncAllDataFromCloud();

    const createdUser = appState.users.find(u => u.id === newUserData.id);
    appState.currentUser = createdUser;
    saveSessionUser(createdUser, true);

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> สมัครสมาชิก (รับฟรี 10 แต้ม!)';
    e.target.reset();
    showToast('สมัครสมาชิกสำเร็จ! คุณได้รับ 10 แต้มต้อนรับฟรี');
    initAppView();
}

function handleLogout() {
    clearSessionUser();
    appState.currentUser = null;
    if (promoAutoTimer) clearInterval(promoAutoTimer);
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('login-form').reset();
}

function initAppView() {
    const user = appState.currentUser;
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');

    document.getElementById('nav-user-name').textContent = user.fullName;
    document.getElementById('nav-user-role').textContent = user.role === 'admin' ? 'ผู้ดูแลร้าน' : 'สมาชิก';

    if (user.role === 'admin') {
        document.getElementById('member-dashboard').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        renderAdminDashboard();
    } else {
        document.getElementById('admin-dashboard').classList.add('hidden');
        document.getElementById('member-dashboard').classList.remove('hidden');
        renderMemberDashboard();
    }
}

/* ==========================================================
   3. ระบบฝั่งสมาชิก (Member Dashboard)
   ========================================================== */
function renderMemberDashboard() {
    const user = appState.currentUser;
    document.getElementById('mem-card-name').textContent = user.fullName;
    document.getElementById('mem-card-id').textContent = `เบอร์โทรศัพท์: ${user.studentId}`;
    document.getElementById('mem-current-points').textContent = user.points;
    document.getElementById('mem-rate-info').textContent = `ทุกยอดซื้อ ${appState.settings.bahtPerPoint} บาท รับ 1 แต้ม`;

    const tier = calculateMemberTier(user.id);
    const tierBadge = document.getElementById('mem-tier-badge');
    if (tierBadge) {
        tierBadge.className = `tier-badge ${tier.cssClass}`;
        tierBadge.innerHTML = `<i class="fa-solid ${tier.icon}"></i> ${tier.name}`;
    }
    const tierNextEl = document.getElementById('mem-tier-next-text');
    if (tierNextEl) tierNextEl.textContent = tier.nextText;

    renderBarcodeSafe('#member-barcode', user.studentId, { width: 2.1, height: 42, fontSize: 13 });
    updateDailyCheckinButton();

    const spinBtn = document.getElementById('btn-open-spin');
    if (spinBtn) {
        spinBtn.classList.toggle('hidden', spinConfig.enabled === false);
        spinBtn.innerHTML = `<i class="fa-solid fa-dharmachakra fa-spin" style="--fa-animation-duration: 8s;"></i> วงล้อ (${spinConfig.cost} แต้ม)`;
    }

    renderMemberGoalBar();
    renderMemberPromotions();
    renderMemberRewards();
    renderMemberHistory();
}

function openMemberBarcodeModal() {
    const user = appState.currentUser;
    if (!user) return;
    document.getElementById('barcode-modal-name').textContent = user.fullName;
    document.getElementById('barcode-modal-phone').textContent = `รหัสสมาชิก / เบอร์โทร: ${user.studentId}`;
    renderBarcodeSafe('#member-barcode-large', user.studentId, { width: 2.6, height: 80, fontSize: 16 });
    document.getElementById('member-barcode-modal').classList.remove('hidden');
}

/* ==========================================================
   ระบบ Daily Login 30 วัน (สไตล์กระดานรางวัล 5x6 ช่อง)
   ========================================================== */
function getUserCheckinProgress(userId) {
    const monthPrefix = getMonthPrefix();
    const todayStr = getLocalDateStr();

    const monthClaims = appState.earnHistory.filter(e =>
        String(e.userId) === String(userId) &&
        (e.note || '').includes('เช็กอินรายวัน') &&
        getLocalDateStr(new Date(e.createdAt)).startsWith(monthPrefix)
    );

    const uniqueDaysSet = new Set(monthClaims.map(e => getLocalDateStr(new Date(e.createdAt))));
    const claimedCount = Math.min(uniqueDaysSet.size, 30);
    const checkedToday = uniqueDaysSet.has(todayStr);

    return { claimedCount, checkedToday };
}

function updateDailyCheckinButton() {
    const user = appState.currentUser;
    const btn = document.getElementById('btn-daily-checkin');
    if (!user || !btn) return;

    const { claimedCount, checkedToday } = getUserCheckinProgress(user.id);

    if (checkedToday) {
        btn.classList.add('checked');
        btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Daily Login (${claimedCount}/30)`;
    } else {
        btn.classList.remove('checked');
        const nextDay = Math.min(claimedCount + 1, 30);
        btn.innerHTML = `<i class="fa-solid fa-calendar-check"></i> เช็กอินวันที่ ${nextDay}/30!`;
    }
}

function openCheckinCalendarModal() {
    renderDailyLoginBoard();
    document.getElementById('checkin-calendar-modal').classList.remove('hidden');
}

function renderDailyLoginBoard() {
    const user = appState.currentUser;
    if (!user) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthNamesTH = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const remainingDays = Math.max(lastDayOfMonth - now.getDate() + 1, 1);

    document.getElementById('cal-month-title').textContent = `• ประจำเดือน ${monthNamesTH[month]} ${year + 543} •`;
    document.getElementById('daily-dday-num').textContent = remainingDays;
    document.getElementById('daily-period-footer').textContent =
        `ระยะเวลา : 1 - ${lastDayOfMonth} ${monthNamesTH[month]} ${year + 543} (รีเซ็ตทุกวันที่ 1 ของเดือน)`;

    const { claimedCount, checkedToday } = getUserCheckinProgress(user.id);
    document.getElementById('cal-progress-badge').textContent = `เช็กอินแล้ว ${claimedCount}/30 วัน`;

    const speechEl = document.getElementById('daily-speech-text');
    if (claimedCount >= 30) {
        speechEl.innerHTML = `สุดยอดเลย!<br><strong>รับครบ 30 วันแล้ว 🎉</strong>`;
    } else if (checkedToday) {
        speechEl.innerHTML = `รับแต้มวันนี้แล้ว!<br><strong>พรุ่งนี้มาเช็กอินวันที่ ${claimedCount + 1} นะ!</strong>`;
    } else {
        const nextDay = claimedCount + 1;
        speechEl.innerHTML = `กรุณาคลิกที่<br><strong>วันที่ ${nextDay} ~ !</strong>`;
    }

    const gridEl = document.getElementById('daily-login-grid');
    gridEl.innerHTML = DAILY_LOGIN_30_REWARDS.map(item => {
        const isClaimed = item.day <= claimedCount;
        const isClaimable = !checkedToday && item.day === (claimedCount + 1);

        let cls = 'daily-slot-card';
        if (item.isBonus) cls += ' bonus-day';
        if (isClaimed) cls += ' claimed';
        if (isClaimable) cls += ' claimable';

        const clickAttr = isClaimable ? `onclick="claimDailyLoginSlot(${item.day}, ${item.points})"` : '';
        const stampHtml = isClaimed ? `<div class="daily-slot-stamp"><span>รับแล้ว</span></div>` : '';

        return `
            <div class="${cls}" ${clickAttr}>
                <div class="daily-slot-icon">${item.icon}</div>
                <div class="daily-slot-pts">+${item.points} แต้ม</div>
                <div class="daily-slot-day">วันที่ ${item.day}</div>
                ${stampHtml}
            </div>
        `;
    }).join('');
}

async function claimDailyLoginSlot(dayNumber, bonusPoints) {
    const user = appState.currentUser;
    if (!user || isCheckinBusy) return;

    const { claimedCount, checkedToday } = getUserCheckinProgress(user.id);
    if (checkedToday || dayNumber !== claimedCount + 1) {
        showToast('วันนี้คุณเช็กอินรับแต้มไปแล้ว พรุ่งนี้มาเช็กอินใหม่นะครับ!');
        return;
    }

    isCheckinBusy = true;
    const newPoints = Number(user.points) + bonusPoints;
    const noteText = `เช็กอินรายวัน Daily Login วันที่ ${dayNumber}/30 (+${bonusPoints} แต้ม)`;

    const { error } = await sb.from('users').update({ points: newPoints }).eq('id', user.id);
    if (error) {
        isCheckinBusy = false;
        showToast('เกิดข้อผิดพลาดในการเช็กอิน: ' + error.message);
        return;
    }

    await sb.from('earn_history').insert([{
        user_id: user.id,
        user_name: user.fullName,
        amount: 0,
        points_earned: bonusPoints,
        note: noteText
    }]);

    await syncAllDataFromCloud();
    isCheckinBusy = false;
    showToast(`เช็กอินวันที่ ${dayNumber} สำเร็จ! รับฟรี +${bonusPoints} แต้ม 🎉`);
    renderMemberDashboard();
    renderDailyLoginBoard();
}

/* ==========================================================
   วงล้อลุ้นแต้มนำโชค (Lucky Spin Wheel)
   ========================================================== */
function renderWheelVisual() {
    const wheel = document.getElementById('lucky-wheel');
    if (!wheel) return;
    const slots = spinConfig.slots || DEFAULT_SPIN_CONFIG.slots;
    const gradientStops = slots.map((_, i) => `${SLOT_COLORS[i % SLOT_COLORS.length]} ${i * 60}deg ${(i + 1) * 60}deg`).join(', ');
    wheel.style.background = `conic-gradient(${gradientStops})`;

    wheel.innerHTML = slots.map((s, i) => {
        const angle = i * 60 + 30;
        return `<span class="wheel-label" style="transform: rotate(${angle}deg) translateY(-76px);">${s.label}</span>`;
    }).join('');
}

function openLuckySpinModal() {
    if (spinConfig.enabled === false) {
        showToast('ขออภัย ระบบวงล้อลุ้นแต้มปิดให้บริการชั่วคราว');
        return;
    }
    const cost = Number(spinConfig.cost) || 0;
    const maxPts = Math.max(...spinConfig.slots.map(s => Number(s.points) || 0));
    const descEl = document.getElementById('spin-cost-desc');
    if (descEl) {
        descEl.innerHTML = cost > 0
            ? `ใช้ <strong>${cost} แต้ม</strong> ต่อการหมุน 1 ครั้ง ลุ้นรับสูงสุด <strong>${maxPts} แต้ม</strong>!`
            : `หมุนฟรี! ลุ้นรับรางวัลสูงสุด <strong>${maxPts} แต้ม</strong>!`;
    }
    renderWheelVisual();
    document.getElementById('spin-result-text').textContent = '';
    const btn = document.getElementById('btn-spin-now');
    btn.disabled = false;
    btn.innerHTML = cost > 0
        ? `<i class="fa-solid fa-play"></i> หมุนวงล้อเลย (-${cost} แต้ม)`
        : `<i class="fa-solid fa-play"></i> หมุนวงล้อฟรีเลย!`;
    document.getElementById('lucky-spin-modal').classList.remove('hidden');
}

function pickWeightedSlotIndex(slots) {
    const totalWeight = slots.reduce((sum, s) => sum + Math.max(Number(s.weight) || 0, 0), 0);
    if (totalWeight <= 0) return Math.floor(Math.random() * slots.length);
    let rand = Math.random() * totalWeight;
    for (let i = 0; i < slots.length; i++) {
        const w = Math.max(Number(slots[i].weight) || 0, 0);
        if (rand < w) return i;
        rand -= w;
    }
    return 0;
}

async function spinWheelNow() {
    if (isWheelSpinning) return;
    const user = appState.currentUser;
    const cost = Number(spinConfig.cost) || 0;
    if (!user || user.points < cost) {
        showToast(`แต้มสะสมไม่พอสำหรับหมุนวงล้อ (ต้องใช้ ${cost} แต้ม)`);
        return;
    }

    isWheelSpinning = true;
    const btn = document.getElementById('btn-spin-now');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเสี่ยงโชค...';
    document.getElementById('spin-result-text').textContent = 'ขอให้โชคดี!';

    const slots = spinConfig.slots;
    const winIdx = pickWeightedSlotIndex(slots);
    const prize = slots[winIdx];
    const prizePoints = Number(prize.points) || 0;

    const targetCenterAngle = winIdx * 60 + 30;
    const desiredMod = (360 - targetCenterAngle) % 360;
    const currentMod = currentWheelRotation % 360;
    const extraDeg = (desiredMod - currentMod + 360) % 360;
    currentWheelRotation += 1800 + extraDeg;

    const wheel = document.getElementById('lucky-wheel');
    wheel.style.transform = `rotate(${currentWheelRotation}deg)`;

    setTimeout(async () => {
        const netPoints = Number(user.points) - cost + prizePoints;
        const { error } = await sb.from('users').update({ points: netPoints }).eq('id', user.id);

        if (!error) {
            if (cost > 0) {
                await sb.from('earn_history').insert([{
                    user_id: user.id,
                    user_name: user.fullName,
                    amount: 0,
                    points_earned: -cost,
                    note: 'ใช้แต้มหมุนวงล้อนำโชค'
                }]);
            }
            if (prizePoints > 0) {
                await sb.from('earn_history').insert([{
                    user_id: user.id,
                    user_name: user.fullName,
                    amount: 0,
                    points_earned: prizePoints,
                    note: `ถูกรางวัลวงล้อนำโชค (${prize.label})`
                }]);
            }
            await syncAllDataFromCloud();
            renderMemberDashboard();
        }

        const resultText = prizePoints > 0
            ? `🎉 ยินดีด้วย! คุณได้รับ ${prize.label}`
            : `😅 เสียดายจัง! รอบนี้ไม่ได้รับแต้ม ลองใหม่อีกครั้งนะ`;
        document.getElementById('spin-result-text').textContent = resultText;
        showToast(resultText);

        isWheelSpinning = false;
        btn.disabled = false;
        btn.innerHTML = cost > 0
            ? `<i class="fa-solid fa-rotate-right"></i> หมุนอีกครั้ง (-${cost} แต้ม)`
            : `<i class="fa-solid fa-rotate-right"></i> หมุนอีกครั้งฟรี!`;
    }, 3600);
}

/* ==========================================================
   ตั้งค่าวงล้อลุ้นแต้ม (สำหรับแอดมิน)
   ========================================================== */
function renderAdminSpinSummary() {
    const box = document.getElementById('admin-spin-summary-box');
    if (!box) return;
    const statusHtml = spinConfig.enabled !== false
        ? `<span style="color: var(--success-green); font-weight: 700;">เปิดใช้งาน</span>`
        : `<span style="color: var(--danger-red); font-weight: 700;">ปิดชั่วคราว</span>`;
    const slotList = spinConfig.slots.map(s => `${s.label} (${s.weight}%)`).join(' • ');
    box.innerHTML = `
        <div style="margin-bottom: 4px;">สถานะ: ${statusHtml} | ค่าหมุน: <strong>${spinConfig.cost} แต้ม/ครั้ง</strong></div>
        <div style="font-size: 12px; color: var(--text-muted);">ช่องรางวัล: ${slotList}</div>
    `;
}

function openSpinSettingsModal() {
    document.getElementById('spin-set-enabled').value = spinConfig.enabled !== false ? '1' : '0';
    document.getElementById('spin-set-cost').value = spinConfig.cost ?? 3;

    const editor = document.getElementById('spin-slots-editor');
    editor.innerHTML = spinConfig.slots.map((slot, idx) => `
        <div class="spin-slot-row">
            <div class="spin-slot-dot" style="background: ${SLOT_COLORS[idx % SLOT_COLORS.length]};">${idx + 1}</div>
            <div>
                <label style="font-size: 11px; color: var(--text-muted); margin-bottom: 2px;">แต้มที่ได้ (ช่องที่ ${idx + 1})</label>
                <input type="number" class="spin-slot-points" min="0" value="${slot.points}" required style="padding: 6px 10px; font-size: 13px;">
            </div>
            <div>
                <label style="font-size: 11px; color: var(--text-muted); margin-bottom: 2px;">น้ำหนักโอกาสออก</label>
                <input type="number" class="spin-slot-weight" min="1" value="${slot.weight}" required style="padding: 6px 10px; font-size: 13px;">
            </div>
        </div>
    `).join('');

    document.getElementById('spin-settings-modal').classList.remove('hidden');
}

function resetDefaultSpinSettings() {
    spinConfig = JSON.parse(JSON.stringify(DEFAULT_SPIN_CONFIG));
    openSpinSettingsModal();
    showToast('โหลดค่าเริ่มต้นของวงล้อแล้ว กด "บันทึกการตั้งค่าวงล้อ" เพื่อยืนยัน');
}

async function saveSpinSettings(e) {
    e.preventDefault();
    const enabled = document.getElementById('spin-set-enabled').value === '1';
    const cost = Math.max(0, parseInt(document.getElementById('spin-set-cost').value, 10) || 0);
    const pointInputs = document.querySelectorAll('.spin-slot-points');
    const weightInputs = document.querySelectorAll('.spin-slot-weight');

    const newSlots = [];
    for (let i = 0; i < pointInputs.length; i++) {
        const pts = Math.max(0, parseInt(pointInputs[i].value, 10) || 0);
        const w = Math.max(1, parseInt(weightInputs[i].value, 10) || 1);
        newSlots.push({
            label: pts === 0 ? '0 แต้ม' : `+${pts} แต้ม`,
            points: pts,
            weight: w
        });
    }

    const updatedConfig = { enabled, cost, slots: newSlots };
    const btn = document.getElementById('btn-save-spin-settings');
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';

    const { error } = await sb.from('settings').update({ spin_config: updatedConfig }).eq('id', 1);

    btn.disabled = false;
    btn.textContent = 'บันทึกการตั้งค่าวงล้อ';

    if (error) {
        showToast('บันทึกไม่สำเร็จ: ' + error.message + ' (ตรวจสอบคอลัมน์ spin_config ในตาราง settings)');
        return;
    }

    spinConfig = updatedConfig;
    closeModal('spin-settings-modal');
    renderAdminSpinSummary();
    showToast('บันทึกการตั้งค่าวงล้อลุ้นแต้มเรียบร้อยแล้ว!');
}

/* ==========================================================
   แก้ไขโปรไฟล์ / เปลี่ยนรหัสผ่าน (สำหรับสมาชิก)
   ========================================================== */
function openProfileModal() {
    const user = appState.currentUser;
    if (!user) return;
    document.getElementById('prof-phone').value = user.studentId;
    document.getElementById('prof-fullname').value = user.fullName;
    document.getElementById('prof-new-pass').value = '';
    document.getElementById('prof-confirm-pass').value = '';
    document.getElementById('profile-modal').classList.remove('hidden');
}

async function saveMemberProfile(e) {
    e.preventDefault();
    const user = appState.currentUser;
    const newFullName = document.getElementById('prof-fullname').value.trim();
    const newPass = document.getElementById('prof-new-pass').value.trim();
    const confirmPass = document.getElementById('prof-confirm-pass').value.trim();
    const btn = document.getElementById('btn-save-profile');

    if (!newFullName) {
        showToast('กรุณากรอกชื่อ-นามสกุล');
        return;
    }

    if (newPass && newPass !== confirmPass) {
        showToast('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน!');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';

    const updatePayload = {
        full_name: newFullName,
        username: newFullName
    };
    if (newPass) {
        updatePayload.password = newPass;
    }

    const { error } = await sb.from('users').update(updatePayload).eq('id', user.id);

    btn.disabled = false;
    btn.textContent = 'บันทึกการเปลี่ยนแปลง';

    if (error) {
        showToast('เกิดข้อผิดพลาดในการบันทึกโปรไฟล์: ' + error.message);
        return;
    }

    await syncAllDataFromCloud();
    document.getElementById('nav-user-name').textContent = appState.currentUser.fullName;
    closeModal('profile-modal');
    renderMemberDashboard();
    showToast('อัปเดตข้อมูลโปรไฟล์เรียบร้อยแล้ว!');
}

function renderMemberGoalBar() {
    const userPoints = appState.currentUser.points;
    const goalText = document.getElementById('mem-goal-text');
    const goalPercent = document.getElementById('mem-goal-percent');
    const goalBar = document.getElementById('mem-goal-bar');
    if (!goalText || !goalPercent || !goalBar) return;

    const availableRewards = appState.rewards
        .filter(r => r.stock > 0)
        .sort((a, b) => a.pointsRequired - b.pointsRequired);

    if (availableRewards.length === 0) {
        goalText.textContent = 'ยังไม่มีรายการของรางวัลในขณะนี้';
        goalPercent.textContent = '-';
        goalBar.style.width = '0%';
        return;
    }

    const nextReward = availableRewards.find(r => r.pointsRequired > userPoints);
    if (!nextReward) {
        goalText.innerHTML = `<i class="fa-solid fa-crown" style="color:#CA8A04;"></i> คุณมีแต้มเพียงพอแลกของรางวัลได้ทุกรายการ!`;
        goalPercent.textContent = '100%';
        goalBar.style.width = '100%';
        goalBar.style.background = 'var(--success-green)';
    } else {
        const diff = nextReward.pointsRequired - userPoints;
        const pct = Math.min(100, Math.round((userPoints / nextReward.pointsRequired) * 100));
        goalText.textContent = `อีก ${diff} แต้ม แลก "${nextReward.name}" ได้เลย!`;
        goalPercent.textContent = `${pct}%`;
        goalBar.style.width = `${pct}%`;
        goalBar.style.background = 'var(--primary-blue)';
    }
}

function setRewardFilter(filter) {
    rewardFilter = filter;
    const btnAll = document.getElementById('filter-rew-all');
    const btnCan = document.getElementById('filter-rew-can');
    if (btnAll && btnCan) {
        btnAll.className = filter === 'all' ? 'btn btn-primary' : 'btn btn-outline';
        btnCan.className = filter === 'can_redeem' ? 'btn btn-primary' : 'btn btn-outline';
    }
    renderMemberRewards();
}

function renderMemberPromotions() {
    const container = document.getElementById('member-promo-section');
    if (!container) return;

    if (promoAutoTimer) clearInterval(promoAutoTimer);

    if (appState.promotions.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    promoSlideIndex = 0;

    const slidesHtml = appState.promotions.map(p => `
        <div class="promo-banner-card">
            <img src="${p.image || 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800'}" alt="${p.title}">
            <div class="promo-overlay">
                <span class="promo-tag">${p.badge}</span>
                <h4>${p.title}</h4>
                <p>${p.desc}</p>
            </div>
        </div>
    `).join('');

    const navHtml = appState.promotions.length > 1 ? `
        <button type="button" class="promo-nav-btn promo-prev" onclick="movePromoSlide(-1)">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button type="button" class="promo-nav-btn promo-next" onclick="movePromoSlide(1)">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
        <div class="promo-dots">
            ${appState.promotions.map((_, idx) => `
                <button type="button" class="promo-dot ${idx === 0 ? 'active' : ''}" onclick="goToPromoSlide(${idx})"></button>
            `).join('')}
        </div>
    ` : '';

    container.innerHTML = `
        <div class="promo-track" id="promo-track">${slidesHtml}</div>
        ${navHtml}
    `;

    if (appState.promotions.length > 1) {
        promoAutoTimer = setInterval(() => movePromoSlide(1), 4500);
    }
}

function updatePromoCarouselUI() {
    const track = document.getElementById('promo-track');
    if (!track) return;
    track.style.transform = `translateX(-${promoSlideIndex * 100}%)`;
    document.querySelectorAll('.promo-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx === promoSlideIndex);
    });
}

function movePromoSlide(step) {
    const total = appState.promotions.length;
    if (total <= 1) return;
    promoSlideIndex = (promoSlideIndex + step + total) % total;
    updatePromoCarouselUI();
}

function goToPromoSlide(index) {
    promoSlideIndex = index;
    updatePromoCarouselUI();
}

function switchMemberTab(tabName, btnEl) {
    document.querySelectorAll('#member-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    document.querySelectorAll('#member-dashboard .tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`mem-tab-${tabName}`).classList.add('active');
}

function renderMemberRewards() {
    const grid = document.getElementById('member-rewards-grid');
    const userPoints = appState.currentUser.points;

    let list = appState.rewards;
    if (rewardFilter === 'can_redeem') {
        list = list.filter(r => r.stock > 0 && userPoints >= r.pointsRequired);
    }

    if (list.length === 0) {
        grid.innerHTML = `<div class="card-box" style="grid-column: 1/-1; text-align:center; color:#64748B;">ยังไม่มีรายการของรางวัลที่ตรงกับเงื่อนไข</div>`;
        return;
    }

    grid.innerHTML = list.map(reward => {
        const canRedeem = userPoints >= reward.pointsRequired && reward.stock > 0;
        const outOfStock = reward.stock <= 0;

        return `
            <div class="reward-card">
                <img src="${reward.image || 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500'}" alt="${reward.name}" class="reward-img">
                <div class="reward-body">
                    <div>
                        <span class="reward-badge"><i class="fa-solid fa-star"></i> ใช้ ${reward.pointsRequired} แต้ม</span>
                        <h4 class="reward-title">${reward.name}</h4>
                        <p class="reward-desc">${reward.desc}</p>
                    </div>
                    <div class="reward-footer">
                        <span style="font-size:12px; color:#64748B;">คงเหลือ ${reward.stock} สิทธิ์</span>
                        <button class="btn ${canRedeem ? 'btn-primary' : 'btn-outline'}" 
                                ${!canRedeem ? 'disabled' : ''} 
                                onclick="requestRedeem(${reward.id})">
                            ${outOfStock ? 'สิทธิ์เต็มแล้ว' : (canRedeem ? 'แลกของรางวัล' : 'แต้มไม่พอ')}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function requestRedeem(rewardId) {
    const user = appState.currentUser;
    const reward = appState.rewards.find(r => r.id === rewardId);

    if (!reward || user.points < reward.pointsRequired || reward.stock <= 0) {
        showToast('ไม่สามารถแลกของรางวัลได้ แต้มสะสมไม่พอหรือสิทธิ์เต็มแล้ว');
        return;
    }

    if (!confirm(`ยืนยันใช้ ${reward.pointsRequired} แต้ม เพื่อแลก "${reward.name}" หรือไม่?`)) return;

    const newPoints = user.points - reward.pointsRequired;
    const newStock = reward.stock - 1;
    const refCode = 'MUK-' + Math.floor(100000 + Math.random() * 900000);

    const { error: userErr } = await sb.from('users').update({ points: newPoints }).eq('id', user.id);
    if (userErr) {
        showToast('เกิดข้อผิดพลาดในการหักแต้ม: ' + userErr.message);
        return;
    }

    await sb.from('rewards').update({ stock: newStock }).eq('id', reward.id);

    const { data: insertedRedeem } = await sb.from('redeem_history').insert([{
        ref_code: refCode,
        user_id: user.id,
        user_name: user.fullName,
        reward_id: reward.id,
        reward_name: reward.name,
        points_used: reward.pointsRequired,
        status: 'approved'
    }]).select().single();

    await syncAllDataFromCloud();
    showToast('แลกของรางวัลสำเร็จ! ยื่นหลักฐานรับสินค้าที่หน้าร้านได้เลย');
    renderMemberDashboard();

    if (insertedRedeem) {
        showTicketModal(insertedRedeem.id);
    }
}

function renderMemberHistory() {
    const userId = appState.currentUser.id;

    const myEarns = appState.earnHistory.filter(h => h.userId === userId);
    const earnTbody = document.getElementById('mem-earn-tbody');
    earnTbody.innerHTML = myEarns.length ? myEarns.map(item => `
        <tr>
            <td>${formatDate(item.createdAt)}</td>
            <td>${item.note || 'ซื้อสินค้าหน้าร้าน'}</td>
            <td>${item.amount > 0 ? item.amount.toLocaleString() + ' บาท' : '-'}</td>
            <td style="color:${item.pointsEarned >= 0 ? 'var(--success-green)' : 'var(--danger-red)'}; font-weight:600;">
                ${item.pointsEarned >= 0 ? '+' + item.pointsEarned : item.pointsEarned} แต้ม
            </td>
        </tr>
    `).join('') : `<tr><td colspan="4" style="text-align:center;">ยังไม่มีประวัติการสะสมแต้ม</td></tr>`;

    const myRedeems = appState.redeemHistory.filter(h => h.userId === userId);
    const redeemTbody = document.getElementById('mem-redeem-tbody');
    redeemTbody.innerHTML = myRedeems.length ? myRedeems.map(item => {
        return `
            <tr>
                <td><strong>${item.refCode}</strong></td>
                <td>${formatDate(item.createdAt)}</td>
                <td>${item.rewardName}</td>
                <td>${item.pointsUsed} แต้ม</td>
                <td><span class="status-pill status-approved">แลกสำเร็จ (รับสินค้าได้เลย)</span></td>
                <td>
                    <button class="btn btn-secondary" style="padding:4px 10px; font-size:12px;" onclick="showTicketModal(${item.id})">
                        <i class="fa-solid fa-ticket"></i> ดูหลักฐาน
                    </button>
                </td>
            </tr>
        `;
    }).join('') : `<tr><td colspan="6" style="text-align:center;">ยังไม่มีประวัติการแลกของรางวัล</td></tr>`;
}

function showTicketModal(redeemId) {
    const item = appState.redeemHistory.find(r => r.id === redeemId);
    if (!item) return;

    document.getElementById('ticket-ref').textContent = item.refCode;
    document.getElementById('ticket-reward').textContent = item.rewardName;
    document.getElementById('ticket-points').textContent = item.pointsUsed;
    document.getElementById('ticket-time').textContent = formatDate(item.createdAt);

    renderBarcodeSafe('#ticket-barcode', item.refCode, { width: 2, height: 50, fontSize: 13 });

    document.getElementById('ticket-modal').classList.remove('hidden');
}

/* ==========================================================
   4. ระบบฝั่งผู้ดูแลร้าน (Admin Dashboard)
   ========================================================== */
function renderAdminDashboard() {
    const members = appState.users.filter(u => u.role === 'member');
    const totalPointsGiven = appState.earnHistory.reduce((sum, item) => sum + (item.pointsEarned > 0 ? item.pointsEarned : 0), 0);
    const totalSales = appState.earnHistory.reduce((sum, item) => sum + Number(item.amount), 0);

    document.getElementById('stat-total-members').textContent = members.length;
    document.getElementById('stat-total-points').textContent = totalPointsGiven.toLocaleString();
    document.getElementById('stat-total-redemptions').textContent = appState.redeemHistory.length;
    document.getElementById('stat-total-sales').textContent = totalSales.toLocaleString();

    document.getElementById('setting-baht-per-point').value = appState.settings.bahtPerPoint;

    renderAdminSpinSummary();
    populatePOSMemberSelect();
    renderAdminRecentPOS();
    renderAdminRedemptions();
    renderAdminPromotions();
    renderAdminMembers();
    renderAdminRewards();
    renderAdminReport();
}

function switchAdminTab(tabName, btnEl) {
    document.querySelectorAll('#admin-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    document.querySelectorAll('#admin-dashboard .tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`admin-tab-${tabName}`).classList.add('active');

    if (tabName === 'pos') {
        setTimeout(() => document.getElementById('pos-member-search')?.focus(), 100);
    }
}

function populatePOSMemberSelect() {
    const datalist = document.getElementById('pos-members-datalist');
    const members = appState.users.filter(u => u.role === 'member');
    if (datalist) {
        datalist.innerHTML = members.map(m =>
            `<option value="${m.studentId} - ${m.fullName} (มี ${m.points} แต้ม)"></option>`
        ).join('');
    }
}

function handlePOSMemberSearch() {
    const inputEl = document.getElementById('pos-member-search');
    const hiddenIdEl = document.getElementById('pos-selected-user-id');
    const statusEl = document.getElementById('pos-member-status');
    const rawVal = inputEl.value.trim();

    if (!rawVal) {
        hiddenIdEl.value = '';
        statusEl.innerHTML = '';
        return;
    }

    const members = appState.users.filter(u => u.role === 'member');
    const exactPhone = rawVal.split(' ')[0].trim();

    const matched = members.find(m => m.studentId === exactPhone || m.studentId === rawVal) ||
                    members.find(m => `${m.studentId} - ${m.fullName} (มี ${m.points} แต้ม)` === rawVal) ||
                    members.find(m => m.fullName.toLowerCase() === rawVal.toLowerCase());

    if (matched) {
        hiddenIdEl.value = matched.id;
        const tier = calculateMemberTier(matched.id);
        statusEl.innerHTML = `
            <div style="background: #DCFCE7; border: 1px solid #86EFAC; color: #166534; padding: 8px 12px; border-radius: 8px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
                <span><i class="fa-solid fa-circle-check"></i> <strong>${matched.fullName}</strong> (${matched.studentId})</span>
                <span class="tier-pill ${tier.cssClass}">${tier.name} • ${matched.points} แต้ม</span>
            </div>
        `;
    } else {
        hiddenIdEl.value = '';
        statusEl.innerHTML = `<span style="font-size: 12px; color: var(--danger-red);"><i class="fa-solid fa-circle-exclamation"></i> ยังไม่พบสมาชิกที่ตรงกัน กรุณายิงบาร์โค้ดหรือเลือกรายชื่อ</span>`;
    }
}

function handlePOSBarcodeKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        handlePOSMemberSearch();
        const userId = document.getElementById('pos-selected-user-id').value;
        if (userId) {
            showToast('สแกนบาร์โค้ดสมาชิกสำเร็จ! กรอกยอดซื้อได้เลย');
            document.getElementById('pos-amount').focus();
        } else {
            showToast('ไม่พบรหัสสมาชิกนี้ในระบบ');
        }
    }
}

function clearPOSMember() {
    document.getElementById('pos-member-search').value = '';
    document.getElementById('pos-selected-user-id').value = '';
    document.getElementById('pos-member-status').innerHTML = '';
    document.getElementById('pos-member-search').focus();
}

function setQuickAmount(val) {
    const input = document.getElementById('pos-amount');
    if (input) {
        input.value = val;
        calculatePreviewPoints();
    }
}

function calculatePreviewPoints() {
    const amount = parseFloat(document.getElementById('pos-amount').value) || 0;
    const rate = appState.settings.bahtPerPoint || 20;
    const points = Math.floor(amount / rate);
    document.getElementById('pos-preview-points').textContent = `${points} แต้ม`;
    return points;
}

async function handleRecordPurchase(e) {
    e.preventDefault();
    const userId = parseInt(document.getElementById('pos-selected-user-id').value);
    const amount = parseFloat(document.getElementById('pos-amount').value);
    const note = document.getElementById('pos-note').value.trim();

    if (!userId || amount <= 0) {
        showToast('กรุณายิงบาร์โค้ด/เลือกสมาชิก และระบุยอดซื้อให้ถูกต้อง');
        return;
    }

    const member = appState.users.find(u => u.id === userId);
    const pointsEarned = calculatePreviewPoints();

    if (!member) return;

    const newPoints = member.points + pointsEarned;

    const { error } = await sb.from('users').update({ points: newPoints }).eq('id', member.id);
    if (error) {
        showToast('เกิดข้อผิดพลาด: ' + error.message);
        return;
    }

    await sb.from('earn_history').insert([{
        user_id: member.id,
        user_name: member.fullName,
        amount: amount,
        points_earned: pointsEarned,
        note: note || `ซื้อสินค้า ${amount} บาท`
    }]);

    await syncAllDataFromCloud();
    e.target.reset();
    clearPOSMember();
    document.getElementById('pos-preview-points').textContent = '0 แต้ม';
    showToast(`บันทึกยอดซื้อสำเร็จ! เพิ่ม ${pointsEarned} แต้มให้คุณ ${member.fullName}`);
    renderAdminDashboard();
}

async function handleUpdateRate(e) {
    e.preventDefault();
    const newRate = parseInt(document.getElementById('setting-baht-per-point').value);
    if (newRate >= 1) {
        const { error } = await sb.from('settings').update({ baht_per_point: newRate }).eq('id', 1);
        if (error) {
            showToast('บันทึกไม่สำเร็จ: ' + error.message);
            return;
        }
        appState.settings.bahtPerPoint = newRate;
        showToast(`อัปเดตอัตราคำนวณแต้มเป็นทุกๆ ${newRate} บาท = 1 แต้ม`);
        calculatePreviewPoints();
    }
}

function renderAdminRecentPOS() {
    const tbody = document.getElementById('admin-recent-pos-tbody');
    const recent = appState.earnHistory.slice(0, 5);
    tbody.innerHTML = recent.length ? recent.map(r => `
        <tr>
            <td>${r.userName}</td>
            <td>${r.amount > 0 ? r.amount + ' ฿' : 'โบนัส/ปรับยอด'}</td>
            <td style="color:${r.pointsEarned >= 0 ? 'var(--success-green)' : 'var(--danger-red)'}; font-weight:600;">
                ${r.pointsEarned >= 0 ? '+' + r.pointsEarned : r.pointsEarned}
            </td>
        </tr>
    `).join('') : `<tr><td colspan="3" style="text-align:center;">ยังไม่มีรายการ</td></tr>`;
}

function renderAdminRedemptions() {
    const tbody = document.getElementById('admin-redemptions-tbody');
    tbody.innerHTML = appState.redeemHistory.length ? appState.redeemHistory.map(r => {
        return `
            <tr>
                <td><strong>${r.refCode}</strong></td>
                <td>${formatDate(r.createdAt)}</td>
                <td>${r.userName}</td>
                <td>${r.rewardName}</td>
                <td>${r.pointsUsed} แต้ม</td>
                <td><span class="status-pill status-approved">แลกสำเร็จ (รับสินค้าแล้ว)</span></td>
            </tr>
        `;
    }).join('') : `<tr><td colspan="6" style="text-align:center;">ยังไม่มีรายการแลกของรางวัล</td></tr>`;
}

/* ==========================================================
   ระบบอัปโหลดรูปภาพ (Drag & Drop + บีบอัดภาพอัตโนมัติ)
   ========================================================== */
function compressImageToDataURL(file, maxWidth = 800, quality = 0.78) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            reject(new Error('กรุณาเลือกไฟล์รูปภาพเท่านั้น'));
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
            img.src = event.target.result;
        };
        reader.onerror = () => reject(new Error('เกิดข้อผิดพลาดในการโหลดไฟล์'));
        reader.readAsDataURL(file);
    });
}

function setPromoPreview(imageUrl) {
    const hiddenInput = document.getElementById('promo-image');
    const previewBox = document.getElementById('promo-preview-box');
    const previewImg = document.getElementById('promo-preview-img');
    const dropzone = document.getElementById('promo-dropzone');

    hiddenInput.value = imageUrl || '';
    if (imageUrl) {
        previewImg.src = imageUrl;
        previewBox.classList.remove('hidden');
        dropzone.classList.add('hidden');
    } else {
        previewImg.src = '';
        previewBox.classList.add('hidden');
        dropzone.classList.remove('hidden');
    }
}

function clearPromoImage() {
    document.getElementById('promo-file-input').value = '';
    setPromoPreview('');
}

async function processPromoImageFile(file) {
    try {
        showToast('กำลังประมวลผลรูปภาพแบนเนอร์...');
        const compressedDataUrl = await compressImageToDataURL(file, 900, 0.8);
        setPromoPreview(compressedDataUrl);
        showToast('อัปโหลดรูปภาพแบนเนอร์เรียบร้อย!');
    } catch (err) {
        showToast(err.message);
    }
}

function handlePromoFileSelect(e) {
    const file = e.target.files[0];
    if (file) processPromoImageFile(file);
}

function setRewardPreview(imageUrl) {
    const hiddenInput = document.getElementById('rew-edit-image');
    const previewBox = document.getElementById('rew-preview-box');
    const previewImg = document.getElementById('rew-preview-img');
    const dropzone = document.getElementById('rew-dropzone');

    hiddenInput.value = imageUrl || '';
    if (imageUrl) {
        previewImg.src = imageUrl;
        previewBox.classList.remove('hidden');
        dropzone.classList.add('hidden');
    } else {
        previewImg.src = '';
        previewBox.classList.add('hidden');
        dropzone.classList.remove('hidden');
    }
}

function clearRewardImage() {
    document.getElementById('rew-file-input').value = '';
    setRewardPreview('');
}

async function processRewardImageFile(file) {
    try {
        showToast('กำลังประมวลผลรูปภาพของรางวัล...');
        const compressedDataUrl = await compressImageToDataURL(file, 650, 0.8);
        setRewardPreview(compressedDataUrl);
        showToast('อัปโหลดรูปภาพของรางวัลเรียบร้อย!');
    } catch (err) {
        showToast(err.message);
    }
}

function handleRewardFileSelect(e) {
    const file = e.target.files[0];
    if (file) processRewardImageFile(file);
}

function setupDragAndDropZones() {
    const zones = [
        { id: 'promo-dropzone', handler: processPromoImageFile },
        { id: 'rew-dropzone', handler: processRewardImageFile }
    ];

    zones.forEach(({ id, handler }) => {
        const el = document.getElementById(id);
        if (!el) return;

        ['dragenter', 'dragover'].forEach(evtName => {
            el.addEventListener(evtName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(evtName => {
            el.addEventListener(evtName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.classList.remove('dragover');
            });
        });

        el.addEventListener('drop', (e) => {
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                handler(files[0]);
            }
        });
    });
}

/* ==========================================================
   จัดการโปรโมชั่น / แบนเนอร์ (ฝั่งแอดมิน)
   ========================================================== */
function renderAdminPromotions() {
    const grid = document.getElementById('admin-promos-grid');
    if (!grid) return;

    grid.innerHTML = appState.promotions.length ? appState.promotions.map(p => `
        <div class="reward-card">
            <img src="${p.image || 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500'}" class="reward-img" alt="${p.title}">
            <div class="reward-body">
                <div>
                    <span class="reward-badge">${p.badge}</span>
                    <h4 class="reward-title">${p.title}</h4>
                    <p class="reward-desc">${p.desc}</p>
                </div>
                <div class="reward-footer">
                    <span style="font-size:12px; color:#64748B;">แบนเนอร์หน้าร้าน</span>
                    <div>
                        <button class="btn btn-secondary" style="padding:5px 10px; font-size:12px;" onclick="openPromoModal(${p.id})">แก้ไข</button>
                        <button class="btn btn-danger" onclick="deletePromotion(${p.id})">ลบ</button>
                    </div>
                </div>
            </div>
        </div>
    `).join('') : `<div style="grid-column:1/-1; text-align:center; color:#64748B; padding:20px;">ยังไม่มีแบนเนอร์โปรโมชั่น กด "+ เพิ่มแบนเนอร์โปรโมชั่น" ด้านบนได้เลย</div>`;
}

function openPromoModal(id = null) {
    document.getElementById('promo-edit-id').value = id || '';
    document.getElementById('promo-file-input').value = '';

    if (id) {
        const p = appState.promotions.find(item => item.id === id);
        document.getElementById('promo-modal-title').textContent = 'แก้ไขแบนเนอร์โปรโมชั่น';
        document.getElementById('promo-badge').value = p.badge;
        document.getElementById('promo-title').value = p.title;
        document.getElementById('promo-desc').value = p.desc;
        setPromoPreview(p.image || '');
    } else {
        document.getElementById('promo-modal-title').textContent = 'เพิ่มแบนเนอร์โปรโมชั่น';
        document.getElementById('promo-badge').value = 'โปรโมชั่นพิเศษ';
        document.getElementById('promo-title').value = '';
        document.getElementById('promo-desc').value = '';
        setPromoPreview('');
    }
    document.getElementById('promo-modal').classList.remove('hidden');
}

async function savePromotion(e) {
    e.preventDefault();
    const id = document.getElementById('promo-edit-id').value;
    const badge = document.getElementById('promo-badge').value.trim();
    const title = document.getElementById('promo-title').value.trim();
    const desc = document.getElementById('promo-desc').value.trim();
    const image = document.getElementById('promo-image').value.trim() || 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800';

    if (id) {
        const { error } = await sb.from('promotions').update({
            badge, title, description: desc, image
        }).eq('id', parseInt(id));

        if (error) {
            showToast('แก้ไขโปรโมชั่นไม่สำเร็จ: ' + error.message);
            return;
        }
        showToast('แก้ไขแบนเนอร์โปรโมชั่นเรียบร้อย');
    } else {
        const { error } = await sb.from('promotions').insert([{
            badge, title, description: desc, image
        }]);

        if (error) {
            showToast('เพิ่มโปรโมชั่นไม่สำเร็จ: ' + error.message);
            return;
        }
        showToast('เพิ่มแบนเนอร์โปรโมชั่นใหม่สำเร็จ');
    }

    await syncAllDataFromCloud();
    closeModal('promo-modal');
    renderAdminPromotions();
}

async function deletePromotion(id) {
    if (confirm('ยืนยันลบแบนเนอร์โปรโมชั่นนี้หรือไม่?')) {
        await sb.from('promotions').delete().eq('id', id);
        await syncAllDataFromCloud();
        renderAdminPromotions();
        showToast('ลบแบนเนอร์โปรโมชั่นเรียบร้อย');
    }
}

/* ==========================================================
   จัดการสมาชิก & Audit Log (ฝั่งแอดมิน)
   ========================================================== */
function renderAdminMembers() {
    const keyword = document.getElementById('member-search').value.toLowerCase();
    const members = appState.users.filter(u =>
        u.role === 'member' &&
        (u.fullName.toLowerCase().includes(keyword) || u.studentId.includes(keyword))
    );

    const tbody = document.getElementById('admin-members-tbody');
    tbody.innerHTML = members.map(m => {
        const tier = calculateMemberTier(m.id);
        return `
            <tr>
                <td><strong>${m.studentId}</strong></td>
                <td>${m.fullName}</td>
                <td><span class="tier-pill ${tier.cssClass}">${tier.name}</span></td>
                <td><strong style="color:var(--primary-blue);">${m.points}</strong> แต้ม</td>
                <td>
                    <button class="btn btn-secondary" style="padding:5px 10px; font-size:12px;" onclick="openMemberModal(${m.id})">
                        <i class="fa-solid fa-pen"></i> แก้ไข
                    </button>
                    <button class="btn btn-danger" onclick="deleteMember(${m.id})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function openMemberModal(id = null) {
    document.getElementById('mem-edit-id').value = id || '';
    const reasonGroup = document.getElementById('mem-adjust-reason-group');
    const reasonInput = document.getElementById('mem-edit-reason');

    if (id) {
        const m = appState.users.find(u => u.id === id);
        document.getElementById('member-modal-title').textContent = 'แก้ไขข้อมูลสมาชิก';
        document.getElementById('mem-edit-fullname').value = m.fullName;
        document.getElementById('mem-edit-studentid').value = m.studentId;
        document.getElementById('mem-edit-points').value = m.points;
        document.getElementById('mem-edit-password').value = '';
        if (reasonGroup) reasonGroup.style.display = 'block';
        if (reasonInput) reasonInput.value = '';
    } else {
        document.getElementById('member-modal-title').textContent = 'เพิ่มสมาชิกใหม่';
        document.getElementById('mem-edit-fullname').value = '';
        document.getElementById('mem-edit-studentid').value = '';
        document.getElementById('mem-edit-points').value = 0;
        document.getElementById('mem-edit-password').value = '1234';
        if (reasonGroup) reasonGroup.style.display = 'none';
    }
    document.getElementById('member-modal').classList.remove('hidden');
}

async function saveMember(e) {
    e.preventDefault();
    const id = document.getElementById('mem-edit-id').value;
    const fullName = document.getElementById('mem-edit-fullname').value.trim();
    const studentId = document.getElementById('mem-edit-studentid').value.trim();
    const points = parseInt(document.getElementById('mem-edit-points').value);
    const password = document.getElementById('mem-edit-password').value.trim();
    const reason = document.getElementById('mem-edit-reason')?.value.trim() || '';

    if (id) {
        const oldMember = appState.users.find(u => u.id === parseInt(id));
        const pointDiff = points - (oldMember ? oldMember.points : 0);

        if (pointDiff !== 0 && !reason) {
            showToast('กรุณาระบุเหตุผลการแก้ไขแต้ม เพื่อเก็บเป็นประวัติตรวจสอบ');
            return;
        }

        const updateData = { full_name: fullName, username: fullName, student_id: studentId, points };
        if (password) updateData.password = password;
        await sb.from('users').update(updateData).eq('id', parseInt(id));

        if (pointDiff !== 0) {
            const adminName = appState.currentUser?.fullName || 'แอดมิน';
            await sb.from('earn_history').insert([{
                user_id: parseInt(id),
                user_name: fullName,
                amount: 0,
                points_earned: pointDiff,
                note: `[แอดมินปรับยอดโดย ${adminName}] ${reason}`
            }]);
        }

        showToast('บันทึกการแก้ไขสมาชิกเรียบร้อย');
    } else {
        if (appState.users.some(u => u.studentId === studentId)) {
            showToast('เบอร์โทรศัพท์นี้มีในระบบแล้ว');
            return;
        }
        await sb.from('users').insert([{
            username: fullName,
            password: password || '1234',
            full_name: fullName,
            student_id: studentId,
            role: 'member',
            points
        }]);
        showToast('เพิ่มสมาชิกใหม่เรียบร้อย');
    }

    await syncAllDataFromCloud();
    closeModal('member-modal');
    renderAdminDashboard();
}

async function deleteMember(id) {
    if (confirm('ยืนยันลบสมาชิกคนนี้ออกจากระบบหรือไม่?')) {
        await sb.from('users').delete().eq('id', id);
        await syncAllDataFromCloud();
        renderAdminDashboard();
        showToast('ลบข้อมูลสมาชิกเรียบร้อย');
    }
}

/* ==========================================================
   จัดการของรางวัล (ฝั่งแอดมิน)
   ========================================================== */
function renderAdminRewards() {
    const grid = document.getElementById('admin-rewards-grid');
    grid.innerHTML = appState.rewards.map(r => `
        <div class="reward-card">
            <img src="${r.image || 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500'}" class="reward-img" alt="${r.name}">
            <div class="reward-body">
                <div>
                    <span class="reward-badge">${r.pointsRequired} แต้ม</span>
                    <h4 class="reward-title">${r.name}</h4>
                    <p class="reward-desc">${r.desc}</p>
                </div>
                <div class="reward-footer">
                    <span style="font-size:12px;">คงเหลือ: <strong>${r.stock}</strong></span>
                    <div>
                        <button class="btn btn-secondary" style="padding:5px 10px; font-size:12px;" onclick="openRewardModal(${r.id})">แก้ไข</button>
                        <button class="btn btn-danger" onclick="deleteReward(${r.id})">ลบ</button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function openRewardModal(id = null) {
    document.getElementById('rew-edit-id').value = id || '';
    document.getElementById('rew-file-input').value = '';

    if (id) {
        const r = appState.rewards.find(item => item.id === id);
        document.getElementById('reward-modal-title').textContent = 'แก้ไขของรางวัล';
        document.getElementById('rew-edit-name').value = r.name;
        document.getElementById('rew-edit-desc').value = r.desc;
        document.getElementById('rew-edit-points').value = r.pointsRequired;
        document.getElementById('rew-edit-stock').value = r.stock;
        setRewardPreview(r.image || '');
    } else {
        document.getElementById('reward-modal-title').textContent = 'เพิ่มของรางวัลใหม่';
        document.getElementById('rew-edit-name').value = '';
        document.getElementById('rew-edit-desc').value = '';
        document.getElementById('rew-edit-points').value = 20;
        document.getElementById('rew-edit-stock').value = 10;
        setRewardPreview('');
    }
    document.getElementById('reward-modal').classList.remove('hidden');
}

async function saveReward(e) {
    e.preventDefault();
    const id = document.getElementById('rew-edit-id').value;
    const name = document.getElementById('rew-edit-name').value.trim();
    const desc = document.getElementById('rew-edit-desc').value.trim();
    const pointsRequired = parseInt(document.getElementById('rew-edit-points').value);
    const stock = parseInt(document.getElementById('rew-edit-stock').value);
    const image = document.getElementById('rew-edit-image').value.trim() || 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500';

    if (id) {
        await sb.from('rewards').update({
            name, description: desc, points_required: pointsRequired, stock, image
        }).eq('id', parseInt(id));
        showToast('แก้ไขของรางวัลเรียบร้อย');
    } else {
        await sb.from('rewards').insert([{
            name, description: desc, points_required: pointsRequired, stock, image
        }]);
        showToast('เพิ่มของรางวัลใหม่สำเร็จ');
    }

    await syncAllDataFromCloud();
    closeModal('reward-modal');
    renderAdminRewards();
}

async function deleteReward(id) {
    if (confirm('ยืนยันลบของรางวัลรายการนี้หรือไม่?')) {
        await sb.from('rewards').delete().eq('id', id);
        await syncAllDataFromCloud();
        renderAdminRewards();
        showToast('ลบของรางวัลเรียบร้อย');
    }
}

/* ==========================================================
   รายงานสรุปยอดขายรายวัน/รายเดือน + Audit Log + CSV Export
   ========================================================== */
function setReportPeriod(period) {
    reportPeriod = period;
    ['today', 'week', 'month', 'all'].forEach(p => {
        const btn = document.getElementById(`rep-filter-${p}`);
        if (btn) btn.className = p === period ? 'btn btn-primary' : 'btn btn-outline';
    });
    renderAdminReport();
}

function filterByReportPeriod(list) {
    const now = new Date();
    return list.filter(item => {
        const d = new Date(item.createdAt);
        if (reportPeriod === 'today') {
            return d.toDateString() === now.toDateString();
        }
        if (reportPeriod === 'week') {
            const diffDays = (now - d) / (1000 * 60 * 60 * 24);
            return diffDays <= 7;
        }
        if (reportPeriod === 'month') {
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        return true;
    });
}

function renderAdminReport() {
    const container = document.getElementById('report-summary-content');
    const filteredEarns = filterByReportPeriod(appState.earnHistory);
    const filteredRedeems = filterByReportPeriod(appState.redeemHistory);

    const periodSales = filteredEarns.reduce((s, x) => s + Number(x.amount), 0);
    const periodPointsGiven = filteredEarns.reduce((s, x) => s + (x.pointsEarned > 0 ? x.pointsEarned : 0), 0);
    const periodRedeemedPts = filteredRedeems.reduce((s, x) => s + Number(x.pointsUsed), 0);

    const periodLabels = {
        today: 'วันนี้',
        week: '7 วันล่าสุด',
        month: 'เดือนนี้',
        all: 'ทั้งหมดตั้งแต่เปิดระบบ'
    };

    const topMembers = [...appState.users]
        .filter(u => u.role === 'member')
        .sort((a, b) => b.points - a.points)
        .slice(0, 5);

    const auditLogs = appState.earnHistory
        .filter(e => (e.note || '').includes('[แอดมินปรับยอด'))
        .slice(0, 10);

    container.innerHTML = `
        <div class="report-kpi-grid" style="margin-bottom: 22px;">
            <div class="report-kpi-box">
                <span>ยอดขายรวม (${periodLabels[reportPeriod]})</span>
                <strong>${periodSales.toLocaleString()} ฿</strong>
                <small>จาก ${filteredEarns.filter(e => e.amount > 0).length} บิล</small>
            </div>
            <div class="report-kpi-box">
                <span>แต้มที่แจกออก (${periodLabels[reportPeriod]})</span>
                <strong style="color: var(--success-green);">+${periodPointsGiven.toLocaleString()} แต้ม</strong>
                <small>รวมยอดซื้อและโบนัส</small>
            </div>
            <div class="report-kpi-box">
                <span>แต้มที่ถูกแลกใช้ (${periodLabels[reportPeriod]})</span>
                <strong style="color: var(--danger-red);">-${periodRedeemedPts.toLocaleString()} แต้ม</strong>
                <small>จำนวน ${filteredRedeems.length} รายการ</small>
            </div>
        </div>

        <h4 style="margin-bottom:10px; color:var(--primary-blue);">
            <i class="fa-solid fa-ranking-star"></i> 5 อันดับสมาชิกที่มีแต้มสะสมสูงสุด
        </h4>
        <table class="data-table" style="margin-bottom: 24px;">
            <thead>
                <tr>
                    <th>อันดับ</th>
                    <th>ชื่อ-นามสกุล</th>
                    <th>เบอร์โทรศัพท์</th>
                    <th>ระดับ</th>
                    <th>แต้มสะสม</th>
                </tr>
            </thead>
            <tbody>
                ${topMembers.map((m, i) => {
                    const tier = calculateMemberTier(m.id);
                    return `
                        <tr>
                            <td>#${i + 1}</td>
                            <td>${m.fullName}</td>
                            <td>${m.studentId}</td>
                            <td><span class="tier-pill ${tier.cssClass}">${tier.name}</span></td>
                            <td><strong>${m.points} แต้ม</strong></td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>

        <h4 style="margin-bottom:10px; color:var(--primary-blue);">
            <i class="fa-solid fa-shield-halved"></i> ประวัติการแก้ไขแต้มโดยผู้ดูแลร้าน (Audit Log)
        </h4>
        <table class="data-table">
            <thead>
                <tr>
                    <th>วัน-เวลา</th>
                    <th>สมาชิกที่ถูกปรับแต้ม</th>
                    <th>รายละเอียด & เหตุผล</th>
                    <th>จำนวนแต้มที่ปรับ</th>
                </tr>
            </thead>
            <tbody>
                ${auditLogs.length ? auditLogs.map(log => `
                    <tr>
                        <td>${formatDate(log.createdAt)}</td>
                        <td><strong>${log.userName}</strong></td>
                        <td>${log.note}</td>
                        <td style="color:${log.pointsEarned >= 0 ? 'var(--success-green)' : 'var(--danger-red)'}; font-weight:700;">
                            ${log.pointsEarned >= 0 ? '+' + log.pointsEarned : log.pointsEarned} แต้ม
                        </td>
                    </tr>
                `).join('') : `<tr><td colspan="4" style="text-align:center; color:#64748B;">ยังไม่มีประวัติการปรับแก้แต้มโดยแอดมิน</td></tr>`}
            </tbody>
        </table>
    `;
}

function exportReportCSV() {
    const filteredEarns = filterByReportPeriod(appState.earnHistory);
    let csv = '\uFEFFวัน-เวลา,ชื่อสมาชิก,รายการ/หมายเหตุ,ยอดซื้อ(บาท),แต้มที่ได้รับ\n';
    filteredEarns.forEach(item => {
        const row = [
            `"${formatDate(item.createdAt)}"`,
            `"${item.userName}"`,
            `"${(item.note || '').replace(/"/g, '""')}"`,
            item.amount,
            item.pointsEarned
        ];
        csv += row.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `รายงานร้านมักอาชีวะ_${reportPeriod}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('ส่งออกไฟล์รายงาน CSV เรียบร้อยแล้ว!');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

/* ==========================================================
   เริ่มต้นโหลดข้อมูลเมื่อเปิดหน้าเว็บ (Auto-Login ถ้าระบบจดจำไว้)
   ========================================================== */
window.addEventListener('DOMContentLoaded', async () => {
    setupDragAndDropZones();
    await syncAllDataFromCloud();

    const saved = getSavedSessionUser();
    if (saved && saved.id) {
        const foundUser = appState.users.find(u => u.id === saved.id);
        if (foundUser) {
            appState.currentUser = foundUser;
            initAppView();
        }
    }
});
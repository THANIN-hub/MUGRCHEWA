/* ==========================================================
   ระบบ POS คาเฟ่ & สะสมแต้มสมาชิกดิจิทัล ร้านมักอาชีวะ
   ไฟล์: app.js (เชื่อมต่อฐานข้อมูลกลาง Supabase + Touch POS + Payment + E-Receipt Print)
   ========================================================== */

const SUPABASE_URL = 'https://ziaekbkkadjpmgmhqlyk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppYWVrYmtrYWRqcG1nbWhxbHlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3NjA3MDcsImV4cCI6MjExMTMzNjcwN30.l7l0Y_HDeQR25f1KOer1RXGLTldIAiWEq3zFQptk1_c';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const SESSION_KEY = 'muk_rcheewa_user_id';

let db = {
    settings: {
        baht_per_point: 20,
        welcome_bonus: 5
    },
    users: [],
    products: [],
    rewards: [],
    point_history: [],
    redemptions: [],
    promotions: []
};

let currentUser = null;
let rewardFilterMode = 'all';
let reportPeriod = 'today';
let isRedeeming = false;
let promoSlideIndex = 0;
let promoSlideTimer = null;
let realtimeChannel = null;

// สถานะหน้าขาย POS คาเฟ่
let posSelectedCategory = 'ทั้งหมด';
let posPaymentMethod = 'cash'; // 'cash' หรือ 'transfer'
let posCart = []; // [{ id, name, price, qty }]

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
        const [usersRes, productsRes, rewardsRes, historyRes, redeemRes, promoRes, settingsRes] = await Promise.all([
            sb.from('users').select('*').order('id', { ascending: true }),
            sb.from('products').select('*').order('id', { ascending: true }),
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

        if (productsRes.error) {
            console.warn('Products table warning:', productsRes.error.message);
        }

        db.users = usersRes.data || [];
        db.products = productsRes.data || [];
        db.rewards = rewardsRes.data || [];
        db.point_history = historyRes.data || [];
        db.redemptions = redeemRes.data || [];
        db.promotions = promoRes.data || [];

        db.settings = {
            baht_per_point: 20,
            welcome_bonus: 5
        };

        if (Array.isArray(settingsRes.data)) {
            settingsRes.data.forEach(s => {
                if (!s || !s.setting_key) return;
                if (s.setting_key !== 'lucky_spin_config' && !s.setting_key.startsWith('reset_req_')) {
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

function getLocalDateKey(isoString) {
    const d = isoString ? new Date(isoString) : new Date();
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMemberTierInfo(userId, currentPoints = 0) {
    const earnedSum = db.point_history
        .filter(h => String(h.user_id) === String(userId) && Number(h.points_earned) > 0)
        .reduce((sum, h) => sum + (Number(h.points_earned) || 0), 0);

    const lifetimePoints = Math.max(earnedSum, Number(currentPoints) || 0);

    if (lifetimePoints >= 300) {
        return {
            name: 'PLATINUM',
            label: 'ระดับ PLATINUM',
            cssClass: 'tier-platinum',
            icon: 'fa-gem',
            nextText: `ระดับสูงสุด PLATINUM (สะสมรวม ${lifetimePoints} แต้ม)`
        };
    } else if (lifetimePoints >= 150) {
        const diff = 300 - lifetimePoints;
        return {
            name: 'GOLD',
            label: 'ระดับ GOLD',
            cssClass: 'tier-gold',
            icon: 'fa-crown',
            nextText: `อีก ${diff} แต้ม ขึ้นระดับ PLATINUM`
        };
    } else if (lifetimePoints >= 50) {
        const diff = 150 - lifetimePoints;
        return {
            name: 'SILVER',
            label: 'ระดับ SILVER',
            cssClass: 'tier-silver',
            icon: 'fa-award',
            nextText: `อีก ${diff} แต้ม ขึ้นระดับ GOLD`
        };
    } else {
        const diff = 50 - lifetimePoints;
        return {
            name: 'MEMBER',
            label: 'ระดับ MEMBER',
            cssClass: 'tier-member',
            icon: 'fa-medal',
            nextText: `อีก ${diff} แต้ม ขึ้นระดับ SILVER`
        };
    }
}

// ==========================================================
// ตัวช่วยแปลงรายละเอียดบิลใน point_history เพื่อสร้าง E-Receipt ย้อนหลัง
// ==========================================================
function parseHistoryNoteToReceipt(record) {
    const rawNote = String(record.note || '').trim();
    const totalAmount = Number(record.amount) || 0;
    const pointsEarned = Number(record.points_earned) || 0;
    const user = db.users.find(u => String(u.id) === String(record.user_id));
    const member = (user && user.role === 'member') ? user : null;

    let paymentMethod = 'cash';
    let cleanBody = rawNote;

    if (cleanBody.includes('โอนเงิน') || cleanBody.includes('QR')) {
        paymentMethod = 'transfer';
    }

    // ตัดแท็กหัวข้อออก เช่น [เงินสด] หรือ [ลูกค้าทั่วไป | โอนเงิน / QR]
    cleanBody = cleanBody.replace(/^\[.*?\]\s*/, '');

    // แยกหมายเหตุในวงเล็บท้ายข้อความ (ถ้ามี)
    let note = '';
    const noteMatch = cleanBody.match(/\s*\(([^()]+)\)\s*$/);
    if (noteMatch) {
        note = noteMatch[1].trim();
        cleanBody = cleanBody.slice(0, noteMatch.index).trim();
    }

    // แยกรายการสินค้า เช่น "ลาเต้เย็น x2, ชาไทยเย็น x1"
    const items = [];
    if (cleanBody) {
        const parts = cleanBody.split(',').map(s => s.trim()).filter(Boolean);
        parts.forEach(part => {
            const m = part.match(/^(.*?)\s+x(\d+)$/i);
            if (m) {
                const itemName = m[1].trim();
                const qty = parseInt(m[2], 10) || 1;
                const prod = db.products.find(p => String(p.name || '').trim() === itemName);
                const unitPrice = prod ? (Number(prod.price) || 0) : 0;
                items.push({ name: itemName, price: unitPrice, qty });
            } else {
                items.push({ name: part, price: 0, qty: 1 });
            }
        });
    }

    // คำนวณราคาต่อรายการย้อนกลับหากเมนูถูกลบไปแล้ว
    if (items.length === 1 && items[0].price === 0 && totalAmount > 0) {
        items[0].price = totalAmount / items[0].qty;
    } else if (items.length > 1) {
        const knownSum = items.reduce((s, it) => s + (it.price * it.qty), 0);
        if (knownSum === 0 && totalAmount > 0) {
            items.forEach((it, idx) => {
                it.price = idx === 0 ? (totalAmount / it.qty) : 0;
            });
        }
    }

    if (!items.length) {
        items.push({
            name: rawNote || 'รายการสั่งซื้อหน้าร้าน',
            price: totalAmount,
            qty: 1
        });
    }

    return {
        billId: record.id,
        createdAt: record.created_at,
        member,
        items,
        note,
        totalAmount,
        paymentMethod,
        cashReceived: totalAmount,
        changeAmount: 0,
        pointsEarned,
        newPointsBalance: member ? (Number(member.points) || 0) : null,
        isFromHistory: true
    };
}

function viewHistoryEReceipt(historyId, showNewBanner = false) {
    const rec = db.point_history.find(h => String(h.id) === String(historyId));
    if (!rec) {
        showToast('ไม่พบข้อมูลบิลใบเสร็จรายการนี้');
        return;
    }
    const receiptData = parseHistoryNoteToReceipt(rec);
    receiptData.isNewPush = showNewBanner;
    openPOSReceiptModal(receiptData);
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
        document.getElementById('nav-user-role').textContent = 'แคชเชียร์ / ผู้ดูแล';
        document.getElementById('member-dashboard')?.classList.add('hidden');
        document.getElementById('admin-dashboard')?.classList.remove('hidden');
        renderAdminDashboard();
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
// 1. ระบบสมาชิก (Member Functions: Barcode, Tier, Rewards, History & E-Receipt)
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
        const amt = Number(item.amount) || 0;
        const ptsDisplay = pts >= 0
            ? `<strong style="color:var(--success-green);">+${pts} แต้ม</strong>`
            : `<strong style="color:var(--danger-red);">${pts} แต้ม</strong>`;

        const receiptBtn = amt > 0
            ? `<button type="button" class="btn btn-outline-sm" onclick="viewHistoryEReceipt(${Number(item.id)}, false)">
                   <i class="fa-solid fa-receipt"></i> ดูใบเสร็จ
               </button>`
            : '<span class="text-muted">-</span>';

        return `
            <tr>
                <td><strong>${formatTicketCode(item.id)}</strong></td>
                <td>${formatDateTime(item.created_at)}</td>
                <td>${escapeHTML(item.note || 'ซื้อสินค้าภายในร้าน')}</td>
                <td><strong>${amt.toLocaleString()}</strong> บาท</td>
                <td>${ptsDisplay}</td>
                <td>${receiptBtn}</td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center;">ยังไม่มีประวัติการซื้อสินค้าและสะสมแต้ม</td></tr>';

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
}

// ==========================================================
// 2. ระบบผู้ดูแลร้าน & หน้าขาย POS คาเฟ่ (Cafe Touch POS + Payment + E-Receipt)
// ==========================================================
async function switchAdminTab(tabName, btnElement) {
    document.querySelectorAll('#admin-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#admin-dashboard .tab-content').forEach(c => c.classList.remove('active'));

    btnElement?.classList.add('active');
    document.getElementById(`admin-tab-${tabName}`)?.classList.add('active');

    await syncFromCloud();
    renderAdminDashboard();
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

    const rateInput = document.getElementById('setting-baht-per-point');
    const rateLabel = document.getElementById('pos-current-rate-label');
    if (rateInput) rateInput.value = db.settings.baht_per_point;
    if (rateLabel) rateLabel.textContent = db.settings.baht_per_point;

    renderPOSMemberSelect();
    renderPOSCafeMenu();
    renderPOSCart();
    renderAdminProducts();
    renderAdminRedemptions();
    renderAdminPromotions();
    renderAdminMembers();
    renderAdminRewards();
    renderAdminReports();
}

// --- หน้าขาย POS คาเฟ่: แสดงปุ่มเมนู & จัดการตะกร้า ---
function selectPOSCategory(cat) {
    posSelectedCategory = cat;
    renderPOSCafeMenu();
}

function renderPOSCafeMenu() {
    const catBar = document.getElementById('pos-category-tabs');
    const grid = document.getElementById('pos-menu-grid');
    if (!catBar || !grid) return;

    const availableProducts = (db.products || []).filter(p => p.is_available !== false);

    const categories = ['ทั้งหมด', ...new Set(availableProducts.map(p => p.category || 'อื่นๆ'))];
    if (!categories.includes(posSelectedCategory)) {
        posSelectedCategory = 'ทั้งหมด';
    }

    catBar.innerHTML = categories.map(cat => `
        <button type="button" class="pos-cat-btn ${posSelectedCategory === cat ? 'active' : ''}" onclick="selectPOSCategory('${escapeHTML(cat)}')">
            ${escapeHTML(cat)}
        </button>
    `).join('');

    const filtered = posSelectedCategory === 'ทั้งหมด'
        ? availableProducts
        : availableProducts.filter(p => (p.category || 'อื่นๆ') === posSelectedCategory);

    if (!filtered.length) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 36px 16px; color: var(--text-muted);">
                <i class="fa-solid fa-mug-saucer" style="font-size: 32px; margin-bottom: 8px; display: block;"></i>
                ยังไม่มีเมนูในหมวดนี้ กดปุ่ม <strong>"+ เพิ่มเมนูใหม่"</strong> ด้านบนเพื่อเพิ่มรายการได้เลย
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(prod => {
        const cartItem = posCart.find(c => String(c.id) === String(prod.id));
        const qtyInCart = cartItem ? cartItem.qty : 0;
        const price = Number(prod.price) || 0;

        return `
            <button type="button" class="pos-menu-btn ${qtyInCart > 0 ? 'in-cart' : ''}" onclick="addToPOSCart(${Number(prod.id)})">
                ${qtyInCart > 0 ? `<span class="pos-menu-qty-badge">${qtyInCart}</span>` : ''}
                <span class="pos-menu-cat-tag">${escapeHTML(prod.category || 'เมนูร้าน')}</span>
                <div class="pos-menu-name">${escapeHTML(prod.name)}</div>
                <div class="pos-menu-price">${price.toLocaleString()} ฿</div>
            </button>
        `;
    }).join('');
}

function addToPOSCart(productId) {
    const product = db.products.find(p => String(p.id) === String(productId));
    if (!product) return;

    const existing = posCart.find(c => String(c.id) === String(productId));
    if (existing) {
        existing.qty += 1;
    } else {
        posCart.push({
            id: product.id,
            name: product.name,
            price: Number(product.price) || 0,
            qty: 1
        });
    }

    renderPOSCafeMenu();
    renderPOSCart();
}

function changePOSCartQty(productId, delta) {
    const idx = posCart.findIndex(c => String(c.id) === String(productId));
    if (idx === -1) return;

    posCart[idx].qty += delta;
    if (posCart[idx].qty <= 0) {
        posCart.splice(idx, 1);
    }

    renderPOSCafeMenu();
    renderPOSCart();
}

function clearPOSCart() {
    posCart = [];
    const cashInput = document.getElementById('pos-cash-received');
    const noteInput = document.getElementById('pos-note');
    if (cashInput) cashInput.value = '';
    if (noteInput) noteInput.value = '';
    setPaymentMethod('cash');
    renderPOSCafeMenu();
    renderPOSCart();
}

function getPOSTotalAmount() {
    return posCart.reduce((sum, item) => sum + (item.price * item.qty), 0);
}

function renderPOSCart() {
    const container = document.getElementById('pos-cart-items');
    if (!container) return;

    if (!posCart.length) {
        container.innerHTML = `
            <div class="pos-empty-cart">
                <i class="fa-solid fa-hand-pointer"></i>
                <p>คลิกเลือกเมนูทางฝั่งซ้ายเพื่อเพิ่มรายการสั่งซื้อ</p>
            </div>
        `;
    } else {
        container.innerHTML = posCart.map(item => `
            <div class="pos-cart-row">
                <div class="pos-cart-info">
                    <strong>${escapeHTML(item.name)}</strong>
                    <small>${item.price.toLocaleString()} ฿ / รายการ</small>
                </div>
                <div class="pos-qty-controls">
                    <button type="button" class="btn-qty" onclick="changePOSCartQty(${Number(item.id)}, -1)">-</button>
                    <span class="pos-qty-val">${item.qty}</span>
                    <button type="button" class="btn-qty" onclick="changePOSCartQty(${Number(item.id)}, 1)">+</button>
                </div>
                <div class="pos-row-subtotal">${(item.price * item.qty).toLocaleString()} ฿</div>
            </div>
        `).join('');
    }

    const totalQty = posCart.reduce((sum, item) => sum + item.qty, 0);
    const totalAmount = getPOSTotalAmount();
    const rate = Math.max(1, parseInt(db.settings.baht_per_point, 10) || 20);
    const hasMember = Boolean(document.getElementById('pos-selected-user-id')?.value);
    const pointsEarned = (hasMember && totalAmount > 0) ? Math.floor(totalAmount / rate) : 0;

    document.getElementById('pos-total-qty').textContent = `${totalQty} รายการ`;
    document.getElementById('pos-total-amount').textContent = `${totalAmount.toLocaleString()} ฿`;
    document.getElementById('pos-preview-points').textContent = hasMember
        ? `+${pointsEarned} แต้ม`
        : 'ไม่ระบุสมาชิก (0 แต้ม)';

    calculatePOSChange();
}

// --- ระบบเลือกช่องทางชำระเงิน & คำนวณเงินทอน ---
function setPaymentMethod(method) {
    posPaymentMethod = method;
    const btnCash = document.getElementById('pay-method-cash');
    const btnTransfer = document.getElementById('pay-method-transfer');
    const cashSec = document.getElementById('pos-cash-section');
    const transferSec = document.getElementById('pos-transfer-section');

    if (method === 'cash') {
        btnCash?.classList.add('active');
        btnTransfer?.classList.remove('active');
        cashSec?.classList.remove('hidden');
        transferSec?.classList.add('hidden');
    } else {
        btnCash?.classList.remove('active');
        btnTransfer?.classList.add('active');
        cashSec?.classList.add('hidden');
        transferSec?.classList.remove('hidden');
    }
}

function setExactCash() {
    const total = getPOSTotalAmount();
    const input = document.getElementById('pos-cash-received');
    if (input) {
        input.value = total;
        calculatePOSChange();
    }
}

function addCashReceived(amount) {
    const input = document.getElementById('pos-cash-received');
    if (input) {
        const current = parseFloat(input.value) || 0;
        input.value = current + amount;
        calculatePOSChange();
    }
}

function calculatePOSChange() {
    const total = getPOSTotalAmount();
    const cashInput = document.getElementById('pos-cash-received');
    const changeEl = document.getElementById('pos-change-amount');
    if (!changeEl) return;

    const rawCash = cashInput?.value.trim();
    if (!rawCash) {
        changeEl.textContent = '0 ฿';
        changeEl.style.color = 'var(--text-muted)';
        return;
    }

    const cash = parseFloat(rawCash) || 0;
    const diff = cash - total;
    if (diff >= 0) {
        changeEl.textContent = `${diff.toLocaleString()} ฿`;
        changeEl.style.color = 'var(--success-green)';
    } else {
        changeEl.textContent = `ขาดอีก ${Math.abs(diff).toLocaleString()} ฿`;
        changeEl.style.color = 'var(--danger-red)';
    }
}

function clearPOSMember() {
    const searchInput = document.getElementById('pos-member-search');
    const hiddenId = document.getElementById('pos-selected-user-id');
    const statusBox = document.getElementById('pos-member-status');

    if (searchInput) searchInput.value = '';
    if (hiddenId) hiddenId.value = '';
    if (statusBox) statusBox.innerHTML = '';
    renderPOSCart();
}

function handlePOSBarcodeKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        handlePOSMemberSearch(true);
    }
}

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
            <div style="background: #DCFCE7; border: 1.5px solid #16A34A; border-radius: 10px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="font-size: 11.5px; color: #166534; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> สมาชิก (${escapeHTML(tier.name)}) — ส่ง E-Receipt อัตโนมัติ</span>
                    <div style="font-size: 14.5px; font-weight: 700; color: #0F172A;">${escapeHTML(found.full_name)} (${escapeHTML(found.student_id || '-')})</div>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 11px; color: #166534;">แต้มเดิม</span>
                    <div style="font-size: 18px; font-weight: 700; color: #1E3A8A;">${pts.toLocaleString()}</div>
                </div>
            </div>
        `;

        if (fromScannerEnter || (cleanDigits.length === 10 && String(found.student_id).replace(/\D/g, '') === cleanDigits)) {
            searchInput.value = `${found.student_id || found.username} | ${found.full_name}`;
            if (fromScannerEnter) {
                showToast(`พบข้อมูลสมาชิก: คุณ ${found.full_name}`);
            }
        }
    } else {
        hiddenId.value = '';
        if (input) {
            statusBox.innerHTML = `<small style="color: var(--danger-red);"><i class="fa-solid fa-magnifying-glass"></i> ${fromScannerEnter ? 'ไม่พบข้อมูลสมาชิกนี้ในระบบ' : 'กำลังค้นหาสมาชิก...'}</small>`;
        } else {
            statusBox.innerHTML = '';
        }
    }

    renderPOSCart();
}

// --- ยืนยันชำระเงิน บันทึกออเดอร์ และเปิดหน้าต่างใบเสร็จ + ส่ง E-Receipt ให้สมาชิก ---
async function handleCheckoutPOS() {
    if (!posCart.length) {
        showToast('กรุณาคลิกเลือกเมนูอย่างน้อย 1 รายการก่อนบันทึก');
        return;
    }

    const totalAmount = getPOSTotalAmount();
    const rawCash = document.getElementById('pos-cash-received')?.value.trim();
    let cashReceived = totalAmount;
    let changeAmount = 0;

    if (posPaymentMethod === 'cash' && rawCash) {
        cashReceived = parseFloat(rawCash) || 0;
        if (cashReceived < totalAmount) {
            showToast(`จำนวนเงินสดที่รับมาไม่พอขาดอีก ${(totalAmount - cashReceived).toLocaleString()} บาท`);
            return;
        }
        changeAmount = cashReceived - totalAmount;
    }

    const btn = document.getElementById('btn-pos-checkout');
    const userId = document.getElementById('pos-selected-user-id').value;
    const customNote = document.getElementById('pos-note').value.trim();
    const orderSnapshot = posCart.map(item => ({ ...item }));
    const payMethodLabel = posPaymentMethod === 'cash' ? 'เงินสด' : 'โอนเงิน / QR';

    const itemsSummary = orderSnapshot.map(item => `${item.name} x${item.qty}`).join(', ');
    const fullNote = customNote
        ? `[${payMethodLabel}] ${itemsSummary} (${customNote})`
        : `[${payMethodLabel}] ${itemsSummary}`;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึกออเดอร์...';
    }

    try {
        const ok = await syncFromCloud();
        if (!ok) return;

        let member = null;
        let pointsEarned = 0;
        let newPointsBalance = 0;

        if (userId) {
            member = db.users.find(u => String(u.id) === String(userId));
            if (member) {
                const rate = Math.max(1, parseInt(db.settings.baht_per_point, 10) || 20);
                pointsEarned = Math.floor(totalAmount / rate);
                newPointsBalance = (Number(member.points) || 0) + pointsEarned;

                const updRes = await sb.from('users').update({ points: newPointsBalance }).eq('id', member.id);
                if (updRes.error) {
                    showToast('เกิดข้อผิดพลาดในการเพิ่มแต้มสมาชิก: ' + updRes.error.message);
                    return;
                }
            }
        }

        const targetUserId = member ? member.id : currentUser.id;
        const insRes = await sb.from('point_history').insert([{
            user_id: targetUserId,
            amount: totalAmount,
            points_earned: member ? pointsEarned : 0,
            note: member ? fullNote : `[ลูกค้าทั่วไป | ${payMethodLabel}] ${itemsSummary}${customNote ? ' (' + customNote + ')' : ''}`
        }]).select().single();

        if (insRes.error) {
            showToast('เกิดข้อผิดพลาดในการบันทึกออเดอร์: ' + insRes.error.message);
            return;
        }

        // เปิดหน้าต่างสรุปออเดอร์ & ใบเสร็จรับเงินฝั่งแอดมิน
        openPOSReceiptModal({
            billId: insRes.data ? insRes.data.id : Date.now(),
            createdAt: insRes.data ? insRes.data.created_at : new Date().toISOString(),
            member,
            items: orderSnapshot,
            note: customNote,
            totalAmount,
            paymentMethod: posPaymentMethod,
            cashReceived,
            changeAmount,
            pointsEarned,
            newPointsBalance
        });

        if (member) {
            showToast(`บันทึกบิลและส่งใบเสร็จอิเล็กทรอนิกส์ให้คุณ ${member.full_name} เรียบร้อยแล้ว`);
        } else {
            showToast('บันทึกบิลและออกใบเสร็จเรียบร้อยแล้ว');
        }

        clearPOSCart();
        clearPOSMember();

        await syncFromCloud();
        renderAdminDashboard();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-print"></i> ยืนยันชำระเงิน & ออกใบเสร็จ';
        }
    }
}

function openPOSReceiptModal(receiptData) {
    const bannerEl = document.getElementById('rec-ereceipt-banner');
    if (bannerEl) {
        bannerEl.style.display = receiptData.isNewPush ? 'block' : 'none';
    }

    document.getElementById('rec-bill-no').textContent = `เลขที่บิล: ${formatTicketCode(receiptData.billId)}`;
    document.getElementById('rec-datetime').textContent = `วันที่: ${formatDateTime(receiptData.createdAt)}`;

    const custNameEl = document.getElementById('rec-customer-name');
    const phoneRowEl = document.getElementById('rec-member-phone-row');
    const phoneValEl = document.getElementById('rec-customer-phone');

    if (receiptData.member) {
        custNameEl.textContent = receiptData.member.full_name;
        phoneRowEl.style.display = 'block';
        phoneValEl.textContent = receiptData.member.student_id || '-';
    } else {
        custNameEl.textContent = 'ลูกค้าทั่วไป';
        phoneRowEl.style.display = 'none';
    }

    const tbody = document.getElementById('rec-items-tbody');
    tbody.innerHTML = receiptData.items.map(item => {
        const lineTotal = item.price * item.qty;
        return `
            <tr>
                <td>${escapeHTML(item.name)}</td>
                <td style="text-align: center;">x${item.qty}</td>
                <td style="text-align: right;">${lineTotal > 0 ? lineTotal.toLocaleString() + ' ฿' : '-'}</td>
            </tr>
        `;
    }).join('');

    const noteRow = document.getElementById('rec-note-row');
    if (receiptData.note) {
        noteRow.style.display = 'block';
        document.getElementById('rec-note-text').textContent = receiptData.note;
    } else {
        noteRow.style.display = 'none';
    }

    document.getElementById('rec-total-amount').textContent = `${receiptData.totalAmount.toLocaleString()} ฿`;
    document.getElementById('rec-pay-method').textContent = receiptData.paymentMethod === 'cash' ? 'เงินสด' : 'โอนเงิน / QR';

    const cashRow = document.getElementById('rec-cash-row');
    const changeRow = document.getElementById('rec-change-row');
    if (receiptData.paymentMethod === 'cash' && !receiptData.isFromHistory) {
        cashRow.style.display = 'flex';
        changeRow.style.display = 'flex';
        document.getElementById('rec-cash-received').textContent = `${receiptData.cashReceived.toLocaleString()} ฿`;
        document.getElementById('rec-change-amount').textContent = `${receiptData.changeAmount.toLocaleString()} ฿`;
    } else {
        cashRow.style.display = 'none';
        changeRow.style.display = 'none';
    }

    const pointsBox = document.getElementById('rec-points-box');
    const balanceRow = document.getElementById('rec-points-balance-row');
    if (receiptData.member) {
        pointsBox.style.display = 'block';
        document.getElementById('rec-points-earned').textContent = `+${receiptData.pointsEarned} แต้ม`;
        if (receiptData.newPointsBalance !== null && receiptData.newPointsBalance !== undefined) {
            if (balanceRow) balanceRow.style.display = 'block';
            document.getElementById('rec-points-balance').textContent = `${Number(receiptData.newPointsBalance).toLocaleString()} แต้ม`;
        } else if (balanceRow) {
            balanceRow.style.display = 'none';
        }
    } else {
        pointsBox.style.display = 'none';
    }

    document.getElementById('pos-receipt-modal')?.classList.remove('hidden');
}

function printPOSReceipt() {
    window.print();
}

// --- จัดการเมนูอาหารและเครื่องดื่มของร้าน (Product CRUD) ---
function renderAdminProducts() {
    const tbody = document.getElementById('admin-products-tbody');
    if (!tbody) return;
    const keyword = (document.getElementById('product-search')?.value || '').toLowerCase().trim();

    const filtered = (db.products || []).filter(p =>
        String(p.name || '').toLowerCase().includes(keyword) ||
        String(p.category || '').toLowerCase().includes(keyword)
    );

    tbody.innerHTML = filtered.length ? filtered.map(p => {
        const isAvail = p.is_available !== false;
        return `
            <tr>
                <td><strong>${escapeHTML(p.name)}</strong></td>
                <td>${escapeHTML(p.category || '-')}</td>
                <td><strong>${(Number(p.price) || 0).toLocaleString()}</strong> บาท</td>
                <td>
                    ${isAvail
                        ? '<span class="status-pill status-approved">พร้อมขาย</span>'
                        : '<span class="status-pill status-rejected">หมดชั่วคราว</span>'}
                </td>
                <td>
                    <button type="button" class="btn btn-outline-sm" onclick="openProductModal(${Number(p.id)})">
                        <i class="fa-solid fa-pen"></i> แก้ไข
                    </button>
                    <button type="button" class="btn btn-danger" onclick="deleteProduct(${Number(p.id)})">
                        <i class="fa-solid fa-trash"></i> ลบ
                    </button>
                </td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="5" style="text-align:center;">ยังไม่มีรายการเมนู กด "+ เพิ่มเมนูใหม่" ด้านบน</td></tr>';
}

function openProductModal(productId = null) {
    const modal = document.getElementById('product-modal');
    const title = document.getElementById('product-modal-title');

    if (productId) {
        const p = db.products.find(item => String(item.id) === String(productId));
        if (!p) return;
        title.textContent = 'แก้ไขเมนูร้าน';
        document.getElementById('edit-product-id').value = p.id;
        document.getElementById('modal-prod-name').value = p.name;
        document.getElementById('modal-prod-category').value = p.category || 'กาแฟ';
        document.getElementById('modal-prod-price').value = Number(p.price) || 0;
        document.getElementById('modal-prod-available').value = p.is_available !== false ? '1' : '0';
    } else {
        title.textContent = 'เพิ่มเมนูใหม่';
        document.getElementById('edit-product-id').value = '';
        document.getElementById('modal-prod-name').value = '';
        document.getElementById('modal-prod-category').value = 'กาแฟ';
        document.getElementById('modal-prod-price').value = '';
        document.getElementById('modal-prod-available').value = '1';
    }
    modal?.classList.remove('hidden');
}

async function saveProduct(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-product');
    const id = document.getElementById('edit-product-id').value;
    const name = document.getElementById('modal-prod-name').value.trim();
    const category = document.getElementById('modal-prod-category').value.trim() || 'ทั่วไป';
    const price = Math.max(0, parseFloat(document.getElementById('modal-prod-price').value) || 0);
    const is_available = document.getElementById('modal-prod-available').value === '1';

    if (!name) {
        showToast('กรุณากรอกชื่อเมนู');
        return;
    }

    if (btn) btn.disabled = true;

    try {
        if (id) {
            const { error } = await sb.from('products').update({
                name,
                category,
                price,
                is_available
            }).eq('id', parseInt(id, 10));

            if (error) {
                console.error('Update product error:', error);
                showToast(`แก้ไขเมนูไม่สำเร็จ: ${error.message}`);
                return;
            }
            showToast(`อัปเดตเมนู "${name}" เรียบร้อยแล้ว`);
        } else {
            const { error } = await sb.from('products').insert([{
                name,
                category,
                price,
                is_available
            }]);

            if (error) {
                console.error('Insert product error:', error);
                showToast(`เพิ่มเมนูไม่สำเร็จ: ${error.message}`);
                return;
            }
            showToast(`เพิ่มเมนู "${name}" เรียบร้อยแล้ว`);
        }

        closeModal('product-modal');
        await syncFromCloud();
        renderAdminDashboard();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteProduct(productId) {
    if (!confirm('ยืนยันการลบเมนูนี้ออกจากระบบหรือไม่?')) return;
    const { error } = await sb.from('products').delete().eq('id', productId);
    if (error) {
        showToast(`ลบเมนูไม่สำเร็จ: ${error.message}`);
        return;
    }
    posCart = posCart.filter(c => String(c.id) !== String(productId));
    await syncFromCloud();
    renderAdminDashboard();
    showToast('ลบเมนูเรียบร้อยแล้ว');
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
    const rateLabel = document.getElementById('pos-current-rate-label');
    if (rateLabel) rateLabel.textContent = newRate;
    renderPOSCart();
    showToast(`อัปเดตอัตราคำนวณแต้มเป็น ทุก ${newRate} บาท = 1 แต้ม`);
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

// --- ส่วนรายงานสรุปยอดขายรายวัน/รายเดือน & บิลขายย้อนหลัง & Audit Log ---
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

    const recentSales = filteredHistory.filter(h => (Number(h.amount) || 0) > 0).slice(0, 25);
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
            <h4 style="color:var(--primary-blue); margin-bottom:10px;"><i class="fa-solid fa-receipt"></i> บิลขายล่าสุด & ใบเสร็จย้อนหลัง (${periodNames[reportPeriod]})</h4>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>เลขที่บิล</th>
                            <th>วัน-เวลา</th>
                            <th>ลูกค้า</th>
                            <th>รายการที่สั่ง</th>
                            <th>ยอดรวม</th>
                            <th>แต้มที่ได้</th>
                            <th>ใบเสร็จ</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recentSales.length ? recentSales.map(s => {
                            const user = db.users.find(u => String(u.id) === String(s.user_id));
                            const customerLabel = (user && user.role === 'member')
                                ? `${escapeHTML(user.full_name)} (${escapeHTML(user.student_id || '-')})`
                                : 'ลูกค้าทั่วไป';
                            return `
                                <tr>
                                    <td><strong>${formatTicketCode(s.id)}</strong></td>
                                    <td>${formatDateTime(s.created_at)}</td>
                                    <td>${customerLabel}</td>
                                    <td>${escapeHTML(s.note || '-')}</td>
                                    <td><strong>${(Number(s.amount) || 0).toLocaleString()} ฿</strong></td>
                                    <td>+${Number(s.points_earned) || 0} แต้ม</td>
                                    <td>
                                        <button type="button" class="btn btn-outline-sm" onclick="viewHistoryEReceipt(${Number(s.id)}, false)">
                                            <i class="fa-solid fa-print"></i> ดู / พิมพ์ซ้ำ
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('') : '<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">ยังไม่มีรายการขายในช่วงเวลานี้</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>

        <div style="margin-top: 24px;">
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

        <div style="margin-top: 24px;">
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
// ระบบซิงก์ข้อมูลอัตโนมัติแบบเรียลไทม์ (Supabase Realtime + Push E-Receipt)
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

                // หากมีบิลซื้อสินค้าใหม่ที่ผูกกับสมาชิกคนนี้ ให้ส่ง E-Receipt เด้งขึ้นหน้าจอทันที
                if (
                    payload.table === 'point_history' &&
                    payload.eventType === 'INSERT' &&
                    payload.new &&
                    String(payload.new.user_id) === String(currentUser.id) &&
                    (Number(payload.new.amount) || 0) > 0
                ) {
                    viewHistoryEReceipt(payload.new.id, true);
                    showToast(`ได้รับใบเสร็จอิเล็กทรอนิกส์ (${formatTicketCode(payload.new.id)}) และรับ +${Number(payload.new.points_earned) || 0} แต้ม!`);
                } else {
                    const updatedUser = db.users.find(u => String(u.id) === String(currentUser.id));
                    const newPts = updatedUser ? (Number(updatedUser.points) || 0) : oldPoints;
                    if (updatedUser && newPts > oldPoints) {
                        const diff = newPts - oldPoints;
                        showToast(`คุณได้รับเพิ่ม +${diff} แต้ม!`);
                    }
                }
            }
        })
        .subscribe();
}

restoreSession();
startRealtimeSync();
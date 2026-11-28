/* ==========================================================
   ระบบ POS คาเฟ่ & สะสมแต้มสมาชิกดิจิทัล ร้านมักอาชีวะ
   app.js - Complete Frontend Logic with LocalStorage Persistence
   ========================================================== */

const DB_KEY = 'MUG_RCHEWA_POS_DB_V1';

// ข้อมูลตั้งต้น (Initial Seed Data)
const DEFAULT_DB = {
    settings: {
        bahtPerPoint: 20,
        receipt: {
            logo: '',
            shopName: 'ร้านมักอาชีวะ (MUG R-CHEWA)',
            subtitle: 'ใบเสร็จรับเงินอิเล็กทรอนิกส์ / ใบสรุปรายการ',
            address: 'วิทยาลัยอาชีวศึกษา | เปิดบริการ 07:30 - 17:00 น.',
            footer1: 'ขอบคุณที่ใช้บริการครับ',
            footer2: 'ใบเสร็จอิเล็กทรอนิกส์จากระบบ POS ร้านมักอาชีวะ',
            showPoints: true
        }
    },
    users: [
        {
            id: 'admin-1',
            phone: 'admin',
            fullname: 'ผู้ดูแลร้านมักอาชีวะ',
            password: '1234',
            role: 'admin',
            points: 0,
            totalEarned: 0
        },
        {
            id: 'mem-1',
            phone: '0812345678',
            fullname: 'นายสมชาย ใจดี',
            password: '1234',
            role: 'member',
            points: 35,
            totalEarned: 85
        }
    ],
    products: [
        { id: 'p-1', name: 'เอสเพรสโซ่เย็น', category: 'กาแฟ', price: 45, available: 1 },
        { id: 'p-2', name: 'ลาเต้เย็น', category: 'กาแฟ', price: 50, available: 1 },
        { id: 'p-3', name: 'อเมริกาโน่เย็น', category: 'กาแฟ', price: 40, available: 1 },
        { id: 'p-4', name: 'ชาไทยเย็น', category: 'ชา', price: 40, available: 1 },
        { id: 'p-5', name: 'ชาเขียวมัทฉะเย็น', category: 'ชา', price: 45, available: 1 },
        { id: 'p-6', name: 'โกโก้เข้มข้น', category: 'นม/โกโก้', price: 40, available: 1 },
        { id: 'p-7', name: 'นมสดคาราเมล', category: 'นม/โกโก้', price: 45, available: 1 },
        { id: 'p-8', name: 'แดงมะนาวโซดา', category: 'อิตาเลียนโซดา', price: 35, available: 1 },
        { id: 'p-9', name: 'ขนมปังปิ้งเนยนม', category: 'ขนม/เบเกอรี่', price: 25, available: 1 },
        { id: 'p-10', name: 'ครัวซองต์เนยสด', category: 'ขนม/เบเกอรี่', price: 45, available: 1 }
    ],
    rewards: [
        {
            id: 'r-1',
            name: 'ฟรี! เครื่องดื่มเย็น 1 แก้ว',
            desc: 'แลกรับเครื่องดื่มเมนูใดก็ได้ในร้าน 1 แก้ว (มูลค่าไม่เกิน 50 บาท)',
            points: 10,
            stock: 50,
            image: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=500&q=80'
        },
        {
            id: 'r-2',
            name: 'ส่วนลดเงินสด 20 บาท',
            desc: 'ใช้เป็นส่วนลดท้ายบิลเมื่อสั่งเครื่องดื่มหรือขนมครบ 50 บาทขึ้นไป',
            points: 5,
            stock: 100,
            image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=500&q=80'
        },
        {
            id: 'r-3',
            name: 'ขนมปังปิ้งเนยนม 1 ชุด',
            desc: 'แลกรับขนมปังปิ้งหอมกรุ่น 1 ชุดทันทีที่เคาน์เตอร์',
            points: 6,
            stock: 30,
            image: 'https://images.unsplash.com/photo-1525351484163-7529414342d8?w=500&q=80'
        }
    ],
    promotions: [
        {
            id: 'promo-1',
            badge: 'โปรโมชั่นต้อนรับเปิดเทอม',
            title: 'สมัครสมาชิกใหม่ รับฟรีทันที 5 แต้มโบนัส!',
            desc: 'สะสมครบ 10 แต้ม แลกเครื่องดื่มเย็นฟรี 1 แก้วทันที',
            image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1000&q=80',
            active: 1
        },
        {
            id: 'promo-2',
            badge: 'Happy Hour',
            title: 'ทุกยอดซื้อ 20 บาท รับ 1 แต้มสะสม',
            desc: 'แสดงบาร์โค้ดสมาชิกหน้าเคาน์เตอร์ก่อนชำระเงินทุกครั้ง',
            image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1000&q=80',
            active: 1
        }
    ],
    orders: [],
    redemptions: [],
    auditLogs: []
};

let db = loadDB();
let currentUser = null;
let posCart = [];
let posCategory = 'ทั้งหมด';
let posPaymentMethod = 'cash';
let rewardFilter = 'all';
let reportPeriod = 'today';
let currentPromoSlide = 0;
let promoInterval = null;

// ==========================================
// 1. ระบบจัดการฐานข้อมูล (LocalStorage)
// ==========================================
function loadDB() {
    try {
        const raw = localStorage.getItem(DB_KEY);
        if (!raw) {
            localStorage.setItem(DB_KEY, JSON.stringify(DEFAULT_DB));
            return JSON.parse(JSON.stringify(DEFAULT_DB));
        }
        return JSON.parse(raw);
    } catch (e) {
        return JSON.parse(JSON.stringify(DEFAULT_DB));
    }
}

function saveDB() {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

function formatDateTime(isoString) {
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getMemberTier(totalEarned = 0) {
    if (totalEarned >= 300) return { name: 'PLATINUM', class: 'tier-platinum', next: null, target: 300 };
    if (totalEarned >= 150) return { name: 'GOLD', class: 'tier-gold', next: 'PLATINUM', target: 300 };
    if (totalEarned >= 50) return { name: 'SILVER', class: 'tier-silver', next: 'GOLD', target: 150 };
    return { name: 'MEMBER', class: 'tier-member', next: 'SILVER', target: 50 };
}

// ==========================================
// 2. ระบบเข้าสู่ระบบ / สมัครสมาชิก / ลืมรหัสผ่าน
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    setupImageDropzones();
    const savedUserId = localStorage.getItem('MUG_SESSION_USER_ID');
    if (savedUserId) {
        const found = db.users.find(u => u.id === savedUserId);
        if (found) {
            loginSuccess(found, true);
        }
    }
});

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tabs .tab-btn').forEach((btn, idx) => {
        btn.classList.toggle('active', (tab === 'login' && idx === 0) || (tab === 'register' && idx === 1));
    });
    document.getElementById('login-form').classList.toggle('active', tab === 'login');
    document.getElementById('register-form').classList.toggle('active', tab === 'register');
}

function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const remember = document.getElementById('login-remember').checked;

    const user = db.users.find(u => u.phone === username && u.password === password);
    if (!user) {
        showToast('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง');
        return;
    }

    if (remember) {
        localStorage.setItem('MUG_SESSION_USER_ID', user.id);
    } else {
        localStorage.removeItem('MUG_SESSION_USER_ID');
    }

    loginSuccess(user);
}

function loginSuccess(user, silent = false) {
    currentUser = user;
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');

    document.getElementById('nav-user-name').textContent = user.fullname;
    document.getElementById('nav-user-role').textContent = user.role === 'admin' ? 'ผู้ดูแลร้าน / POS' : 'สมาชิก';

    if (user.role === 'admin') {
        document.getElementById('member-dashboard').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        initAdminDashboard();
    } else {
        document.getElementById('admin-dashboard').classList.add('hidden');
        document.getElementById('member-dashboard').classList.remove('hidden');
        initMemberDashboard();
    }

    if (!silent) {
        showToast(`ยินดีต้อนรับคุณ ${user.fullname}`);
    }
}

function handleRegister(event) {
    event.preventDefault();
    const fullname = document.getElementById('reg-fullname').value.trim();
    const phone = document.getElementById('reg-studentid').value.trim();
    const password = document.getElementById('reg-password').value.trim();

    if (db.users.some(u => u.phone === phone)) {
        showToast('เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว');
        return;
    }
    if (db.users.some(u => u.fullname.toLowerCase() === fullname.toLowerCase())) {
        showToast('ชื่อ-นามสกุลนี้มีในระบบแล้ว กรุณาตรวจสอบ');
        return;
    }

    const newUser = {
        id: 'mem-' + Date.now(),
        phone,
        fullname,
        password,
        role: 'member',
        points: 5, // แต้มโบนัสต้อนรับสมาชิกใหม่
        totalEarned: 5
    };

    db.users.push(newUser);
    saveDB();

    document.getElementById('register-form').reset();
    showToast('สมัครสมาชิกสำเร็จ! รับฟรีทันที 5 แต้มโบนัส');
    loginSuccess(newUser, true);
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('MUG_SESSION_USER_ID');
    if (promoInterval) clearInterval(promoInterval);
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('login-form').reset();
    showToast('ออกจากระบบเรียบร้อยแล้ว');
}

function refreshCurrentView() {
    db = loadDB();
    if (!currentUser) return;
    currentUser = db.users.find(u => u.id === currentUser.id) || currentUser;
    if (currentUser.role === 'admin') {
        initAdminDashboard();
    } else {
        initMemberDashboard();
    }
    showToast('ซิงก์ข้อมูลล่าสุดเรียบร้อย');
}

function openForgotModal() {
    document.getElementById('forgot-form').reset();
    document.getElementById('forgot-modal').classList.remove('hidden');
}

function handleForgotPassword(event) {
    event.preventDefault();
    const phone = document.getElementById('forgot-phone').value.trim();
    const fullname = document.getElementById('forgot-fullname').value.trim();
    const newPass = document.getElementById('forgot-new-password').value.trim();
    const confirmPass = document.getElementById('forgot-confirm-password').value.trim();

    if (newPass !== confirmPass) {
        showToast('รหัสผ่านใหม่ทั้ง 2 ช่องไม่ตรงกัน');
        return;
    }

    const user = db.users.find(u => u.phone === phone && u.fullname.trim() === fullname);
    if (!user) {
        showToast('ไม่พบข้อมูลที่ตรงกับเบอร์โทรศัพท์และชื่อ-นามสกุลนี้');
        return;
    }

    user.password = newPass;
    saveDB();
    closeModal('forgot-modal');
    showToast('เปลี่ยนรหัสผ่านสำเร็จ สามารถเข้าสู่ระบบได้ทันที');
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('hidden');
}

// ==========================================
// 3. ระบบสำหรับสมาชิก (Member View)
// ==========================================
function initMemberDashboard() {
    const user = db.users.find(u => u.id === currentUser.id);
    if (!user) return;
    currentUser = user;

    document.getElementById('mem-card-name').textContent = user.fullname;
    document.getElementById('mem-card-id').textContent = `เบอร์โทรศัพท์: ${user.phone}`;
    document.getElementById('mem-current-points').textContent = user.points;
    document.getElementById('mem-rate-info').textContent = `ทุกยอดซื้อ ${db.settings.bahtPerPoint} บาท รับ 1 แต้ม`;

    // ระดับสมาชิก & แถบความคืบหน้า
    const tier = getMemberTier(user.totalEarned || user.points);
    const tierBadge = document.getElementById('mem-tier-badge');
    tierBadge.className = `tier-badge ${tier.class}`;
    tierBadge.innerHTML = `<i class="fa-solid fa-medal"></i> ระดับ ${tier.name}`;

    if (tier.next) {
        const diff = Math.max(0, tier.target - (user.totalEarned || user.points));
        const pct = Math.min(100, Math.round(((user.totalEarned || user.points) / tier.target) * 100));
        document.getElementById('mem-tier-next-text').textContent = `สะสมเพิ่มอีก ${diff} แต้ม เพื่อเลื่อนเป็นระดับ ${tier.next}`;
        document.getElementById('mem-goal-text').textContent = `ความคืบหน้าสู่ระดับ ${tier.next}`;
        document.getElementById('mem-goal-percent').textContent = `${pct}%`;
        document.getElementById('mem-goal-bar').style.width = `${pct}%`;
    } else {
        document.getElementById('mem-tier-next-text').textContent = 'คุณอยู่ในระดับสูงสุด (PLATINUM) แล้ว!';
        document.getElementById('mem-goal-text').textContent = 'ระดับสมาชิกสูงสุด PLATINUM';
        document.getElementById('mem-goal-percent').textContent = '100%';
        document.getElementById('mem-goal-bar').style.width = '100%';
    }

    // สร้างบาร์โค้ด
    if (window.JsBarcode) {
        try {
            JsBarcode('#member-barcode', user.phone, {
                format: 'CODE128',
                width: 2,
                height: 44,
                displayValue: true,
                fontSize: 13,
                margin: 2
            });
        } catch (e) {}
    }

    renderMemberPromos();
    renderMemberRewards();
    renderMemberEarnHistory();
    renderMemberRedeemHistory();
}

function openMemberBarcodeModal() {
    if (!currentUser) return;
    document.getElementById('barcode-modal-name').textContent = currentUser.fullname;
    document.getElementById('barcode-modal-phone').textContent = `เบอร์สมาชิก: ${currentUser.phone}`;
    if (window.JsBarcode) {
        try {
            JsBarcode('#member-barcode-large', currentUser.phone, {
                format: 'CODE128',
                width: 2.5,
                height: 85,
                displayValue: true,
                fontSize: 16
            });
        } catch (e) {}
    }
    document.getElementById('barcode-modal').classList.remove('hidden');
}

function renderMemberPromos() {
    const wrapper = document.getElementById('member-promo-section');
    const activePromos = db.promotions.filter(p => Number(p.active) === 1);
    if (activePromos.length === 0) {
        wrapper.innerHTML = '';
        return;
    }

    currentPromoSlide = 0;
    wrapper.innerHTML = `
        <div class="promo-track" id="promo-track">
            ${activePromos.map(p => `
                <div class="promo-banner-card">
                    <img src="${p.image || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1000&q=80'}" alt="${p.title}">
                    <div class="promo-overlay">
                        <span class="promo-tag">${p.badge}</span>
                        <h4>${p.title}</h4>
                        <p>${p.desc}</p>
                    </div>
                </div>
            `).join('')}
        </div>
        ${activePromos.length > 1 ? `
            <button type="button" class="promo-nav-btn promo-prev" onclick="movePromoSlide(-1)"><i class="fa-solid fa-chevron-left"></i></button>
            <button type="button" class="promo-nav-btn promo-next" onclick="movePromoSlide(1)"><i class="fa-solid fa-chevron-right"></i></button>
            <div class="promo-dots">
                ${activePromos.map((_, i) => `<button type="button" class="promo-dot ${i === 0 ? 'active' : ''}" onclick="goPromoSlide(${i})"></button>`).join('')}
            </div>
        ` : ''}
    `;

    if (promoInterval) clearInterval(promoInterval);
    if (activePromos.length > 1) {
        promoInterval = setInterval(() => movePromoSlide(1), 5000);
    }
}

function movePromoSlide(step) {
    const activePromos = db.promotions.filter(p => Number(p.active) === 1);
    if (activePromos.length <= 1) return;
    currentPromoSlide = (currentPromoSlide + step + activePromos.length) % activePromos.length;
    updatePromoSliderUI();
}

function goPromoSlide(index) {
    currentPromoSlide = index;
    updatePromoSliderUI();
}

function updatePromoSliderUI() {
    const track = document.getElementById('promo-track');
    if (track) track.style.transform = `translateX(-${currentPromoSlide * 100}%)`;
    document.querySelectorAll('.promo-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentPromoSlide);
    });
}

function switchMemberTab(tabName, btnEl) {
    document.querySelectorAll('#member-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    document.querySelectorAll('#member-dashboard .tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`mem-tab-${tabName}`).classList.add('active');
}

function setRewardFilter(filter) {
    rewardFilter = filter;
    document.getElementById('filter-rew-all').className = filter === 'all' ? 'btn btn-primary' : 'btn btn-outline';
    document.getElementById('filter-rew-can').className = filter === 'can_redeem' ? 'btn btn-primary' : 'btn btn-outline';
    renderMemberRewards();
}

function renderMemberRewards() {
    const grid = document.getElementById('member-rewards-grid');
    let list = [...db.rewards];
    if (rewardFilter === 'can_redeem') {
        list = list.filter(r => currentUser.points >= r.points && r.stock > 0);
    }

    if (list.length === 0) {
        grid.innerHTML = `<div class="card-box" style="grid-column: 1/-1; text-align:center; color: var(--text-muted);">ไม่พบรายการของรางวัลในหมวดหมู่นี้</div>`;
        return;
    }

    grid.innerHTML = list.map(r => {
        const canRedeem = currentUser.points >= r.points && r.stock > 0;
        return `
            <div class="reward-card">
                <img class="reward-img" src="${r.image || 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&q=80'}" alt="${r.name}">
                <div class="reward-body">
                    <div>
                        <span class="reward-badge"><i class="fa-solid fa-star"></i> ใช้ ${r.points} แต้ม</span>
                        <h4 class="reward-title">${r.name}</h4>
                        <p class="reward-desc">${r.desc}</p>
                    </div>
                    <div class="reward-footer">
                        <small class="text-muted">คงเหลือ ${r.stock} สิทธิ์</small>
                        <button type="button" class="btn ${canRedeem ? 'btn-primary' : 'btn-outline'}" 
                            style="padding: 6px 14px; font-size: 13px;"
                            ${canRedeem ? '' : 'disabled'}
                            onclick="redeemReward('${r.id}')">
                            ${r.stock <= 0 ? 'สิทธิ์เต็มแล้ว' : (canRedeem ? 'แลกของรางวัล' : 'แต้มไม่พอ')}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function redeemReward(rewardId) {
    const reward = db.rewards.find(r => r.id === rewardId);
    const user = db.users.find(u => u.id === currentUser.id);
    if (!reward || !user) return;

    if (reward.stock <= 0) {
        showToast('ขออภัย ของรางวัลนี้หมดชั่วคราว');
        return;
    }
    if (user.points < reward.points) {
        showToast('แต้มสะสมของคุณไม่เพียงพอ');
        return;
    }

    if (!confirm(`ยืนยันใช้ ${reward.points} แต้ม เพื่อแลก "${reward.name}" ใช่หรือไม่?`)) return;

    user.points -= reward.points;
    reward.stock -= 1;

    const record = {
        id: 'RED-' + Math.floor(1000 + Math.random() * 9000),
        userId: user.id,
        memberName: user.fullname,
        memberPhone: user.phone,
        rewardId: reward.id,
        rewardName: reward.name,
        rewardImage: reward.image,
        pointsSpent: reward.points,
        status: 'แลกสำเร็จ',
        createdAt: new Date().toISOString()
    };

    db.redemptions.unshift(record);
    saveDB();
    initMemberDashboard();
    openTicketModal(record);
    showToast(`แลก "${reward.name}" สำเร็จ!`);
}

function openTicketModal(record) {
    document.getElementById('ticket-reward-img').src = record.rewardImage || 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&q=80';
    document.getElementById('ticket-reward-name').textContent = record.rewardName;
    document.getElementById('ticket-points-spent').textContent = `ใช้ไป ${record.pointsSpent} แต้ม`;
    document.getElementById('ticket-code').textContent = `รหัสอ้างอิง: #${record.id}`;
    document.getElementById('ticket-member-info').textContent = `ผู้แลก: ${record.memberName} (${record.memberPhone})`;
    document.getElementById('ticket-date').textContent = `วัน-เวลาที่แลก: ${formatDateTime(record.createdAt)}`;
    document.getElementById('ticket-modal').classList.remove('hidden');
}

function renderMemberEarnHistory() {
    const tbody = document.getElementById('mem-earn-tbody');
    const myOrders = db.orders.filter(o => o.userId === currentUser.id);
    if (myOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">ยังไม่มีประวัติการซื้อสินค้า</td></tr>`;
        return;
    }

    tbody.innerHTML = myOrders.map(o => {
        const itemsSummary = o.items.map(i => `${i.name} x${i.qty}`).join(', ');
        return `
            <tr>
                <td><strong>#${o.billNo}</strong></td>
                <td>${formatDateTime(o.createdAt)}</td>
                <td>${itemsSummary} ${o.note ? `<br><small class="text-muted">หมายเหตุ: ${o.note}</small>` : ''}</td>
                <td>${o.totalAmount.toLocaleString()} ฿</td>
                <td><strong style="color: var(--success-green);">+${o.pointsEarned} แต้ม</strong></td>
                <td>
                    <button type="button" class="btn btn-outline-sm" onclick="openReceiptByBill('${o.billNo}')">
                        <i class="fa-solid fa-receipt"></i> ดูใบเสร็จ
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderMemberRedeemHistory() {
    const tbody = document.getElementById('mem-redeem-tbody');
    const myRedemptions = db.redemptions.filter(r => r.userId === currentUser.id);
    if (myRedemptions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">ยังไม่มีประวัติการแลกของรางวัล</td></tr>`;
        return;
    }

    tbody.innerHTML = myRedemptions.map(r => `
        <tr>
            <td><strong>#${r.id}</strong></td>
            <td>${formatDateTime(r.createdAt)}</td>
            <td>${r.rewardName}</td>
            <td>-${r.pointsSpent} แต้ม</td>
            <td><span class="status-pill status-approved">${r.status}</span></td>
            <td>
                <button type="button" class="btn btn-outline-sm" onclick='openTicketModal(${JSON.stringify(r)})'>
                    <i class="fa-solid fa-ticket"></i> เปิดหลักฐาน
                </button>
            </td>
        </tr>
    `).join('');
}

function openProfileModal() {
    document.getElementById('prof-fullname').value = currentUser.fullname;
    document.getElementById('prof-phone').value = currentUser.phone;
    document.getElementById('prof-old-password').value = '';
    document.getElementById('prof-new-password').value = '';
    document.getElementById('prof-confirm-password').value = '';
    document.getElementById('profile-modal').classList.remove('hidden');
}

function saveMemberProfile(event) {
    event.preventDefault();
    const fullname = document.getElementById('prof-fullname').value.trim();
    const phone = document.getElementById('prof-phone').value.trim();
    const oldPass = document.getElementById('prof-old-password').value.trim();
    const newPass = document.getElementById('prof-new-password').value.trim();
    const confirmPass = document.getElementById('prof-confirm-password').value.trim();

    if (db.users.some(u => u.id !== currentUser.id && u.phone === phone)) {
        showToast('เบอร์โทรศัพท์นี้มีผู้ใช้งานแล้ว');
        return;
    }
    if (db.users.some(u => u.id !== currentUser.id && u.fullname.toLowerCase() === fullname.toLowerCase())) {
        showToast('ชื่อ-นามสกุลนี้ซ้ำกับสมาชิกท่านอื่น');
        return;
    }

    const user = db.users.find(u => u.id === currentUser.id);
    if (newPass) {
        if (oldPass !== user.password) {
            showToast('รหัสผ่านเดิมไม่ถูกต้อง');
            return;
        }
        if (newPass !== confirmPass) {
            showToast('รหัสผ่านใหม่ทั้ง 2 ช่องไม่ตรงกัน');
            return;
        }
        user.password = newPass;
    }

    user.fullname = fullname;
    user.phone = phone;
    saveDB();
    closeModal('profile-modal');
    document.getElementById('nav-user-name').textContent = user.fullname;
    initMemberDashboard();
    showToast('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
}

// ==========================================
// 4. ระบบสำหรับผู้ดูแลร้าน & หน้าขาย POS (Admin View)
// ==========================================
function initAdminDashboard() {
    updateAdminKPIs();
    document.getElementById('setting-baht-per-point').value = db.settings.bahtPerPoint;
    document.getElementById('pos-current-rate-label').textContent = db.settings.bahtPerPoint;

    populatePOSMemberDatalist();
    renderPOSCategories();
    renderPOSMenuGrid();
    renderPOSCart();
    renderAdminProducts();
    renderAdminReports();
    loadReceiptSettingsForm();
    renderAdminRedemptions();
    renderAdminPromotions();
    renderAdminMembers();
    renderAdminRewards();
}

function updateAdminKPIs() {
    const members = db.users.filter(u => u.role === 'member');
    const totalPoints = db.orders.reduce((sum, o) => sum + (o.pointsEarned || 0), 0);
    const totalSales = db.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    document.getElementById('stat-total-members').textContent = members.length.toLocaleString();
    document.getElementById('stat-total-points').textContent = totalPoints.toLocaleString();
    document.getElementById('stat-total-redemptions').textContent = db.redemptions.length.toLocaleString();
    document.getElementById('stat-total-sales').textContent = totalSales.toLocaleString();
}

function switchAdminTab(tabName, btnEl) {
    document.querySelectorAll('#admin-dashboard .sub-nav-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    document.querySelectorAll('#admin-dashboard .tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`admin-tab-${tabName}`).classList.add('active');

    if (tabName === 'reports') renderAdminReports();
    if (tabName === 'receipt-settings') loadReceiptSettingsForm();
}

function handleUpdateRate(event) {
    event.preventDefault();
    const val = parseInt(document.getElementById('setting-baht-per-point').value, 10);
    if (!val || val < 1) return;
    db.settings.bahtPerPoint = val;
    saveDB();
    document.getElementById('pos-current-rate-label').textContent = val;
    renderPOSCart();
    showToast(`อัปเดตอัตราคำนวณแต้มเป็นทุก ${val} บาท = 1 แต้ม`);
}

// --- 4.1 หน้าขาย POS คาเฟ่ ---
function renderPOSCategories() {
    const bar = document.getElementById('pos-category-tabs');
    const availableProducts = db.products.filter(p => Number(p.available) === 1);
    const categories = ['ทั้งหมด', ...new Set(availableProducts.map(p => p.category))];

    if (!categories.includes(posCategory)) posCategory = 'ทั้งหมด';

    bar.innerHTML = categories.map(cat => `
        <button type="button" class="pos-cat-btn ${posCategory === cat ? 'active' : ''}" onclick="selectPOSCategory('${cat}')">
            ${cat}
        </button>
    `).join('');
}

function selectPOSCategory(cat) {
    posCategory = cat;
    renderPOSCategories();
    renderPOSMenuGrid();
}

function renderPOSMenuGrid() {
    const grid = document.getElementById('pos-menu-grid');
    let list = db.products.filter(p => Number(p.available) === 1);
    if (posCategory !== 'ทั้งหมด') {
        list = list.filter(p => p.category === posCategory);
    }

    if (list.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:24px; color:var(--text-muted);">ไม่มีรายการเมนูพร้อมขายในหมวดหมู่นี้</div>`;
        return;
    }

    grid.innerHTML = list.map(p => {
        const inCart = posCart.find(c => c.productId === p.id);
        return `
            <button type="button" class="pos-menu-btn ${inCart ? 'in-cart' : ''}" onclick="addToPOSCart('${p.id}')">
                ${inCart ? `<span class="pos-menu-qty-badge">${inCart.qty}</span>` : ''}
                <span class="pos-menu-cat-tag">${p.category}</span>
                <span class="pos-menu-name">${p.name}</span>
                <span class="pos-menu-price">${p.price} ฿</span>
            </button>
        `;
    }).join('');
}

function addToPOSCart(productId) {
    const prod = db.products.find(p => p.id === productId);
    if (!prod) return;

    const existing = posCart.find(c => c.productId === productId);
    if (existing) {
        existing.qty += 1;
    } else {
        posCart.push({
            productId: prod.id,
            name: prod.name,
            price: Number(prod.price),
            qty: 1
        });
    }
    renderPOSMenuGrid();
    renderPOSCart();
}

function updatePOSCartQty(productId, delta) {
    const idx = posCart.findIndex(c => c.productId === productId);
    if (idx === -1) return;
    posCart[idx].qty += delta;
    if (posCart[idx].qty <= 0) {
        posCart.splice(idx, 1);
    }
    renderPOSMenuGrid();
    renderPOSCart();
}

function clearPOSCart() {
    posCart = [];
    document.getElementById('pos-note').value = '';
    document.getElementById('pos-cash-received').value = '';
    clearPOSMember();
    renderPOSMenuGrid();
    renderPOSCart();
}

function populatePOSMemberDatalist() {
    const dl = document.getElementById('pos-members-datalist');
    const members = db.users.filter(u => u.role === 'member');
    dl.innerHTML = members.map(m => `<option value="${m.phone}">${m.fullname} (แต้ม: ${m.points})</option>`).join('');
}

function handlePOSMemberSearch() {
    const query = document.getElementById('pos-member-search').value.trim();
    const hiddenId = document.getElementById('pos-selected-user-id');
    const statusBox = document.getElementById('pos-member-status');

    if (!query) {
        hiddenId.value = '';
        statusBox.innerHTML = '';
        renderPOSCart();
        return;
    }

    const found = db.users.find(u => u.role === 'member' && (u.phone === query || u.fullname === query));
    if (found) {
        hiddenId.value = found.id;
        statusBox.innerHTML = `
            <span style="display:inline-flex; align-items:center; gap:6px; background:#DCFCE7; color:#166534; padding:4px 10px; border-radius:8px; font-size:12.5px; font-weight:600;">
                <i class="fa-solid fa-circle-check"></i> สมาชิก: ${found.fullname} (คงเหลือ ${found.points} แต้ม)
            </span>
        `;
    } else {
        hiddenId.value = '';
        statusBox.innerHTML = `<small style="color: var(--text-muted);">ไม่พบสมาชิกตรงกัน (หากทำรายการต่อจะเป็นลูกค้าทั่วไปไม่ได้รับแต้ม)</small>`;
    }
    renderPOSCart();
}

function handlePOSBarcodeKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        handlePOSMemberSearch();
    }
}

function clearPOSMember() {
    document.getElementById('pos-member-search').value = '';
    document.getElementById('pos-selected-user-id').value = '';
    document.getElementById('pos-member-status').innerHTML = '';
    renderPOSCart();
}

function renderPOSCart() {
    const container = document.getElementById('pos-cart-items');
    if (posCart.length === 0) {
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
                    <strong>${item.name}</strong>
                    <small>${item.price} ฿ / รายการ</small>
                </div>
                <div class="pos-qty-controls">
                    <button type="button" class="btn-qty" onclick="updatePOSCartQty('${item.productId}', -1)">-</button>
                    <span class="pos-qty-val">${item.qty}</span>
                    <button type="button" class="btn-qty" onclick="updatePOSCartQty('${item.productId}', 1)">+</button>
                </div>
                <div class="pos-row-subtotal">${(item.price * item.qty).toLocaleString()} ฿</div>
            </div>
        `).join('');
    }

    const totalQty = posCart.reduce((s, i) => s + i.qty, 0);
    const totalAmount = posCart.reduce((s, i) => s + (i.price * i.qty), 0);
    const hasMember = Boolean(document.getElementById('pos-selected-user-id').value);
    const pointsEarned = hasMember ? Math.floor(totalAmount / db.settings.bahtPerPoint) : 0;

    document.getElementById('pos-total-qty').textContent = `${totalQty} รายการ`;
    document.getElementById('pos-total-amount').textContent = `${totalAmount.toLocaleString()} ฿`;
    document.getElementById('pos-preview-points').textContent = hasMember ? `${pointsEarned} แต้ม` : '0 แต้ม (ลูกค้าทั่วไป)';
    calculatePOSChange();
}

function setPaymentMethod(method) {
    posPaymentMethod = method;
    document.getElementById('pay-method-cash').classList.toggle('active', method === 'cash');
    document.getElementById('pay-method-transfer').classList.toggle('active', method === 'transfer');
    document.getElementById('pos-cash-section').classList.toggle('hidden', method !== 'cash');
    document.getElementById('pos-transfer-section').classList.toggle('hidden', method !== 'transfer');
}

function setExactCash() {
    const totalAmount = posCart.reduce((s, i) => s + (i.price * i.qty), 0);
    document.getElementById('pos-cash-received').value = totalAmount;
    calculatePOSChange();
}

function addCashReceived(amount) {
    const input = document.getElementById('pos-cash-received');
    const current = Number(input.value) || 0;
    input.value = current + amount;
    calculatePOSChange();
}

function calculatePOSChange() {
    const totalAmount = posCart.reduce((s, i) => s + (i.price * i.qty), 0);
    const receivedVal = document.getElementById('pos-cash-received').value;
    const received = receivedVal === '' ? totalAmount : Number(receivedVal);
    const change = Math.max(0, received - totalAmount);
    document.getElementById('pos-change-amount').textContent = `${change.toLocaleString()} ฿`;
}

function handleCheckoutPOS() {
    if (posCart.length === 0) {
        showToast('กรุณาเลือกเมนูสินค้าอย่างน้อย 1 รายการ');
        return;
    }

    const totalAmount = posCart.reduce((s, i) => s + (i.price * i.qty), 0);
    let cashReceived = totalAmount;
    let changeAmount = 0;

    if (posPaymentMethod === 'cash') {
        const rawCash = document.getElementById('pos-cash-received').value;
        cashReceived = rawCash === '' ? totalAmount : Number(rawCash);
        if (cashReceived < totalAmount) {
            showToast('จำนวนเงินสดที่รับมาน้อยกว่ายอดรวมบิล');
            return;
        }
        changeAmount = cashReceived - totalAmount;
    }

    const memberId = document.getElementById('pos-selected-user-id').value;
    const member = memberId ? db.users.find(u => u.id === memberId) : null;
    const pointsEarned = member ? Math.floor(totalAmount / db.settings.bahtPerPoint) : 0;
    const note = document.getElementById('pos-note').value.trim();

    let newBalance = 0;
    if (member) {
        member.points += pointsEarned;
        member.totalEarned = (member.totalEarned || 0) + pointsEarned;
        newBalance = member.points;
    }

    const billNo = String(db.orders.length + 1).padStart(4, '0');
    const order = {
        billNo,
        userId: member ? member.id : null,
        customerName: member ? member.fullname : 'ลูกค้าทั่วไป',
        customerPhone: member ? member.phone : '',
        items: JSON.parse(JSON.stringify(posCart)),
        note,
        totalAmount,
        paymentMethod: posPaymentMethod,
        cashReceived,
        changeAmount,
        pointsEarned,
        pointsBalanceAfter: newBalance,
        createdAt: new Date().toISOString()
    };

    db.orders.unshift(order);
    saveDB();

    clearPOSCart();
    updateAdminKPIs();
    populatePOSMemberDatalist();
    renderAdminMembers();
    renderAdminReports();

    openReceiptModal(order, false);
    showToast(`บันทึกบิล #${billNo} เรียบร้อยแล้ว`);
}

// --- 4.2 ใบเสร็จรับเงินอิเล็กทรอนิกส์ (E-Receipt Modal) ---
function openReceiptByBill(billNo) {
    const order = db.orders.find(o => o.billNo === billNo);
    if (order) openReceiptModal(order, true);
}

function openReceiptModal(order, isMemberView = false) {
    const cfg = db.settings.receipt;

    document.getElementById('rec-ereceipt-banner').style.display = isMemberView ? 'block' : 'none';

    const logoEl = document.getElementById('rec-logo-img');
    if (cfg.logo) {
        logoEl.src = cfg.logo;
        logoEl.style.display = 'block';
    } else {
        logoEl.style.display = 'none';
    }

    document.getElementById('rec-shop-name').textContent = cfg.shopName;
    document.getElementById('rec-shop-subtitle').textContent = cfg.subtitle;

    const addrEl = document.getElementById('rec-shop-address');
    if (cfg.address) {
        addrEl.textContent = cfg.address;
        addrEl.style.display = 'block';
    } else {
        addrEl.style.display = 'none';
    }

    document.getElementById('rec-bill-no').textContent = `เลขที่บิล: #${order.billNo}`;
    document.getElementById('rec-datetime').textContent = `วันที่: ${formatDateTime(order.createdAt)}`;
    document.getElementById('rec-customer-name').textContent = order.customerName;

    const phoneRow = document.getElementById('rec-member-phone-row');
    if (order.customerPhone) {
        document.getElementById('rec-customer-phone').textContent = order.customerPhone;
        phoneRow.style.display = 'block';
    } else {
        phoneRow.style.display = 'none';
    }

    document.getElementById('rec-items-tbody').innerHTML = order.items.map(i => `
        <tr>
            <td>${i.name}</td>
            <td style="text-align: center;">x${i.qty}</td>
            <td style="text-align: right;">${(i.price * i.qty).toLocaleString()} ฿</td>
        </tr>
    `).join('');

    const noteRow = document.getElementById('rec-note-row');
    if (order.note) {
        document.getElementById('rec-note-text').textContent = order.note;
        noteRow.style.display = 'block';
    } else {
        noteRow.style.display = 'none';
    }

    document.getElementById('rec-total-amount').textContent = `${order.totalAmount.toLocaleString()} ฿`;
    document.getElementById('rec-pay-method').textContent = order.paymentMethod === 'cash' ? 'เงินสด' : 'โอน / สแกน QR';

    const cashRow = document.getElementById('rec-cash-row');
    const changeRow = document.getElementById('rec-change-row');
    if (order.paymentMethod === 'cash') {
        cashRow.style.display = 'flex';
        changeRow.style.display = 'flex';
        document.getElementById('rec-cash-received').textContent = `${order.cashReceived.toLocaleString()} ฿`;
        document.getElementById('rec-change-amount').textContent = `${order.changeAmount.toLocaleString()} ฿`;
    } else {
        cashRow.style.display = 'none';
        changeRow.style.display = 'none';
    }

    const pointsBox = document.getElementById('rec-points-box');
    if (cfg.showPoints && order.userId) {
        pointsBox.style.display = 'block';
        document.getElementById('rec-points-earned').textContent = `+${order.pointsEarned} แต้ม`;
        document.getElementById('rec-points-balance').textContent = `${order.pointsBalanceAfter} แต้ม`;
    } else {
        pointsBox.style.display = 'none';
    }

    document.getElementById('rec-footer-1').textContent = cfg.footer1;
    document.getElementById('rec-footer-2').textContent = cfg.footer2;

    document.getElementById('pos-receipt-modal').classList.remove('hidden');
}

function printPOSReceipt() {
    window.print();
}

// --- 4.3 จัดการเมนูสินค้าของร้าน ---
function renderAdminProducts() {
    const tbody = document.getElementById('admin-products-tbody');
    const keyword = (document.getElementById('product-search')?.value || '').trim().toLowerCase();
    const list = db.products.filter(p =>
        p.name.toLowerCase().includes(keyword) || p.category.toLowerCase().includes(keyword)
    );

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">ไม่พบรายการเมนู</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(p => `
        <tr>
            <td><strong>${p.name}</strong></td>
            <td>${p.category}</td>
            <td>${Number(p.price).toLocaleString()} ฿</td>
            <td>
                <span class="status-pill ${Number(p.available) === 1 ? 'status-approved' : 'status-rejected'}">
                    ${Number(p.available) === 1 ? 'พร้อมขาย' : 'สินค้าหมด'}
                </span>
            </td>
            <td>
                <button type="button" class="btn btn-outline-sm" onclick="openProductModal('${p.id}')"><i class="fa-solid fa-pen"></i> แก้ไข</button>
                <button type="button" class="btn btn-danger" onclick="deleteProduct('${p.id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openProductModal(productId = null) {
    document.getElementById('product-form').reset();
    document.getElementById('edit-product-id').value = productId || '';
    if (productId) {
        const p = db.products.find(item => item.id === productId);
        if (!p) return;
        document.getElementById('product-modal-title').textContent = 'แก้ไขเมนูสินค้า';
        document.getElementById('modal-prod-name').value = p.name;
        document.getElementById('modal-prod-category').value = p.category;
        document.getElementById('modal-prod-price').value = p.price;
        document.getElementById('modal-prod-available').value = String(p.available);
    } else {
        document.getElementById('product-modal-title').textContent = 'เพิ่มเมนูใหม่';
        document.getElementById('modal-prod-available').value = '1';
    }
    document.getElementById('product-modal').classList.remove('hidden');
}

function saveProduct(event) {
    event.preventDefault();
    const id = document.getElementById('edit-product-id').value;
    const name = document.getElementById('modal-prod-name').value.trim();
    const category = document.getElementById('modal-prod-category').value.trim();
    const price = Number(document.getElementById('modal-prod-price').value);
    const available = Number(document.getElementById('modal-prod-available').value);

    if (id) {
        const prod = db.products.find(p => p.id === id);
        if (prod) Object.assign(prod, { name, category, price, available });
    } else {
        db.products.push({
            id: 'p-' + Date.now(),
            name,
            category,
            price,
            available
        });
    }

    saveDB();
    closeModal('product-modal');
    renderPOSCategories();
    renderPOSMenuGrid();
    renderAdminProducts();
    showToast('บันทึกข้อมูลเมนูเรียบร้อยแล้ว');
}

function deleteProduct(productId) {
    if (!confirm('ยืนยันลบเมนูนี้ออกจากระบบ?')) return;
    db.products = db.products.filter(p => p.id !== productId);
    saveDB();
    renderPOSCategories();
    renderPOSMenuGrid();
    renderAdminProducts();
    showToast('ลบเมนูเรียบร้อยแล้ว');
}

// --- 4.4 ประวัติบิล & รายงานสรุปยอด ---
function setReportPeriod(period) {
    reportPeriod = period;
    ['today', 'week', 'month', 'all'].forEach(p => {
        const btn = document.getElementById(`rep-filter-${p}`);
        if (btn) btn.className = p === period ? 'btn btn-primary' : 'btn btn-outline';
    });
    renderAdminReports();
}

function getFilteredOrders() {
    const now = new Date();
    return db.orders.filter(o => {
        const d = new Date(o.createdAt);
        if (reportPeriod === 'today') {
            return d.toDateString() === now.toDateString();
        }
        if (reportPeriod === 'week') {
            return (now - d) <= 7 * 24 * 60 * 60 * 1000;
        }
        if (reportPeriod === 'month') {
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        return true;
    });
}

function renderAdminReports() {
    const box = document.getElementById('report-summary-content');
    const orders = getFilteredOrders();
    const totalSales = orders.reduce((s, o) => s + o.totalAmount, 0);
    const totalPoints = orders.reduce((s, o) => s + o.pointsEarned, 0);

    box.innerHTML = `
        <div class="report-kpi-grid" style="margin-bottom: 20px;">
            <div class="report-kpi-box">
                <span>จำนวนบิลขายในช่วงที่เลือก</span>
                <strong>${orders.length} บิล</strong>
                <small>อัปเดตล่าสุดจากหน้า POS</small>
            </div>
            <div class="report-kpi-box">
                <span>ยอดขายรวมสุทธิ</span>
                <strong>${totalSales.toLocaleString()} ฿</strong>
                <small>รวมทุกช่องทางชำระเงิน</small>
            </div>
            <div class="report-kpi-box">
                <span>แต้มสะสมที่แจกให้สมาชิก</span>
                <strong>${totalPoints.toLocaleString()} แต้ม</strong>
                <small>คำนวณจากอัตรา ${db.settings.bahtPerPoint} บาท/แต้ม</small>
            </div>
        </div>

        <h4 style="margin-bottom: 10px;">รายการบิลขายย้อนหลัง</h4>
        <div class="table-responsive" style="margin-bottom: 22px;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>เลขที่บิล</th>
                        <th>วัน-เวลา</th>
                        <th>ลูกค้า</th>
                        <th>รายการสินค้า</th>
                        <th>ชำระโดย</th>
                        <th>ยอดรวม</th>
                        <th>แต้ม</th>
                        <th>ใบเสร็จ</th>
                    </tr>
                </thead>
                <tbody>
                    ${orders.length === 0
                        ? `<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">ยังไม่มีรายการบิลในช่วงเวลานี้</td></tr>`
                        : orders.map(o => `
                            <tr>
                                <td><strong>#${o.billNo}</strong></td>
                                <td>${formatDateTime(o.createdAt)}</td>
                                <td>${o.customerName}</td>
                                <td>${o.items.map(i => `${i.name} x${i.qty}`).join(', ')}</td>
                                <td>${o.paymentMethod === 'cash' ? 'เงินสด' : 'โอน/QR'}</td>
                                <td><strong>${o.totalAmount.toLocaleString()} ฿</strong></td>
                                <td>+${o.pointsEarned}</td>
                                <td>
                                    <button type="button" class="btn btn-outline-sm" onclick="openReceiptByBill('${o.billNo}')">
                                        <i class="fa-solid fa-print"></i> เปิดบิล
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                </tbody>
            </table>
        </div>

        <h4 style="margin-bottom: 10px;">ประวัติการปรับแก้แต้มสมาชิก (Audit Log)</h4>
        <div class="table-responsive">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>วัน-เวลา</th>
                        <th>สมาชิก</th>
                        <th>การเปลี่ยนแปลง</th>
                        <th>เหตุผล</th>
                    </tr>
                </thead>
                <tbody>
                    ${db.auditLogs.length === 0
                        ? `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">ยังไม่มีประวัติการแก้ไขแต้มโดยแอดมิน</td></tr>`
                        : db.auditLogs.map(log => `
                            <tr>
                                <td>${formatDateTime(log.createdAt)}</td>
                                <td>${log.memberName}</td>
                                <td>${log.detail}</td>
                                <td>${log.reason || '-'}</td>
                            </tr>
                        `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function exportReportCSV() {
    const orders = getFilteredOrders();
    if (orders.length === 0) {
        showToast('ไม่มีข้อมูลบิลสำหรับส่งออก CSV');
        return;
    }

    const headers = ['BillNo', 'DateTime', 'Customer', 'Phone', 'Items', 'PaymentMethod', 'TotalAmount', 'PointsEarned'];
    const rows = orders.map(o => [
        o.billNo,
        formatDateTime(o.createdAt),
        `"${o.customerName}"`,
        o.customerPhone || '-',
        `"${o.items.map(i => `${i.name} x${i.qty}`).join(' | ')}"`,
        o.paymentMethod,
        o.totalAmount,
        o.pointsEarned
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mug-rchewa-sales-${reportPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('ดาวน์โหลดไฟล์รายงาน CSV เรียบร้อยแล้ว');
}

// --- 4.5 ตั้งค่าใบเสร็จ (Receipt Customizer) ---
function loadReceiptSettingsForm() {
    const cfg = db.settings.receipt;
    document.getElementById('modal-reclogo-image').value = cfg.logo || '';
    document.getElementById('rec-cfg-shop-name').value = cfg.shopName || '';
    document.getElementById('rec-cfg-subtitle').value = cfg.subtitle || '';
    document.getElementById('rec-cfg-address').value = cfg.address || '';
    document.getElementById('rec-cfg-footer-1').value = cfg.footer1 || '';
    document.getElementById('rec-cfg-footer-2').value = cfg.footer2 || '';
    document.getElementById('rec-cfg-show-points').checked = Boolean(cfg.showPoints);

    const previewBox = document.getElementById('reclogo-preview-box');
    const previewImg = document.getElementById('reclogo-preview-img');
    if (cfg.logo) {
        previewImg.src = cfg.logo;
        previewBox.style.display = 'block';
    } else {
        previewBox.style.display = 'none';
    }

    updateReceiptLivePreview();
}

function updateReceiptLivePreview() {
    const logo = document.getElementById('modal-reclogo-image').value;
    const shopName = document.getElementById('rec-cfg-shop-name').value || 'ชื่อร้าน';
    const subtitle = document.getElementById('rec-cfg-subtitle').value;
    const address = document.getElementById('rec-cfg-address').value;
    const footer1 = document.getElementById('rec-cfg-footer-1').value;
    const footer2 = document.getElementById('rec-cfg-footer-2').value;
    const showPoints = document.getElementById('rec-cfg-show-points').checked;

    const prevLogo = document.getElementById('prev-rec-logo');
    if (logo) {
        prevLogo.src = logo;
        prevLogo.style.display = 'block';
    } else {
        prevLogo.style.display = 'none';
    }

    document.getElementById('prev-rec-shop-name').textContent = shopName;
    document.getElementById('prev-rec-subtitle').textContent = subtitle;

    const prevAddr = document.getElementById('prev-rec-address');
    if (address) {
        prevAddr.textContent = address;
        prevAddr.style.display = 'block';
    } else {
        prevAddr.style.display = 'none';
    }

    document.getElementById('prev-rec-footer-1').textContent = footer1;
    document.getElementById('prev-rec-footer-2').textContent = footer2;
    document.getElementById('prev-rec-points-box').style.display = showPoints ? 'block' : 'none';
}

function clearReceiptLogo() {
    document.getElementById('modal-reclogo-image').value = '';
    document.getElementById('reclogo-preview-box').style.display = 'none';
    updateReceiptLivePreview();
}

function saveReceiptSettings(event) {
    event.preventDefault();
    db.settings.receipt = {
        logo: document.getElementById('modal-reclogo-image').value,
        shopName: document.getElementById('rec-cfg-shop-name').value.trim(),
        subtitle: document.getElementById('rec-cfg-subtitle').value.trim(),
        address: document.getElementById('rec-cfg-address').value.trim(),
        footer1: document.getElementById('rec-cfg-footer-1').value.trim(),
        footer2: document.getElementById('rec-cfg-footer-2').value.trim(),
        showPoints: document.getElementById('rec-cfg-show-points').checked
    };
    saveDB();
    showToast('บันทึกการตั้งค่าใบเสร็จเรียบร้อยแล้ว');
}

// --- 4.6 ประวัติการแลกของรางวัล (Admin) ---
function renderAdminRedemptions() {
    const tbody = document.getElementById('admin-redemptions-tbody');
    if (db.redemptions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">ยังไม่มีประวัติการแลกของรางวัล</td></tr>`;
        return;
    }

    tbody.innerHTML = db.redemptions.map(r => `
        <tr>
            <td><strong>#${r.id}</strong></td>
            <td>${formatDateTime(r.createdAt)}</td>
            <td>${r.memberName} (${r.memberPhone})</td>
            <td>${r.rewardName}</td>
            <td>${r.pointsSpent} แต้ม</td>
            <td><span class="status-pill status-approved">${r.status}</span></td>
        </tr>
    `).join('');
}

// --- 4.7 จัดการแบนเนอร์โปรโมชั่น (Admin) ---
function renderAdminPromotions() {
    const grid = document.getElementById('admin-promos-grid');
    if (db.promotions.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--text-muted);">ยังไม่มีแบนเนอร์โปรโมชั่น</div>`;
        return;
    }

    grid.innerHTML = db.promotions.map(p => `
        <div class="reward-card">
            <img class="reward-img" src="${p.image || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1000&q=80'}" alt="${p.title}">
            <div class="reward-body">
                <div>
                    <span class="reward-badge">${p.badge}</span>
                    <h4 class="reward-title">${p.title}</h4>
                    <p class="reward-desc">${p.desc}</p>
                </div>
                <div class="reward-footer">
                    <span class="status-pill ${Number(p.active) === 1 ? 'status-approved' : 'status-rejected'}">
                        ${Number(p.active) === 1 ? 'กำลังแสดง' : 'ซ่อนอยู่'}
                    </span>
                    <div style="display:flex; gap:6px;">
                        <button type="button" class="btn btn-outline-sm" onclick="openPromoModal('${p.id}')"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="btn btn-danger" onclick="deletePromotion('${p.id}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function openPromoModal(promoId = null) {
    document.getElementById('promo-form').reset();
    document.getElementById('edit-promo-id').value = promoId || '';
    if (promoId) {
        const p = db.promotions.find(item => item.id === promoId);
        if (!p) return;
        document.getElementById('promo-modal-title').textContent = 'แก้ไขแบนเนอร์โปรโมชั่น';
        document.getElementById('modal-promo-badge').value = p.badge;
        document.getElementById('modal-promo-title').value = p.title;
        document.getElementById('modal-promo-desc').value = p.desc;
        document.getElementById('modal-promo-active').value = String(p.active);
        setDropzonePreview('promo', p.image || '');
    } else {
        document.getElementById('promo-modal-title').textContent = 'เพิ่มแบนเนอร์โปรโมชั่น';
        document.getElementById('modal-promo-active').value = '1';
        setDropzonePreview('promo', '');
    }
    document.getElementById('promo-modal').classList.remove('hidden');
}

function savePromotion(event) {
    event.preventDefault();
    const id = document.getElementById('edit-promo-id').value;
    const badge = document.getElementById('modal-promo-badge').value.trim();
    const title = document.getElementById('modal-promo-title').value.trim();
    const desc = document.getElementById('modal-promo-desc').value.trim();
    const image = document.getElementById('modal-promo-image').value || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1000&q=80';
    const active = Number(document.getElementById('modal-promo-active').value);

    if (id) {
        const p = db.promotions.find(item => item.id === id);
        if (p) Object.assign(p, { badge, title, desc, image, active });
    } else {
        db.promotions.push({ id: 'promo-' + Date.now(), badge, title, desc, image, active });
    }

    saveDB();
    closeModal('promo-modal');
    renderAdminPromotions();
    showToast('บันทึกแบนเนอร์โปรโมชั่นเรียบร้อยแล้ว');
}

function deletePromotion(promoId) {
    if (!confirm('ยืนยันลบแบนเนอร์โปรโมชั่นนี้?')) return;
    db.promotions = db.promotions.filter(p => p.id !== promoId);
    saveDB();
    renderAdminPromotions();
    showToast('ลบโปรโมชั่นเรียบร้อยแล้ว');
}

// --- 4.8 จัดการข้อมูลสมาชิก (Admin CRUD) ---
function renderAdminMembers() {
    const tbody = document.getElementById('admin-members-tbody');
    const keyword = (document.getElementById('member-search')?.value || '').trim().toLowerCase();
    const members = db.users.filter(u =>
        u.role === 'member' &&
        (u.fullname.toLowerCase().includes(keyword) || u.phone.includes(keyword))
    );

    if (members.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">ไม่พบข้อมูลสมาชิก</td></tr>`;
        return;
    }

    tbody.innerHTML = members.map(m => {
        const tier = getMemberTier(m.totalEarned || m.points);
        return `
            <tr>
                <td><strong>${m.phone}</strong></td>
                <td>${m.fullname}</td>
                <td><span class="tier-pill ${tier.class}">${tier.name}</span></td>
                <td><strong>${m.points.toLocaleString()} แต้ม</strong></td>
                <td>
                    <button type="button" class="btn btn-outline-sm" onclick="openMemberModal('${m.id}')"><i class="fa-solid fa-pen"></i> แก้ไข</button>
                    <button type="button" class="btn btn-danger" onclick="deleteMember('${m.id}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

function openMemberModal(memberId = null) {
    document.getElementById('member-form').reset();
    document.getElementById('edit-member-id').value = memberId || '';
    const reasonGroup = document.getElementById('member-edit-reason-group');

    if (memberId) {
        const m = db.users.find(u => u.id === memberId);
        if (!m) return;
        document.getElementById('member-modal-title').textContent = 'แก้ไขข้อมูลสมาชิก';
        document.getElementById('modal-mem-studentid').value = m.phone;
        document.getElementById('modal-mem-fullname').value = m.fullname;
        document.getElementById('modal-mem-password').value = m.password;
        document.getElementById('modal-mem-points').value = m.points;
        reasonGroup.style.display = 'block';
    } else {
        document.getElementById('member-modal-title').textContent = 'เพิ่มสมาชิกใหม่';
        document.getElementById('modal-mem-password').value = '1234';
        document.getElementById('modal-mem-points').value = '0';
        reasonGroup.style.display = 'none';
    }
    document.getElementById('member-modal').classList.remove('hidden');
}

function saveMember(event) {
    event.preventDefault();
    const id = document.getElementById('edit-member-id').value;
    const phone = document.getElementById('modal-mem-studentid').value.trim();
    const fullname = document.getElementById('modal-mem-fullname').value.trim();
    const password = document.getElementById('modal-mem-password').value.trim();
    const points = Number(document.getElementById('modal-mem-points').value);
    const reason = document.getElementById('modal-mem-reason').value.trim();

    if (db.users.some(u => u.id !== id && u.phone === phone)) {
        showToast('เบอร์โทรศัพท์นี้มีในระบบแล้ว');
        return;
    }

    if (id) {
        const m = db.users.find(u => u.id === id);
        if (m) {
            if (m.points !== points) {
                db.auditLogs.unshift({
                    createdAt: new Date().toISOString(),
                    memberName: `${m.fullname} (${m.phone})`,
                    detail: `ปรับแต้มจาก ${m.points} เป็น ${points} แต้ม`,
                    reason: reason || 'แก้ไขโดยผู้ดูแลร้าน'
                });
            }
            Object.assign(m, { phone, fullname, password, points });
        }
    } else {
        db.users.push({
            id: 'mem-' + Date.now(),
            phone,
            fullname,
            password,
            role: 'member',
            points,
            totalEarned: points
        });
    }

    saveDB();
    closeModal('member-modal');
    updateAdminKPIs();
    populatePOSMemberDatalist();
    renderAdminMembers();
    showToast('บันทึกข้อมูลสมาชิกเรียบร้อยแล้ว');
}

function deleteMember(memberId) {
    if (!confirm('ยืนยันลบสมาชิกท่านนี้ออกจากระบบ?')) return;
    db.users = db.users.filter(u => u.id !== memberId);
    saveDB();
    updateAdminKPIs();
    populatePOSMemberDatalist();
    renderAdminMembers();
    showToast('ลบข้อมูลสมาชิกเรียบร้อยแล้ว');
}

// --- 4.9 จัดการของรางวัล (Admin CRUD) ---
function renderAdminRewards() {
    const grid = document.getElementById('admin-rewards-grid');
    if (db.rewards.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--text-muted);">ยังไม่มีรายการของรางวัล</div>`;
        return;
    }

    grid.innerHTML = db.rewards.map(r => `
        <div class="reward-card">
            <img class="reward-img" src="${r.image || 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&q=80'}" alt="${r.name}">
            <div class="reward-body">
                <div>
                    <span class="reward-badge"><i class="fa-solid fa-star"></i> ใช้ ${r.points} แต้ม</span>
                    <h4 class="reward-title">${r.name}</h4>
                    <p class="reward-desc">${r.desc}</p>
                </div>
                <div class="reward-footer">
                    <small class="text-muted">คงเหลือ ${r.stock} ชิ้น</small>
                    <div style="display:flex; gap:6px;">
                        <button type="button" class="btn btn-outline-sm" onclick="openRewardModal('${r.id}')"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="btn btn-danger" onclick="deleteReward('${r.id}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function openRewardModal(rewardId = null) {
    document.getElementById('reward-form').reset();
    document.getElementById('edit-reward-id').value = rewardId || '';
    if (rewardId) {
        const r = db.rewards.find(item => item.id === rewardId);
        if (!r) return;
        document.getElementById('reward-modal-title').textContent = 'แก้ไขของรางวัล';
        document.getElementById('modal-rew-name').value = r.name;
        document.getElementById('modal-rew-desc').value = r.desc;
        document.getElementById('modal-rew-points').value = r.points;
        document.getElementById('modal-rew-stock').value = r.stock;
        setDropzonePreview('rew', r.image || '');
    } else {
        document.getElementById('reward-modal-title').textContent = 'เพิ่มของรางวัลใหม่';
        setDropzonePreview('rew', '');
    }
    document.getElementById('reward-modal').classList.remove('hidden');
}

function saveReward(event) {
    event.preventDefault();
    const id = document.getElementById('edit-reward-id').value;
    const name = document.getElementById('modal-rew-name').value.trim();
    const desc = document.getElementById('modal-rew-desc').value.trim();
    const points = Number(document.getElementById('modal-rew-points').value);
    const stock = Number(document.getElementById('modal-rew-stock').value);
    const image = document.getElementById('modal-rew-image').value || 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&q=80';

    if (id) {
        const r = db.rewards.find(item => item.id === id);
        if (r) Object.assign(r, { name, desc, points, stock, image });
    } else {
        db.rewards.push({ id: 'r-' + Date.now(), name, desc, points, stock, image });
    }

    saveDB();
    closeModal('reward-modal');
    renderAdminRewards();
    showToast('บันทึกข้อมูลของรางวัลเรียบร้อยแล้ว');
}

function deleteReward(rewardId) {
    if (!confirm('ยืนยันลบของรางวัลนี้?')) return;
    db.rewards = db.rewards.filter(r => r.id !== rewardId);
    saveDB();
    renderAdminRewards();
    showToast('ลบของรางวัลเรียบร้อยแล้ว');
}

// ==========================================
// 5. ระบบอัปโหลดรูปภาพ (Image Dropzone + Auto Resize)
// ==========================================
function setupImageDropzones() {
    initSingleDropzone('promo-dropzone', 'promo-file-input', (dataUrl) => setDropzonePreview('promo', dataUrl));
    initSingleDropzone('rew-dropzone', 'rew-file-input', (dataUrl) => setDropzonePreview('rew', dataUrl));
    initSingleDropzone('reclogo-dropzone', 'reclogo-file-input', (dataUrl) => {
        document.getElementById('modal-reclogo-image').value = dataUrl;
        document.getElementById('reclogo-preview-img').src = dataUrl;
        document.getElementById('reclogo-preview-box').style.display = 'block';
        updateReceiptLivePreview();
    });
}

function initSingleDropzone(zoneId, inputId, callback) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) compressImageFile(e.dataTransfer.files[0], callback);
    });
    input.addEventListener('change', () => {
        if (input.files[0]) compressImageFile(input.files[0], callback);
    });
}

function compressImageFile(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxW = 700;
            const scale = img.width > maxW ? maxW / img.width : 1;
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            callback(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function setDropzonePreview(prefix, dataUrl) {
    const hiddenInput = document.getElementById(`modal-${prefix}-image`);
    const previewBox = document.getElementById(`${prefix}-preview-box`);
    const previewImg = document.getElementById(`${prefix}-preview-img`);
    if (!hiddenInput || !previewBox || !previewImg) return;

    hiddenInput.value = dataUrl || '';
    if (dataUrl) {
        previewImg.src = dataUrl;
        previewBox.style.display = 'block';
    } else {
        previewImg.src = '';
        previewBox.style.display = 'none';
    }
}
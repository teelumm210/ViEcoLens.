// auth.js — Tài khoản người dùng: tạo tài khoản, đăng nhập, lưu điểm + lịch sử theo từng tài khoản.
//
// LƯU Ý: app hiện là web tĩnh (không có máy chủ) nên dữ liệu được lưu trong localStorage của
// TRÌNH DUYỆT: chỉ dùng được trên thiết bị/trình duyệt đã tạo tài khoản, xóa dữ liệu trình duyệt
// là mất, và không thể khôi phục mật khẩu. Muốn dùng chung nhiều thiết bị cần thêm backend
// (hàm persist/login/register bên dưới là nơi thay bằng lời gọi API).
//
// Mật khẩu KHÔNG lưu nguyên văn: băm PBKDF2-SHA-256 với muối ngẫu nhiên cho từng tài khoản.
(() => {
    'use strict';

    const KEY_ACCOUNTS = 'eco_accounts';
    const KEY_SESSION = 'eco_session';
    const FLAG_OPEN_AUTH = 'eco_open_auth';   // sessionStorage: mở sẵn form đăng nhập sau khi tải lại
    const PBKDF2_ITER = 150000;
    const MAX_HISTORY = 200;

    let currentUsername = null;
    let guestMode = false;
    let mode = 'login';
    let busy = false;

    const $ = (id) => document.getElementById(id);
    // khóa có tiền tố '@' để tên như "__proto__" không ghi đè nguyên mẫu của object
    const keyOf = (username) => '@' + username;

    // ---------- Lưu trữ ----------
    function readAccounts() {
        try {
            const o = JSON.parse(localStorage.getItem(KEY_ACCOUNTS));
            return (o && typeof o === 'object') ? o : {};
        } catch (e) {
            return {};
        }
    }

    function writeAccounts(accounts) {
        try {
            localStorage.setItem(KEY_ACCOUNTS, JSON.stringify(accounts));
            return true;
        } catch (e) {
            console.warn('[Auth] Không ghi được localStorage:', e);
            return false;
        }
    }

    function getSession() {
        try { return localStorage.getItem(KEY_SESSION); } catch (e) { return null; }
    }

    function setSession(username) {
        try { localStorage.setItem(KEY_SESSION, username); } catch (e) { /* bỏ qua */ }
    }

    function clearSession() {
        try { localStorage.removeItem(KEY_SESSION); } catch (e) { /* bỏ qua */ }
    }

    // ---------- Mã hóa mật khẩu ----------
    const hasCrypto = !!(window.crypto && window.crypto.subtle);
    const encoder = new TextEncoder();

    function bytesToB64(buf) {
        let s = '';
        new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
        return btoa(s);
    }

    function b64ToBytes(b64) {
        return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    }

    async function derive(password, saltBytes, iterations) {
        const keyMaterial = await crypto.subtle.importKey(
            'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
        );
        const bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
            keyMaterial,
            256
        );
        return bytesToB64(bits);
    }

    function safeEqual(a, b) {
        if (a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
    }

    // ---------- Kiểm tra dữ liệu nhập ----------
    const normUsername = (u) => String(u || '').trim().toLowerCase();
    const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

    const ERR = {
        username: 'Tên đăng nhập gồm 3–20 ký tự: chữ không dấu, số, dấu _ hoặc dấu chấm.',
        passwordShort: 'Mật khẩu cần ít nhất 6 ký tự.',
        passwordMismatch: 'Mật khẩu nhập lại không khớp.',
        exists: 'Tên đăng nhập đã tồn tại, hãy chọn tên khác.',
        wrong: 'Sai tên đăng nhập hoặc mật khẩu.',
        noCrypto: 'Trình duyệt không hỗ trợ mã hóa mật khẩu ở chế độ này. Hãy mở trang bằng HTTPS (hoặc localhost).',
        storage: 'Không lưu được tài khoản (bộ nhớ trình duyệt đầy hoặc đang ở chế độ ẩn danh).'
    };

    // ---------- Nghiệp vụ tài khoản ----------
    async function register({ username, displayName, password, password2 }) {
        username = normUsername(username);
        if (!USERNAME_RE.test(username)) return { ok: false, error: ERR.username };
        if (String(password || '').length < 6) return { ok: false, error: ERR.passwordShort };
        if (password !== password2) return { ok: false, error: ERR.passwordMismatch };
        if (!hasCrypto) return { ok: false, error: ERR.noCrypto };

        const accounts = readAccounts();
        if (accounts[keyOf(username)]) return { ok: false, error: ERR.exists };

        const salt = crypto.getRandomValues(new Uint8Array(16));
        const hash = await derive(password, salt, PBKDF2_ITER);

        const name = String(displayName || '').trim().replace(/\s+/g, ' ').slice(0, 24) || username;
        const acc = {
            username,
            displayName: name,
            salt: bytesToB64(salt),
            hash,
            iter: PBKDF2_ITER,
            createdAt: Date.now(),
            points: 0,          // tài khoản mới luôn bắt đầu với 0 điểm
            history: []
        };
        accounts[keyOf(username)] = acc;
        if (!writeAccounts(accounts)) return { ok: false, error: ERR.storage };

        startSession(acc);
        return { ok: true };
    }

    async function login({ username, password }) {
        username = normUsername(username);
        if (!hasCrypto) return { ok: false, error: ERR.noCrypto };

        const acc = readAccounts()[keyOf(username)];
        if (!acc) {
            // vẫn băm một lần để thời gian phản hồi không lộ tên đăng nhập có tồn tại hay không
            await derive(String(password || ''), new Uint8Array(16), PBKDF2_ITER);
            return { ok: false, error: ERR.wrong };
        }

        const hash = await derive(String(password || ''), b64ToBytes(acc.salt), acc.iter || PBKDF2_ITER);
        if (!safeEqual(hash, acc.hash)) return { ok: false, error: ERR.wrong };

        startSession(acc);
        return { ok: true };
    }

    function startSession(acc) {
        currentUsername = acc.username;
        guestMode = false;
        setSession(acc.username);
        window.ecoState?.loadAccount(acc);
        refreshAccountUI();
    }

    function logout() {
        if (window.ecoState) persist(window.ecoState);
        clearSession();
        try { sessionStorage.setItem(FLAG_OPEN_AUTH, '1'); } catch (e) { /* bỏ qua */ }
        location.reload();      // về lại màn hình chào với trạng thái sạch
    }

    // Ghi điểm + lịch sử của tài khoản đang đăng nhập (StateManager gọi sau mỗi lần cộng điểm).
    function persist(state) {
        if (!currentUsername || !state) return;
        const accounts = readAccounts();
        const acc = accounts[keyOf(currentUsername)];
        if (!acc) return;

        acc.points = Number(state.points) || 0;
        acc.history = (state.history || []).slice(0, MAX_HISTORY).map((h) => ({
            name: h.name,
            tag: h.tag,
            icon: h.icon,
            amount: h.amount,
            time: (h.time instanceof Date ? h.time : new Date(h.time)).toISOString()
        }));
        acc.updatedAt = Date.now();
        writeAccounts(accounts);
    }

    const isSignedIn = () => !!currentUsername || guestMode;

    // ---------- Giao diện ----------
    function setError(msg) {
        const el = $('auth-error');
        if (el) el.textContent = msg || '';
    }

    function setMode(m) {
        mode = m;
        document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
        document.querySelectorAll('.auth-register-only').forEach((el) => el.classList.toggle('hidden', m !== 'register'));
        const submit = $('auth-submit');
        if (submit) submit.textContent = m === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
        const pw = $('auth-password');
        if (pw) pw.autocomplete = m === 'login' ? 'current-password' : 'new-password';
        setError('');
    }

    function showPanel(m = 'login') {
        $('welcome-screen')?.classList.add('auth-open');
        $('auth-panel')?.classList.remove('hidden');
        setMode(m);
        setTimeout(() => $('auth-username')?.focus(), 50);
    }

    function hidePanel() {
        $('welcome-screen')?.classList.remove('auth-open');
        $('auth-panel')?.classList.add('hidden');
    }

    function refreshAccountUI() {
        const state = window.ecoState;
        const name = currentUsername ? (state?.displayName() || currentUsername) : 'Guest';

        // Màn hình chào: "Xin chào, <tên>"
        const welcome = $('welcome-account');
        if (welcome) {
            welcome.classList.toggle('hidden', !currentUsername);
            const text = $('welcome-account-text');
            if (text) text.textContent = currentUsername ? `Xin chào, ${name}` : '';
        }

        // Màn Cài đặt: thẻ tài khoản
        const nameEl = $('account-display-name');
        if (nameEl) nameEl.textContent = name;

        const metaEl = $('account-meta');
        if (metaEl) {
            if (currentUsername) {
                const acc = readAccounts()[keyOf(currentUsername)];
                const since = acc?.createdAt ? new Date(acc.createdAt).toLocaleDateString('vi-VN') : '';
                metaEl.textContent = `@${currentUsername}` + (since ? ` · Tạo ngày ${since}` : '');
            } else {
                metaEl.textContent = 'Chưa đăng nhập — dữ liệu không được lưu';
            }
        }

        const btnText = $('logout-btn-text');
        if (btnText) btnText.textContent = currentUsername ? 'Đăng xuất' : 'Đăng nhập';
    }

    function bindUI() {
        document.querySelectorAll('.auth-tab').forEach((tab) => {
            tab.addEventListener('click', () => setMode(tab.dataset.mode));
        });

        $('auth-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (busy) return;
            busy = true;
            const submit = $('auth-submit');
            if (submit) submit.disabled = true;
            setError('');

            try {
                const data = {
                    username: $('auth-username')?.value,
                    displayName: $('auth-display')?.value,
                    password: $('auth-password')?.value,
                    password2: $('auth-password2')?.value
                };
                const res = mode === 'login' ? await login(data) : await register(data);
                if (!res.ok) { setError(res.error); return; }

                $('auth-form').reset();
                hidePanel();
                window.enterApp?.();
            } catch (err) {
                console.error('[Auth]', err);
                setError('Có lỗi xảy ra, vui lòng thử lại.');
            } finally {
                busy = false;
                if (submit) submit.disabled = false;
            }
        });

        $('auth-guest-btn')?.addEventListener('click', () => {
            guestMode = true;
            hidePanel();
            refreshAccountUI();
            window.enterApp?.();
        });

        $('auth-back-btn')?.addEventListener('click', hidePanel);
        $('welcome-switch-account')?.addEventListener('click', logout);

        $('logout-btn')?.addEventListener('click', () => {
            if (currentUsername) {
                if (confirm('Đăng xuất khỏi tài khoản này?')) logout();
            } else {
                // đang là khách: quay về màn hình chào để đăng nhập / tạo tài khoản
                try { sessionStorage.setItem(FLAG_OPEN_AUTH, '1'); } catch (e) { /* bỏ qua */ }
                location.reload();
            }
        });

        window.addEventListener('pagehide', () => { if (window.ecoState) persist(window.ecoState); });
    }

    function init() {
        bindUI();

        // Khôi phục phiên đăng nhập gần nhất
        const sess = getSession();
        if (sess) {
            const acc = readAccounts()[keyOf(sess)];
            if (acc) {
                currentUsername = acc.username;
                window.ecoState?.loadAccount(acc);
            } else {
                clearSession();
            }
        }
        refreshAccountUI();

        let openAuth = false;
        try {
            openAuth = sessionStorage.getItem(FLAG_OPEN_AUTH) === '1';
            sessionStorage.removeItem(FLAG_OPEN_AUTH);
        } catch (e) { /* bỏ qua */ }
        if (openAuth && !currentUsername) showPanel('login');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.ecoAuth = {
        register,
        login,
        logout,
        persist,
        isSignedIn,
        showPanel,
        get currentUser() { return currentUsername; }
    };
})();

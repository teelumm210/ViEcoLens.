// auth.js — Tài khoản người dùng: đăng ký, đăng nhập, điểm + lịch sử.
//
// CHẾ ĐỘ MÁY CHỦ (mặc định khi trang chạy trên Netlify có hàm /api): tài khoản, mật khẩu (băm scrypt phía máy chủ),
// điểm và lịch sử nằm trên máy chủ, dùng được ở mọi thiết bị; phiên đăng nhập là cookie HttpOnly. Điểm do MÁY CHỦ cộng
// (trình duyệt chỉ "xin cộng"), quên mật khẩu thì đặt lại bằng mã khôi phục.
//
// CHẾ ĐỘ CŨ (dự phòng khi không gọi được máy chủ: offline hoặc chưa deploy hàm): tài khoản lưu trong localStorage
// của trình duyệt, mật khẩu băm PBKDF2-SHA-256. Tài khoản cũ kiểu này sẽ TỰ ĐỘNG chuyển lên máy chủ ở lần đăng nhập
// kế tiếp khi có mạng (điểm và lịch sử được mang theo, có giới hạn).
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
    let serverMode = false;          // đang đăng nhập bằng tài khoản trên máy chủ
    let serverProfile = null;
    let readyResolve;
    const ready = new Promise((r) => { readyResolve = r; });   // khôi phục phiên (máy chủ) xong

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
    async function registerLocal({ username, displayName, password, password2 }) {
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

    async function loginLocal({ username, password }) {
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
        serverMode = false;
        setSession(acc.username);
        window.ecoState?.loadAccount(acc);
        refreshAccountUI();
    }

    async function logout() {
        if (serverMode) {
            await api('POST', '/api/auth/logout', {}, 4000);
        } else if (window.ecoState) {
            persist(window.ecoState);
        }
        clearSession();
        try { sessionStorage.setItem(FLAG_OPEN_AUTH, '1'); } catch (e) { /* bỏ qua */ }
        location.reload();      // về lại màn hình chào với trạng thái sạch
    }

    // Ghi điểm + lịch sử của tài khoản đang đăng nhập (chế độ cũ). Ở chế độ máy chủ, điểm nằm trên máy chủ nên không cần.
    function persist(state) {
        if (serverMode || !currentUsername || !state) return;
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

    // ---------- Máy chủ (/api/...) ----------
    // Trả về { unavailable: true } khi không gọi được (offline, hàm chưa deploy, lỗi 5xx) -> dùng chế độ cũ.
    async function api(method, path, body, timeoutMs = 10000) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(path, {
                method,
                headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                credentials: 'same-origin',
                cache: 'no-store',
                signal: ctrl.signal
            });
            if (!(res.headers.get('content-type') || '').includes('json') || res.status === 404 || res.status >= 500) {
                return { unavailable: true, status: res.status };
            }
            const data = await res.json();
            return { ok: res.ok, status: res.status, data };
        } catch (e) {
            return { unavailable: true, status: 0 };
        } finally {
            clearTimeout(timer);
        }
    }

    const serverError = (r, fallback) => (r && r.data && r.data.error && r.data.error.message) || fallback;

    function toast(msg) {
        const d = document.createElement('div');
        d.textContent = msg;
        d.setAttribute('role', 'status');
        d.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);max-width:88vw;padding:10px 16px;border-radius:12px;background:#166534;color:#fff;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.25);text-align:center';
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 3800);
    }

    function startServerSession(profile) {
        currentUsername = profile.username;
        guestMode = false;
        serverMode = true;
        serverProfile = profile;
        clearSession();                       // bỏ phiên kiểu cũ trong trình duyệt
        window.ecoState?.loadAccount(profile);
        refreshAccountUI();
    }

    // Tài khoản cũ tạo trong trình duyệt (trước khi có máy chủ): kiểm tra mật khẩu cục bộ rồi chuyển lên máy chủ.
    async function migrateLegacy(username, password) {
        const accounts = readAccounts();
        const acc = accounts[keyOf(username)];
        if (!acc || !hasCrypto) return null;
        const hash = await derive(String(password || ''), b64ToBytes(acc.salt), acc.iter || PBKDF2_ITER);
        if (!safeEqual(hash, acc.hash)) return null;

        const r = await api('POST', '/api/auth/register', {
            username, displayName: acc.displayName, password,
            migrate: { points: acc.points, history: acc.history }
        });
        if (r.unavailable) return loginLocal({ username, password });
        if (!r.ok) return null;               // vd. tên này đã có trên máy chủ với mật khẩu khác -> coi như sai thông tin

        delete accounts[keyOf(username)];     // dữ liệu giờ nằm trên máy chủ; xóa bản cục bộ (gồm cả mật khẩu băm)
        writeAccounts(accounts);
        startServerSession(r.data.profile);
        return { ok: true, recoveryCode: r.data.recoveryCode };
    }

    async function register(form) {
        const username = normUsername(form.username);
        if (!USERNAME_RE.test(username)) return { ok: false, error: ERR.username };
        if (String(form.password || '').length < 6) return { ok: false, error: ERR.passwordShort };
        if (form.password !== form.password2) return { ok: false, error: ERR.passwordMismatch };

        const r = await api('POST', '/api/auth/register', { username, displayName: form.displayName, password: form.password });
        if (r.unavailable) return registerLocal(form);      // chưa có máy chủ / mất mạng: lưu tạm trên thiết bị
        if (!r.ok) return { ok: false, error: serverError(r, ERR.exists) };
        startServerSession(r.data.profile);
        return { ok: true, recoveryCode: r.data.recoveryCode };
    }

    async function login(form) {
        const username = normUsername(form.username);
        const password = String(form.password || '');
        const r = await api('POST', '/api/auth/login', { username, password });
        if (r.unavailable) return loginLocal({ username, password });
        if (r.ok) { startServerSession(r.data.profile); return { ok: true }; }
        if (r.status === 401) {
            const mig = await migrateLegacy(username, password);
            if (mig) return mig;
        }
        return { ok: false, error: serverError(r, ERR.wrong) };
    }

    async function resetPassword(form) {
        const username = normUsername(form.username);
        if (!USERNAME_RE.test(username)) return { ok: false, error: ERR.username };
        if (!String(form.recoveryCode || '').trim()) return { ok: false, error: 'Hãy nhập mã khôi phục.' };
        if (String(form.password || '').length < 6) return { ok: false, error: ERR.passwordShort };
        if (form.password !== form.password2) return { ok: false, error: ERR.passwordMismatch };

        const r = await api('POST', '/api/auth/reset', { username, recoveryCode: form.recoveryCode, newPassword: form.password });
        if (r.unavailable) return { ok: false, error: 'Cần có mạng để đặt lại mật khẩu. Hãy thử lại sau.' };
        if (!r.ok) return { ok: false, error: serverError(r, ERR.wrong) };
        startServerSession(r.data.profile);
        return { ok: true, recoveryCode: r.data.recoveryCode };
    }

    // Lấy lại hồ sơ từ máy chủ (khôi phục phiên, hoặc đồng bộ lại sau khi máy chủ từ chối một lần cộng điểm).
    async function refreshFromServer() {
        const r = await api('GET', '/api/auth/me', undefined, 5000);
        if (r.ok) { serverProfile = r.data.profile; window.ecoState?.loadAccount(r.data.profile); refreshAccountUI(); }
        return r;
    }

    // Cộng điểm: các lần "xin cộng" được xếp hàng, cách nhau >= ~2 giây (máy chủ giới hạn tần suất).
    let awardChain = Promise.resolve();
    let lastAwardSent = 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function award(amount, item) {
        if (!serverMode) return Promise.resolve();
        awardChain = awardChain.then(async () => {
            const wait = 2100 - (Date.now() - lastAwardSent);
            if (wait > 0) await sleep(wait);
            lastAwardSent = Date.now();
            const r = await api('POST', '/api/me/award', { amount, name: item?.name, tag: item?.tag, icon: item?.icon });

            if (r.unavailable) return;                       // mất mạng: tải lại trang sẽ lấy điểm theo máy chủ
            if (r.ok) { window.ecoState?.setServerPoints(r.data.points); return; }
            if (r.status === 401) {
                toast('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
                setTimeout(() => { try { sessionStorage.setItem(FLAG_OPEN_AUTH, '1'); } catch (e) { /* bỏ qua */ } location.reload(); }, 1800);
                return;
            }
            // Máy chủ từ chối (đạt giới hạn ngày, thao tác quá nhanh...): đồng bộ lại để điểm/lịch sử khớp máy chủ
            const code = r.data?.error?.status;
            toast(code === 'DAILY_CAP' ? 'Bạn đã đạt giới hạn điểm của hôm nay.' : serverError(r, 'Không cộng được điểm lần này.'));
            await refreshFromServer();
        }).catch((e) => console.warn('[Auth] award lỗi:', e));
        return awardChain;
    }

    // Dùng khi không gọi được máy chủ: các tài khoản có trên thiết bị/trình duyệt này.
    function localBoard() {
        const accounts = readAccounts();
        return Object.keys(accounts).map((k) => {
            const a = accounts[k];
            return { id: 'local:' + a.username, name: a.displayName || a.username, points: Number(a.points) || 0, isCurrent: !serverMode && a.username === currentUsername };
        });
    }

    // ---------- Giao diện ----------
    function setError(msg) {
        const el = $('auth-error');
        if (el) el.textContent = msg || '';
    }

    function setMode(m) {
        mode = m;
        document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
        document.querySelectorAll('.auth-register-only').forEach((el) => el.classList.toggle('hidden', m !== 'register'));
        document.querySelectorAll('.auth-reset-only').forEach((el) => el.classList.toggle('hidden', m !== 'reset'));
        document.querySelectorAll('.auth-login-only').forEach((el) => el.classList.toggle('hidden', m !== 'login'));
        document.querySelectorAll('.auth-pw2-wrap').forEach((el) => el.classList.toggle('hidden', m === 'login'));
        const submit = $('auth-submit');
        if (submit) submit.textContent = m === 'login' ? 'Đăng nhập' : m === 'register' ? 'Tạo tài khoản' : 'Đặt lại mật khẩu';
        const pwLabel = $('auth-password-label');
        if (pwLabel) pwLabel.textContent = m === 'reset' ? 'Mật khẩu mới' : 'Mật khẩu';
        const pw = $('auth-password');
        if (pw) pw.autocomplete = m === 'login' ? 'current-password' : 'new-password';
        setError('');
    }

    // Hiện mã khôi phục (chỉ hiện một lần) rồi mới vào ứng dụng
    function showRecovery(code) {
        $('auth-recovery-code').textContent = code;
        $('auth-form')?.classList.add('hidden');
        document.querySelector('.auth-tabs')?.classList.add('hidden');
        document.querySelector('.auth-secondary')?.classList.add('hidden');
        document.querySelector('.auth-forgot')?.classList.add('hidden');
        $('auth-recovery-box')?.classList.remove('hidden');
        $('welcome-screen')?.classList.add('auth-open');
        $('auth-panel')?.classList.remove('hidden');
    }

    function hideRecovery() {
        $('auth-recovery-box')?.classList.add('hidden');
        $('auth-recovery-code').textContent = '';
        $('auth-form')?.classList.remove('hidden');
        document.querySelector('.auth-tabs')?.classList.remove('hidden');
        document.querySelector('.auth-secondary')?.classList.remove('hidden');
        setMode('login');
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
                const acc = serverMode ? serverProfile : readAccounts()[keyOf(currentUsername)];
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
                    password2: $('auth-password2')?.value,
                    recoveryCode: $('auth-recovery')?.value
                };
                const res = mode === 'login' ? await login(data)
                    : mode === 'register' ? await register(data)
                        : await resetPassword(data);
                if (!res.ok) { setError(res.error); return; }

                $('auth-form').reset();
                if (res.recoveryCode) { showRecovery(res.recoveryCode); return; }   // tài khoản mới / đặt lại mật khẩu: cho người dùng lưu mã
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
        $('auth-forgot-btn')?.addEventListener('click', () => { setMode('reset'); $('auth-recovery')?.focus(); });
        $('auth-recovery-copy')?.addEventListener('click', async () => {
            const code = $('auth-recovery-code')?.textContent || '';
            try { await navigator.clipboard.writeText(code); toast('Đã sao chép mã khôi phục.'); }
            catch (e) { toast('Không sao chép được, hãy ghi lại mã này.'); }
        });
        $('auth-recovery-done')?.addEventListener('click', () => {
            hideRecovery();
            hidePanel();
            window.enterApp?.();
        });
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

        // Phiên đăng nhập trên máy chủ (cookie) -> lấy hồ sơ về; máy chủ không có/không gọi được thì giữ chế độ cũ
        api('GET', '/api/auth/me', undefined, 4000).then((r) => {
            if (r.ok) {
                startServerSession(r.data.profile);
                if (!$('auth-recovery-box') || $('auth-recovery-box').classList.contains('hidden')) hidePanel();
            }
        }).finally(readyResolve);
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
        localBoard,
        award,
        resetPassword,
        isServerMode: () => serverMode,
        ready,
        get currentUser() { return currentUsername; }
    };
})();

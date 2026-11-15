// Lõi tài khoản + bảng xếp hạng chạy phía MÁY CHỦ (thuần túy: nhận "store" từ ngoài nên kiểm thử được không cần Netlify).
//
// Dữ liệu trong Netlify Blobs:
//   acct/<username>   hồ sơ: mật khẩu băm scrypt, mã khôi phục (băm), điểm, lịch sử, ...
//   sess/<sha256(token)>  phiên đăng nhập (token ngẫu nhiên nằm trong cookie HttpOnly, máy chủ chỉ lưu BĂM)
//   lb/<id>           bản công khai cho bảng xếp hạng: { id, name, points } (KHÔNG lộ tên đăng nhập)
//   fail/<username>   đếm lần đăng nhập sai để tạm khóa (chống dò mật khẩu)
//
// Điểm do MÁY CHỦ giữ và cộng: trình duyệt chỉ "xin cộng" từng lần quét, máy chủ giới hạn mức mỗi lần,
// tần suất và tổng mỗi ngày. Máy chủ không thể tự xác minh ảnh quét đúng hay sai, nên đây là giảm gian lận chứ không tuyệt đối.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_HISTORY = 200;
const LOCK_AFTER_FAILS = 8;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

// Cộng điểm
export const MAX_AWARD = 100;              // tối đa mỗi lần quét/hoạt động (app hiện cộng tối đa 100)
export const MIN_AWARD_GAP_MS = 2000;      // tối thiểu giữa hai lần cộng
export const DAILY_CAP = 2000;            // tối đa mỗi ngày (giờ Việt Nam)
export const MIGRATE_MAX_POINTS = 20000;   // điểm mang từ bản cũ (lưu trong trình duyệt) sang, tối đa
const VN_OFFSET_MS = 7 * 3600 * 1000;

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export const idOf = (username) => sha256('user:' + username).slice(0, 16);

const bad = (status, code, message, extra = {}) => ({ status, body: { error: { status: code, message }, ...extra } });

const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
const cleanText = (n, max) => String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- Mật khẩu / mã khôi phục ----------
async function hashPassword(password, saltHex) {
    const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
    const key = await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return { salt: salt.toString('hex'), hash: key.toString('hex') };
}

function eqHex(a, b) {
    const x = Buffer.from(String(a || ''), 'hex');
    const y = Buffer.from(String(b || ''), 'hex');
    return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

async function verifyPassword(password, rec) {
    if (!rec || !rec.salt || !rec.hash) return false;
    const { hash } = await hashPassword(password, rec.salt);
    return eqHex(hash, rec.hash);
}

// Mã khôi phục dạng XXXX-XXXX-XXXX-XXXX (bảng chữ cái bỏ ký tự dễ nhầm), ~80 bit ngẫu nhiên.
const RC_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRecoveryCode() {
    const bytes = randomBytes(16);
    let s = '';
    for (let i = 0; i < 16; i++) s += RC_ALPHABET[bytes[i] % RC_ALPHABET.length];
    return s.match(/.{4}/g).join('-');
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const recoveryHash = (code) => sha256('recovery:' + normCode(code));

// ---------- Hồ sơ trả về trình duyệt ----------
export function publicProfile(acc) {
    return {
        username: acc.username,
        displayName: acc.displayName,
        points: acc.points,
        history: acc.history || [],
        createdAt: acc.createdAt
    };
}

const lbEntry = (acc) => ({ id: idOf(acc.username), name: acc.displayName, points: acc.points, createdAt: acc.createdAt });

// ---------- Truy cập store ----------
async function getAcct(store, username) {
    return store.getWithMetadata('acct/' + username, { type: 'json' });   // { data, etag } | null
}

async function putLb(store, acc) {
    await store.setJSON('lb/' + idOf(acc.username), lbEntry(acc));
}

// ---------- Phiên đăng nhập ----------
export async function createSession(store, username, sv, now = Date.now()) {
    const token = randomBytes(32).toString('hex');
    await store.setJSON('sess/' + sha256(token), { username, sv, exp: now + SESSION_TTL_MS });
    return token;
}

export async function resolveSession(store, token, now = Date.now()) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
    const s = await store.get('sess/' + sha256(token), { type: 'json' });
    if (!s || s.exp < now) return null;
    const entry = await getAcct(store, s.username);
    if (!entry || (entry.data.sv || 0) !== (s.sv || 0)) return null;      // đã đổi mật khẩu -> phiên cũ vô hiệu
    return entry.data;
}

export async function destroySession(store, token) {
    if (/^[a-f0-9]{64}$/.test(String(token || ''))) await store.delete('sess/' + sha256(token));
}

// ---------- Chống dò mật khẩu ----------
async function isLocked(store, username, now) {
    const f = await store.get('fail/' + username, { type: 'json' });
    return !!f && f.n >= LOCK_AFTER_FAILS && now - f.t < LOCK_WINDOW_MS;
}
async function noteFail(store, username, now) {
    const f = await store.get('fail/' + username, { type: 'json' });
    const n = f && now - f.t < LOCK_WINDOW_MS ? f.n + 1 : 1;
    await store.setJSON('fail/' + username, { n, t: now });
}
const clearFail = (store, username) => store.delete('fail/' + username);

// ---------- Đăng ký ----------
// body: { username, displayName, password, migrate?: { points, history } }
export async function register(store, body, now = Date.now()) {
    const username = String(body?.username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return bad(400, 'BAD_USERNAME', 'Tên đăng nhập gồm 3–20 ký tự: chữ không dấu, số, dấu _ hoặc dấu chấm.');
    const password = String(body?.password ?? '');
    if (password.length < PASSWORD_MIN) return bad(400, 'BAD_PASSWORD', 'Mật khẩu cần ít nhất 6 ký tự.');
    if (password.length > PASSWORD_MAX) return bad(400, 'BAD_PASSWORD', 'Mật khẩu quá dài.');

    let points = 0;
    let history = [];
    if (body?.migrate && typeof body.migrate === 'object') {
        // Tài khoản cũ tạo trong trình duyệt: mang điểm + lịch sử sang (có giới hạn, không thể kiểm chứng tuyệt đối)
        const p = Number(body.migrate.points);
        points = Number.isFinite(p) ? Math.max(0, Math.min(MIGRATE_MAX_POINTS, Math.floor(p))) : 0;
        history = sanitizeHistory(body.migrate.history);
    }

    const pw = await hashPassword(password);
    const code = newRecoveryCode();
    const acc = {
        username,
        displayName: cleanName(body?.displayName) || username,
        pw,
        recovery: recoveryHash(code),
        points,
        history,
        createdAt: now,
        sv: 0,
        lastAwardAt: 0,
        day: { key: '', points: 0 }
    };

    const res = await store.setJSON('acct/' + username, acc, { onlyIfNew: true });
    if (res && res.modified === false) return bad(409, 'EXISTS', 'Tên đăng nhập đã tồn tại, hãy chọn tên khác.');

    await putLb(store, acc);
    const token = await createSession(store, username, acc.sv, now);
    return { status: 201, body: { profile: publicProfile(acc), recoveryCode: code }, token };
}

function sanitizeHistory(h) {
    if (!Array.isArray(h)) return [];
    return h.slice(0, MAX_HISTORY).map((x) => ({
        name: cleanText(x?.name, 80),
        tag: cleanText(x?.tag, 30),
        icon: cleanText(x?.icon, 60),
        amount: Math.max(0, Math.min(MAX_AWARD, Math.floor(Number(x?.amount) || 0))),
        time: Number.isFinite(Date.parse(x?.time)) ? new Date(x.time).toISOString() : new Date(0).toISOString()
    })).filter((x) => x.name);
}

// ---------- Đăng nhập ----------
export async function login(store, body, now = Date.now()) {
    const username = String(body?.username || '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const wrong = () => bad(401, 'WRONG', 'Sai tên đăng nhập hoặc mật khẩu.');
    if (!USERNAME_RE.test(username) || !password || password.length > PASSWORD_MAX) return wrong();

    if (await isLocked(store, username, now)) return bad(429, 'LOCKED', 'Nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.');

    const entry = await getAcct(store, username);
    // Vẫn băm một lần khi tài khoản không tồn tại để thời gian phản hồi không lộ tên đăng nhập có thật hay không
    const ok = entry ? await verifyPassword(password, entry.data.pw) : (await hashPassword(password), false);
    if (!ok) { await noteFail(store, username, now); return wrong(); }

    await clearFail(store, username);
    const token = await createSession(store, username, entry.data.sv || 0, now);
    return { status: 200, body: { profile: publicProfile(entry.data) }, token };
}

// ---------- Đặt lại mật khẩu bằng mã khôi phục ----------
// body: { username, recoveryCode, newPassword }
export async function resetPassword(store, body, now = Date.now()) {
    const username = String(body?.username || '').trim().toLowerCase();
    const newPassword = String(body?.newPassword ?? '');
    const wrong = () => bad(401, 'WRONG_RECOVERY', 'Tên đăng nhập hoặc mã khôi phục không đúng.');
    if (!USERNAME_RE.test(username)) return wrong();
    if (newPassword.length < PASSWORD_MIN) return bad(400, 'BAD_PASSWORD', 'Mật khẩu mới cần ít nhất 6 ký tự.');
    if (newPassword.length > PASSWORD_MAX) return bad(400, 'BAD_PASSWORD', 'Mật khẩu quá dài.');

    if (await isLocked(store, 'rc:' + username, now)) return bad(429, 'LOCKED', 'Nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.');

    const entry = await getAcct(store, username);
    if (!entry || !eqHex(recoveryHash(body?.recoveryCode), entry.data.recovery)) {
        await noteFail(store, 'rc:' + username, now);
        return wrong();
    }
    await clearFail(store, 'rc:' + username);

    const acc = entry.data;
    const code = newRecoveryCode();                       // mã khôi phục dùng một lần: cấp mã mới
    acc.pw = await hashPassword(newPassword);
    acc.recovery = recoveryHash(code);
    acc.sv = (acc.sv || 0) + 1;                           // vô hiệu mọi phiên đăng nhập cũ
    const res = await store.setJSON('acct/' + username, acc, { onlyIfMatch: entry.etag });
    if (res && res.modified === false) return bad(409, 'CONFLICT', 'Dữ liệu vừa thay đổi, hãy thử lại.');

    const token = await createSession(store, username, acc.sv, now);
    return { status: 200, body: { profile: publicProfile(acc), recoveryCode: code }, token };
}

// ---------- Cộng điểm (máy chủ quyết định) ----------
// body: { amount, name, tag, icon }
export async function award(store, username, body, now = Date.now()) {
    const amount = Math.floor(Number(body?.amount));
    if (!Number.isFinite(amount) || amount < 1 || amount > MAX_AWARD) return bad(400, 'BAD_AMOUNT', `Mỗi lần cộng từ 1 đến ${MAX_AWARD} điểm.`);

    const dayKey = new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10);

    for (let attempt = 0; attempt < 4; attempt++) {
        const entry = await getAcct(store, username);
        if (!entry) return bad(401, 'NO_ACCOUNT', 'Tài khoản không tồn tại.');
        const acc = entry.data;
        const state = () => ({ points: acc.points });

        if (now - (acc.lastAwardAt || 0) < MIN_AWARD_GAP_MS) return bad(429, 'TOO_FAST', 'Bạn thao tác quá nhanh.', state());
        const day = acc.day && acc.day.key === dayKey ? acc.day : { key: dayKey, points: 0 };
        if (day.points + amount > DAILY_CAP) return bad(429, 'DAILY_CAP', 'Đã đạt giới hạn điểm của hôm nay.', state());

        const item = {
            name: cleanText(body?.name, 80) || 'Vật thể',
            tag: cleanText(body?.tag, 30),
            icon: cleanText(body?.icon, 60),
            amount,
            time: new Date(now).toISOString()
        };
        acc.points += amount;
        acc.lastAwardAt = now;
        acc.day = { key: dayKey, points: day.points + amount };
        acc.history = [item, ...(acc.history || [])].slice(0, MAX_HISTORY);

        const res = await store.setJSON('acct/' + username, acc, { onlyIfMatch: entry.etag });
        if (res && res.modified === false) continue;      // có thay đổi xen vào (vd. hai tab cùng cộng) -> đọc lại và thử lại

        await putLb(store, acc);
        return { status: 200, body: { points: acc.points, entry: item } };
    }
    return bad(409, 'CONFLICT', 'Hệ thống đang bận, hãy thử lại.');
}

// ---------- Bảng xếp hạng ----------
const BOARD_LIMIT = 50;

export async function getBoard(store, { meUsername } = {}) {
    const { blobs } = await store.list({ prefix: 'lb/' });
    const keys = blobs.slice(0, 2000).map((b) => b.key);

    const entries = [];
    for (let i = 0; i < keys.length; i += 40) {
        const chunk = await Promise.all(keys.slice(i, i + 40).map((k) => store.get(k, { type: 'json' }).catch(() => null)));
        for (const e of chunk) if (e && typeof e.points === 'number') entries.push(e);
    }
    entries.sort((a, b) => b.points - a.points || (a.createdAt || 0) - (b.createdAt || 0));

    const meId = meUsername ? idOf(meUsername) : '';
    const pub = (e) => ({ id: e.id, name: e.name, points: e.points, ...(e.id === meId ? { isMe: true } : {}) });
    const out = { leaderboard: entries.slice(0, BOARD_LIMIT).map(pub), total: entries.length };
    if (meId) {
        const idx = entries.findIndex((e) => e.id === meId);
        if (idx >= 0) out.me = { ...pub(entries[idx]), rank: idx + 1 };
    }
    return { status: 200, body: out };
}

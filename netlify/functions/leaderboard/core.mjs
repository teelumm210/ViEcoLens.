// Lõi bảng xếp hạng (thuần túy, nhận "store" từ ngoài vào nên kiểm thử được không cần Netlify).
//
// Mỗi tài khoản = một khóa "u/<id>" trong Netlify Blobs, id = 16 ký tự đầu của SHA-256(tên đăng nhập).
// Chỉ lộ id + tên hiển thị + điểm ra ngoài (KHÔNG lộ tên đăng nhập).
//
// Chống ghi đè: lần đầu một tên đăng nhập gửi điểm kèm "token" bí mật do trình duyệt tự sinh; server chỉ lưu
// BĂM của token. Về sau chỉ ai có đúng token mới cập nhật được mục đó (người khác dùng trùng tên sẽ bị từ chối).
// Giới hạn: điểm do trình duyệt tự báo nên không thể chống gian lận tuyệt đối; chỉ chặn nhảy điểm bất thường.
import { createHash, timingSafeEqual } from 'node:crypto';

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const TOKEN_RE = /^[a-f0-9]{32,64}$/;
export const MAX_POINTS = 1000000;
const FIRST_SYNC_MAX = 50000;      // tài khoản cũ có sẵn điểm trong máy: cho phép đồng bộ lần đầu tới mức này
const JUMP_BASE = 5000;            // điểm được tăng thêm tối đa mỗi lần gửi...
const JUMP_PER_MIN = 100;          // ...cộng thêm theo thời gian kể từ lần gửi trước
const BOARD_LIMIT = 50;

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export const idOf = (username) => sha256('user:' + username).slice(0, 16);
const tokenHashOf = (token) => sha256('token:' + token);

function safeEqualHex(a, b) {
    const x = Buffer.from(String(a || ''), 'hex');
    const y = Buffer.from(String(b || ''), 'hex');
    return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);

const bad = (status, code, message) => ({ status, body: { error: { status: code, message } } });

// body: { username, displayName, points, token }
export async function submitScore(store, body, now = Date.now()) {
    if (!body || typeof body !== 'object') return bad(400, 'BAD_REQUEST', 'Dữ liệu không hợp lệ.');

    const username = String(body.username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return bad(400, 'BAD_USERNAME', 'Tên đăng nhập không hợp lệ.');
    if (!TOKEN_RE.test(String(body.token || ''))) return bad(400, 'BAD_TOKEN', 'Thiếu mã xác thực.');

    const points = body.points;
    if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS) return bad(400, 'BAD_POINTS', 'Điểm không hợp lệ.');

    const id = idOf(username);
    const key = 'u/' + id;
    const tokenHash = tokenHashOf(body.token);
    const name = cleanName(body.displayName) || username;

    const existing = await store.get(key, { type: 'json' });
    if (existing) {
        if (!safeEqualHex(existing.tokenHash, tokenHash)) {
            return bad(403, 'TAKEN', 'Tên đăng nhập này đã được dùng trên bảng xếp hạng bởi thiết bị khác.');
        }
        const minutes = Math.max(0, Math.floor((now - (existing.updatedAt || now)) / 60000));
        if (points > existing.points + JUMP_BASE + minutes * JUMP_PER_MIN) {
            return bad(422, 'TOO_FAST', 'Điểm tăng nhanh bất thường.');
        }
    } else if (points > FIRST_SYNC_MAX) {
        return bad(422, 'TOO_FAST', 'Điểm khởi tạo quá lớn.');
    }

    await store.setJSON(key, {
        id, name, points, tokenHash,
        createdAt: existing?.createdAt || now,
        updatedAt: now
    });
    return { status: 200, body: { ok: true, id } };
}

// Trả về top BOARD_LIMIT + (nếu có meId) hạng thật của người đó trong toàn bộ bảng.
export async function getBoard(store, { meId } = {}) {
    const { blobs } = await store.list({ prefix: 'u/' });
    const keys = blobs.slice(0, 2000).map((b) => b.key);

    const entries = [];
    for (let i = 0; i < keys.length; i += 40) {
        const chunk = await Promise.all(keys.slice(i, i + 40).map((k) => store.get(k, { type: 'json' }).catch(() => null)));
        for (const e of chunk) if (e && typeof e.points === 'number') entries.push(e);
    }

    entries.sort((a, b) => b.points - a.points || (a.createdAt || 0) - (b.createdAt || 0));

    const pub = (e) => ({ id: e.id, name: e.name, points: e.points });
    const out = { leaderboard: entries.slice(0, BOARD_LIMIT).map(pub), total: entries.length };

    if (meId) {
        const idx = entries.findIndex((e) => e.id === meId);
        if (idx >= 0) out.me = { ...pub(entries[idx]), rank: idx + 1 };
    }
    return { status: 200, body: out };
}

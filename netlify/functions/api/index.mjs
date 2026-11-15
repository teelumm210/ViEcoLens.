// Netlify Function "api": tài khoản thật + điểm + bảng xếp hạng (lưu bằng Netlify Blobs). Logic ở ./core.mjs.
//   POST /api/auth/register   { username, displayName, password, migrate? }  -> 201 { profile, recoveryCode }
//   POST /api/auth/login      { username, password }                         -> 200 { profile }
//   POST /api/auth/logout                                                    -> 200
//   GET  /api/auth/me                                                        -> 200 { profile } | 401
//   POST /api/auth/reset      { username, recoveryCode, newPassword }        -> 200 { profile, recoveryCode }
//   POST /api/me/award        { amount, name, tag, icon }                    -> 200 { points, entry }
//   GET  /api/leaderboard                                                    -> 200 { leaderboard, total, me? }
// Phiên đăng nhập = cookie HttpOnly (JavaScript trên trang không đọc được token).
import { getStore } from '@netlify/blobs';
import * as core from './core.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const COOKIE = 'eco_sid';
const COOKIE_MAX_AGE = 30 * 24 * 3600;

const respond = (status, obj, extraHeaders = {}) => {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    for (const [k, v] of Object.entries(extraHeaders)) headers.append(k, v);
    return new Response(JSON.stringify(obj), { status, headers });
};
const err = (status, code, message) => respond(status, { error: { status: code, message } });

const setCookie = (token) => `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`;
const clearCookie = () => `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function readCookie(req, name) {
    const raw = req.headers.get('cookie') || '';
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return '';
}

// Chỉ nhận yêu cầu ghi từ chính trang web này (cùng với SameSite=Strict giúp chống CSRF).
function sameSite(req) {
    const origin = req.headers.get('origin');
    if (!origin) return false;
    try { return new URL(origin).host === new URL(req.url).host; } catch (e) { return false; }
}

async function readJson(req) {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return { error: err(413, 'TOO_LARGE', 'Dữ liệu quá lớn.') };
    if (!raw) return { body: {} };
    try { return { body: JSON.parse(raw) }; } catch (e) { return { error: err(400, 'BAD_REQUEST', 'JSON không hợp lệ.') }; }
}

// Chuyển kết quả của core thành Response (kèm cookie khi có token mới)
const out = (r) => respond(r.status, r.body, r.token ? { 'Set-Cookie': setCookie(r.token) } : {});

export default async (req) => {
    const store = getStore({ name: 'ecolens', consistency: 'strong' });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');

    try {
        // --- GET ---
        if (req.method === 'GET') {
            if (path === '/api/leaderboard') {
                const me = await core.resolveSession(store, readCookie(req, COOKIE));
                return out(await core.getBoard(store, { meUsername: me?.username }));
            }
            if (path === '/api/auth/me') {
                const acc = await core.resolveSession(store, readCookie(req, COOKIE));
                if (!acc) return err(401, 'NO_SESSION', 'Chưa đăng nhập.');
                return respond(200, { profile: core.publicProfile(acc) });
            }
            return err(404, 'NOT_FOUND', 'Không tìm thấy.');
        }

        // --- POST ---
        if (req.method !== 'POST') return err(405, 'METHOD', 'Method not allowed');
        if (!sameSite(req)) return err(403, 'FORBIDDEN', 'Yêu cầu không hợp lệ.');
        const parsed = await readJson(req);
        if (parsed.error) return parsed.error;
        const body = parsed.body;

        switch (path) {
            case '/api/auth/register': return out(await core.register(store, body));
            case '/api/auth/login': return out(await core.login(store, body));
            case '/api/auth/reset': return out(await core.resetPassword(store, body));
            case '/api/auth/logout': {
                await core.destroySession(store, readCookie(req, COOKIE));
                return respond(200, { ok: true }, { 'Set-Cookie': clearCookie() });
            }
            case '/api/me/award': {
                const acc = await core.resolveSession(store, readCookie(req, COOKIE));
                if (!acc) return err(401, 'NO_SESSION', 'Phiên đăng nhập đã hết hạn.');
                return out(await core.award(store, acc.username, body));
            }
            default: return err(404, 'NOT_FOUND', 'Không tìm thấy.');
        }
    } catch (e) {
        console.error('[api]', path, e);
        return err(500, 'SERVER', 'Máy chủ gặp lỗi, hãy thử lại sau.');
    }
};

export const config = {
    path: ['/api/auth/*', '/api/me/*', '/api/leaderboard'],
    method: ['GET', 'POST']
};

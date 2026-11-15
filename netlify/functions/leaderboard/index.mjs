// Netlify Function: bảng xếp hạng thật theo tài khoản, lưu bằng Netlify Blobs.
//   GET  /api/leaderboard[?id=<mã người dùng>]  -> { leaderboard: [{id,name,points}], total, me? }
//   POST /api/leaderboard  { username, displayName, points, token }  -> cập nhật điểm của chính tài khoản đó
// Logic nằm ở ./core.mjs.
import { getStore } from '@netlify/blobs';
import { submitScore, getBoard } from './core.mjs';

const MAX_BODY_BYTES = 4096;

const json = (status, obj) =>
    new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });

// Chỉ nhận ghi điểm từ chính trang web này.
function sameSite(req) {
    const origin = req.headers.get('origin');
    if (!origin) return false;
    try { return new URL(origin).host === new URL(req.url).host; } catch (e) { return false; }
}

export default async (req) => {
    const store = getStore({ name: 'leaderboard', consistency: 'strong' });

    try {
        if (req.method === 'GET') {
            const meId = new URL(req.url).searchParams.get('id') || '';
            const r = await getBoard(store, { meId: /^[a-f0-9]{16}$/.test(meId) ? meId : '' });
            return json(r.status, r.body);
        }

        if (req.method === 'POST') {
            if (!sameSite(req)) return json(403, { error: { status: 'FORBIDDEN', message: 'Yêu cầu không hợp lệ.' } });
            const raw = await req.text();
            if (raw.length > MAX_BODY_BYTES) return json(413, { error: { status: 'TOO_LARGE', message: 'Dữ liệu quá lớn.' } });
            let body;
            try { body = JSON.parse(raw); } catch (e) { return json(400, { error: { status: 'BAD_REQUEST', message: 'JSON không hợp lệ.' } }); }
            const r = await submitScore(store, body);
            return json(r.status, r.body);
        }

        return json(405, { error: { status: 'METHOD', message: 'Method not allowed' } });
    } catch (e) {
        console.error('[leaderboard]', e);
        return json(500, { error: { status: 'SERVER', message: 'Không đọc/ghi được bảng xếp hạng.' } });
    }
};

export const config = { path: '/api/leaderboard', method: ['GET', 'POST'] };

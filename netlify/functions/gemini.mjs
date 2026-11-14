// Netlify Function: proxy gọi Gemini để API key nằm ở SERVER (biến môi trường GEMINI_API_KEY),
// không còn nằm trong mã nguồn / trình duyệt.
//
// Client gửi:  POST /.netlify/functions/gemini   { "model": "gemini-2.5-flash", "body": { ...generateContent body... } }
// Function trả nguyên trạng thái + JSON của Google (client xử lý lỗi như khi gọi trực tiếp).
//
// Hạn chế lạm dụng (không thể chặn tuyệt đối với endpoint công khai):
//   - chỉ nhận yêu cầu từ chính trang web này (kiểm tra Origin cùng host)
//   - chỉ cho phép model gemini-*, chỉ hành động generateContent
//   - chỉ chuyển tiếp các trường contents / systemInstruction / generationConfig (không có tools)
//   - giới hạn kích thước yêu cầu và số token trả về

const MAX_BODY_BYTES = 5.5 * 1024 * 1024;   // giới hạn payload của Netlify Functions là 6 MB
const MAX_OUTPUT_TOKENS = 4096;
const MODEL_RE = /^gemini-[a-z0-9][a-z0-9.\-]{0,60}$/;
const ALLOWED_FIELDS = ['contents', 'systemInstruction', 'generationConfig'];

const json = (status, obj) =>
    new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });

const fail = (status, message, code) => json(status, { error: { code: status, status: code || 'ERROR', message } });

function sameSite(req) {
    const origin = req.headers.get('origin');
    if (!origin) return false;
    try {
        return new URL(origin).host === new URL(req.url).host;
    } catch (e) {
        return false;
    }
}

export default async (req) => {
    if (req.method !== 'POST') return fail(405, 'Method not allowed');
    if (!sameSite(req)) return fail(403, 'Yêu cầu không hợp lệ.', 'FORBIDDEN');

    const apiKey = Netlify.env.get('GEMINI_API_KEY');
    if (!apiKey) return fail(503, 'Máy chủ chưa cấu hình GEMINI_API_KEY.', 'NOKEY');

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, 'Dữ liệu gửi lên quá lớn.', 'TOO_LARGE');

    let payload;
    try {
        payload = JSON.parse(raw);
    } catch (e) {
        return fail(400, 'JSON không hợp lệ.', 'BAD_REQUEST');
    }

    const model = payload && payload.model;
    const body = payload && payload.body;
    if (typeof model !== 'string' || !MODEL_RE.test(model)) return fail(400, 'Model không được phép.', 'BAD_MODEL');
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.contents)) {
        return fail(400, 'Thiếu nội dung yêu cầu.', 'BAD_REQUEST');
    }

    const safeBody = {};
    for (const k of ALLOWED_FIELDS) if (body[k] !== undefined) safeBody[k] = body[k];
    if (safeBody.generationConfig && typeof safeBody.generationConfig === 'object') {
        const g = { ...safeBody.generationConfig };
        if (g.maxOutputTokens != null && g.maxOutputTokens > MAX_OUTPUT_TOKENS) g.maxOutputTokens = MAX_OUTPUT_TOKENS;
        safeBody.generationConfig = g;
    }

    let upstream;
    try {
        upstream = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(safeBody)
            }
        );
    } catch (e) {
        return fail(502, 'Không kết nối được tới Gemini.', 'UPSTREAM');
    }

    const text = await upstream.text();
    return new Response(text, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
};

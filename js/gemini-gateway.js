/**
 * ViEcoLens - gemini-gateway.js
 * Cổng gọi Gemini duy nhất cho toàn app (gemini.js, ai.js, voice.js dùng chung).
 * Đối tượng công khai: window.ecoGeminiGateway
 * (KHÔNG đặt tên ecoGemini: tên đó đã dùng cho GeminiManager trong gemini.js).
 *
 *  - Người dùng tự nhập API Key (Setting) -> gọi thẳng Google bằng key đó (key nằm trong header).
 *  - Không có key cá nhân -> gọi qua Netlify Function /.netlify/functions/gemini;
 *    key hệ thống nằm ở máy chủ (biến môi trường GEMINI_API_KEY), KHÔNG có trong mã nguồn.
 * Trả về Response của fetch nên nơi gọi vẫn xử lý res.ok / res.json() như cũ.
 */
(() => {
    'use strict';

    const LS_KEY = 'eco_gemini_api_key';
    const PROXY_URL = '/.netlify/functions/gemini';

    function ownKey() {
        try { return (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) { return ''; }
    }

    function generateContent(model, body, opts = {}) {
        const key = ownKey();
        if (key) {
            return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                body: JSON.stringify(body),
                signal: opts.signal
            });
        }
        return fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, body }),
            signal: opts.signal
        });
    }


    // ---- Nhớ model đang chạy tốt (đỡ mất 1-3 vòng mạng mỗi lần hỏi khi model đầu danh sách lỗi/không tồn tại) ----
    const GOOD_KEY = 'eco_gemini_good_model';
    const dead = new Map();                       // model -> thời điểm được thử lại (404/không hỗ trợ: nghỉ 10 phút)
    let good = '';
    try { good = sessionStorage.getItem(GOOD_KEY) || ''; } catch (e) { /* bỏ qua */ }

    function orderModels(list) {
        const now = Date.now();
        const alive = list.filter((m) => !(dead.get(m) > now));
        const base = alive.length ? alive : list;                 // tất cả đều "chết" thì vẫn thử lại hết
        return good && base.includes(good) ? [good, ...base.filter((m) => m !== good)] : base;
    }
    function markGood(model) {
        good = model;
        dead.delete(model);
        try { sessionStorage.setItem(GOOD_KEY, model); } catch (e) { /* bỏ qua */ }
    }
    function markDead(model, ms = 600000) { dead.set(model, Date.now() + ms); if (good === model) good = ''; }

    // Giảm bước "suy nghĩ" nội bộ để trả lời nhanh (model nào không hỗ trợ trả 400 -> nơi gọi thử lại không kèm nó).
    function thinkingFor(model) {
        if (/^gemini-3/.test(model)) return { thinkingLevel: 'minimal' };
        if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
        return null;
    }

    // Máy chủ báo chưa cấu hình key hệ thống (status NOKEY).
    const isNoKeyError = (errBody) => !!errBody && !!errBody.error && errBody.error.status === 'NOKEY';

    window.ecoGeminiGateway = { generateContent, hasOwnKey: () => !!ownKey(), isNoKeyError, orderModels, markGood, markDead, thinkingFor };
})();

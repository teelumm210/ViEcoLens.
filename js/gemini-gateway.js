/**
 * ViGreen - gemini-gateway.js
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

    // Máy chủ báo chưa cấu hình key hệ thống (status NOKEY).
    const isNoKeyError = (errBody) => !!errBody && !!errBody.error && errBody.error.status === 'NOKEY';

    window.ecoGeminiGateway = { generateContent, hasOwnKey: () => !!ownKey(), isNoKeyError };
})();

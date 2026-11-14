// ai.js — Lớp gọi Gemini dùng chung cho Quiz, Mini game và Live (window.ecoAI).
//
//  - generateJSON({ system, prompt, schema, temperature }) -> object  (ép Gemini trả JSON đúng cấu trúc)
//  - chat({ system, contents, temperature })              -> string  (hội thoại, có thể kèm ảnh)
//
// Dùng chung API key với gemini.js (getApiKey) và tự thử lần lượt nhiều model khi một model quá tải / không tồn tại.
(() => {
    'use strict';

    // Thứ tự giống gemini.js: model nhanh còn được cấp trước, model cũ (2.0/2.5, có thể đã ngừng) để cuối.
    const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
    const TIMEOUT_MS = 30000;

    function makeError(message, code) {
        const err = new Error(message);
        err.code = code;
        return err;
    }

    // Gọi generateContent, thử lần lượt các model. Trả về chuỗi văn bản của ứng viên đầu tiên.
    // opts.deadlineMs: tổng thời gian tối đa cho cả chuỗi thử model (trò chuyện live cần trả lời nhanh, không chờ cả phút).
    async function request(body, opts = {}) {
        let lastErr = null;
        let sentBody = body;
        const startedAt = Date.now();
        const deadline = opts.deadlineMs || 0;

        for (const model of MODELS) {
            const left = deadline ? deadline - (Date.now() - startedAt) : TIMEOUT_MS;
            if (left < 2500) { lastErr = lastErr || makeError('Gemini phản hồi quá lâu.', 'timeout'); break; }
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), Math.min(TIMEOUT_MS, left));
            try {
                // key cá nhân -> gọi thẳng Google; không có -> qua Netlify Function (js/gemini-gateway.js)
                const res = await window.ecoGeminiGateway.generateContent(model, sentBody, { signal: ctrl.signal });

                if (!res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    const msg = errBody.error?.message || `HTTP ${res.status}`;

                    if (window.ecoGeminiGateway.isNoKeyError(errBody)) throw makeError('Máy chủ chưa có API Key Gemini.', 'nokey');

                    if (res.status === 401 || res.status === 403 || /api key/i.test(msg)) {
                        throw makeError('API Key Gemini không hợp lệ.', 'badkey');
                    }
                    // Model không hỗ trợ responseSchema -> bỏ schema, vẫn yêu cầu JSON
                    if (res.status === 400 && /schema/i.test(msg) && sentBody.generationConfig?.responseSchema) {
                        sentBody = {
                            ...sentBody,
                            generationConfig: { ...sentBody.generationConfig, responseSchema: undefined }
                        };
                    }
                    lastErr = makeError(msg, res.status === 429 ? 'quota' : 'fail');
                    continue;                                            // 404/429/5xx/400 -> thử model kế tiếp
                }

                const data = await res.json();
                const text = (data.candidates?.[0]?.content?.parts || [])
                    .map((p) => p.text || '')
                    .join('')
                    .trim();
                if (!text) { lastErr = makeError('Gemini không trả về nội dung.', 'empty'); continue; }
                return text;
            } catch (e) {
                if (e.code === 'badkey' || e.code === 'nokey') throw e;
                lastErr = e.name === 'AbortError' ? makeError('Gemini phản hồi quá lâu.', 'timeout') : e;
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastErr || makeError('Không gọi được Gemini.', 'fail');
    }

    // Gỡ rào ```json ... ``` rồi parse; cố gắng cắt đúng khối JSON nếu AI nói thêm lời dẫn.
    function parseJSON(text) {
        let t = String(text || '').trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();
        try {
            return JSON.parse(t);
        } catch (e) {
            const a = t.search(/[\[{]/);
            const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
            if (a >= 0 && b > a) {
                try { return JSON.parse(t.slice(a, b + 1)); } catch (e2) { /* rơi xuống lỗi bên dưới */ }
            }
            throw makeError('AI trả về dữ liệu không đúng định dạng JSON.', 'badjson');
        }
    }

    async function generateJSON({ system, prompt, schema, temperature = 0.9 }) {
        const generationConfig = { temperature, responseMimeType: 'application/json' };
        if (schema) generationConfig.responseSchema = schema;
        const text = await request({
            systemInstruction: { parts: [{ text: system || '' }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig
        });
        return parseJSON(text);
    }

    async function chat({ system, contents, temperature = 0.7, maxOutputTokens = 2048, deadlineMs = 0 }) {
        return request({
            systemInstruction: { parts: [{ text: system || '' }] },
            contents,
            generationConfig: { temperature, maxOutputTokens }
        }, { deadlineMs });
    }

    window.ecoAI = { generateJSON, chat, parseJSON, hasKey: () => true };   // luôn có đường gọi: key cá nhân hoặc máy chủ
})();

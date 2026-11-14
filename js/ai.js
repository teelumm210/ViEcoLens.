// ai.js — Lớp gọi Gemini dùng chung cho Quiz, Mini game và Live (window.ecoAI).
//
//  - generateJSON({ system, prompt, schema, temperature }) -> object  (ép Gemini trả JSON đúng cấu trúc)
//  - chat({ system, contents, temperature })              -> string  (hội thoại, có thể kèm ảnh)
//
// Dùng chung API key với gemini.js (getApiKey) và tự thử lần lượt nhiều model khi một model quá tải / không tồn tại.
(() => {
    'use strict';

    const MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
    const TIMEOUT_MS = 30000;

    function apiKey() {
        try {
            if (typeof getApiKey === 'function') return getApiKey();
        } catch (e) { /* bỏ qua */ }
        try { return localStorage.getItem('eco_gemini_api_key'); } catch (e) { return null; }
    }

    function makeError(message, code) {
        const err = new Error(message);
        err.code = code;
        return err;
    }

    // Gọi generateContent, thử lần lượt các model. Trả về chuỗi văn bản của ứng viên đầu tiên.
    async function request(body) {
        const key = apiKey();
        if (!key) throw makeError('Chưa có API Key Gemini.', 'nokey');

        let lastErr = null;
        let sentBody = body;

        for (const model of MODELS) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                    body: JSON.stringify(sentBody),
                    signal: ctrl.signal
                });

                if (!res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    const msg = errBody.error?.message || `HTTP ${res.status}`;

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
                if (e.code === 'badkey') throw e;
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

    async function chat({ system, contents, temperature = 0.7, maxOutputTokens = 1024 }) {
        return request({
            systemInstruction: { parts: [{ text: system || '' }] },
            contents,
            generationConfig: { temperature, maxOutputTokens }
        });
    }

    window.ecoAI = { generateJSON, chat, parseJSON, hasKey: () => !!apiKey() };
})();

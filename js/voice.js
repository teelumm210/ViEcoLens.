/**
 * ViGreen - voice.js
 * Giọng nói cho app: nhập chat bằng mic (SpeechRecognition) + đọc to tiếng Việt.
 *
 * Đọc to có 2 "động cơ":
 *   - device : giọng tiếng Việt có sẵn trong thiết bị (speechSynthesis).
 *   - gemini : giọng AI Gemini TTS (cần mạng + API key), rõ và tự nhiên hơn.
 * Chế độ "auto": có giọng tiếng Việt trên thiết bị thì dùng, không có thì dùng Gemini.
 * KHÔNG BAO GIỜ đọc tiếng Việt bằng giọng của ngôn ngữ khác (nguyên nhân gây đọc sai/khó nghe).
 *
 * Yêu cầu trong index.html: #voice-mic-btn, #voice-speak-btn, mục #voice-settings
 * và <script src="js/voice.js"> (sau state.js, trước gemini.js).
 * gemini.js gọi ecoVoice.speakReply() / ecoVoice.speakScanResult();
 * app.js gọi ecoVoice.stop() / cancelListening() trong navigateTo().
 */
(() => {
    'use strict';

    // ---------- Cài đặt (dùng chung với state.js: window.ecoState.voice) ----------
    const LS = {
        auto: 'eco_voice_auto',
        rate: 'eco_voice_rate',
        send: 'eco_voice_autosend',
        engine: 'eco_voice_engine',
        device: 'eco_voice_device',
        gvoice: 'eco_voice_gvoice'
    };

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } }
    };

    const settings = (window.ecoState && window.ecoState.voice) || {
        autoSpeak: store.get(LS.auto) === '1',
        rate: parseFloat(store.get(LS.rate)) || 0.9,
        autoSend: store.get(LS.send) !== '0',
        engine: store.get(LS.engine) || 'auto',          // auto | device | gemini
        deviceVoice: store.get(LS.device) || '',         // tên giọng thiết bị người dùng chọn ('' = tự chọn)
        geminiVoice: store.get(LS.gvoice) || 'Kore'
    };
    // phòng khi state.js cũ chưa có các trường mới
    if (!settings.engine) settings.engine = 'auto';
    if (settings.deviceVoice == null) settings.deviceVoice = '';
    if (!settings.geminiVoice) settings.geminiVoice = 'Kore';

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const synth = window.speechSynthesis;

    let recognition = null;
    let listening = false;
    let speaking = false;
    let speakId = 0;               // mỗi lần đọc/dừng tăng 1 để bỏ qua sự kiện của lần đọc cũ
    let currentSource = null;      // 'chat-screen' | 'scan-screen' | null
    let abortRequested = false;    // true khi hủy nghe (chuyển màn hình) -> không tự gửi
    let voiceInitiated = false;    // câu hỏi vừa rồi được nói bằng mic -> trả lời sẽ được đọc
    let currentUtterance = null;   // GIỮ tham chiếu: Chrome có thể "thu rác" utterance làm tiếng bị cụt giữa chừng
    let startTimer = null;         // hẹn giờ bắt đầu đọc (chờ sau cancel)
    let watchdog = null;           // phòng khi trình duyệt không bắn sự kiện onend
    let playCancel = null;         // hủy đoạn âm thanh Gemini đang phát
    let doneCb = null;             // gọi khi đọc XONG (dùng cho trò chuyện rảnh tay ở Live)

    // ---------- Tiện ích ----------
    function toast(msg, ms = 3200) {
        let el = document.getElementById('voice-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'voice-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => el.classList.remove('show'), ms);
    }

    // ---------- Xử lý văn bản trước khi đọc ----------
    // Bước 1: HTML -> văn bản, giữ chỗ ngắt câu (<br>, <li>, <p>...) để các ý không dính liền nhau.
    function cleanText(raw) {
        if (!raw) return '';
        const html = String(raw)
            .replace(/<\s*br\s*\/?>/gi, '. ')
            .replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, '. ');
        const text = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
        return normalize(text);
    }

    // Bước 2 (thuần chuỗi): bỏ markdown/URL/emoji, đọc đúng số - ký hiệu - từ viết tắt, chuẩn hóa dấu câu.
    function normalize(text) {
        text = String(text || '')
            .replace(/https?:\/\/\S+/g, ' ')
            .replace(/^\s*[-•*]\s+/gm, '')                              // gạch đầu dòng
            .replace(/[*_`#~>]+/g, ' ')
            .replace(/\p{Extended_Pictographic}/gu, ' ')
            // --- ký hiệu & từ viết tắt hay gặp (để giọng tiếng Việt không đánh vần sai) ---
            .replace(/(\d)\s*%/g, '$1 phần trăm')
            .replace(/°\s*C\b/g, ' độ xê')
            .replace(/\bkg\b/gi, ' ki-lô-gam')
            .replace(/\bml\b/gi, ' mi-li-lít')
            .replace(/\bHDPE\b/g, 'hát đê pê ê')
            .replace(/\bLDPE\b/g, 'eo đê pê ê')
            .replace(/\bPET\b/g, 'pê ê tê')
            .replace(/\bPVC\b/g, 'pê vê xê')
            .replace(/\bPP\b/g, 'pê pê')
            .replace(/&/g, ' và ')
            .replace(/(\p{L})\s*\/\s*(\p{L})/gu, '$1 hoặc $2')
            // --- số: "1.000" = một nghìn, "2.5" / "2,5" = hai phẩy năm ---
            .replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (m) => m.replace(/\./g, ''))
            .replace(/(\d)[.,](\d)/g, '$1 phẩy $2')
            // --- dấu câu ---
            .replace(/\s*\n\s*/g, '. ')                                 // xuống dòng = hết ý
            .replace(/\s+/g, ' ')
            .replace(/([.!?…])(\s*[.,;:])+/g, '$1')                     // ". ." / ".." -> "."
            .replace(/([,;:])\s*\./g, '$1')                             // ":." -> ":"
            .replace(/\s+([.,;:!?…])/g, '$1')                           // "a ." -> "a."
            .replace(/[,;:\s]+$/, '')                                   // bỏ dấu phẩy/hai chấm treo ở cuối
            .trim();
        if (text && !/[.!?…]$/.test(text)) text += '.';
        return text;
    }

    // Chia thành các đoạn <= max ký tự theo CÂU để không bị cụt giữa chừng.
    // Dấu kết câu phải đi kèm khoảng trắng/hết chuỗi nên số như "2.5" không bị cắt.
    function chunk(text, max = 120) {
        const sentences = text.match(/[\s\S]+?(?:[.!?…]+(?=\s|$)|$)/g) || [text];
        const out = [];
        let cur = '';
        sentences.forEach((s) => {
            s = s.trim();
            if (!s) return;
            if ((cur + ' ' + s).trim().length <= max) {
                cur = (cur + ' ' + s).trim();
            } else {
                if (cur) out.push(cur);
                while (s.length > max) {                                // câu quá dài: cắt tiếp theo dấu phẩy / khoảng trắng
                    let cut = Math.max(s.lastIndexOf(',', max), s.lastIndexOf(';', max));
                    if (cut < 40) cut = s.lastIndexOf(' ', max);
                    if (cut < 1) cut = max;
                    out.push(s.slice(0, cut + 1).trim());
                    s = s.slice(cut + 1).trim();
                }
                cur = s;
            }
        });
        if (cur) out.push(cur);
        return out;
    }

    // Soạn thành câu hoàn chỉnh: "Đây là chai nhựa, thuộc nhóm rác tái chế. <gợi ý>"
    function composeScan(name, tag, suggestion) {
        name = String(name || '').trim().replace(/[.!?…]+$/, '');
        const t = String(tag || '').trim().toLowerCase();
        const skipTag = !t || /không rõ|lỗi/.test(t);
        let head = '';
        if (name) head = skipTag ? `Đây là ${name}.` : `Đây là ${name}, thuộc nhóm ${t}.`;
        return `${head} ${suggestion || ''}`.trim();
    }

    // ---------- Giọng tiếng Việt của thiết bị ----------
    const isViVoice = (v) => /^vi([-_]|$)/i.test(v.lang || '') || /vi[eệ]t/i.test(v.name || '');

    function voiceScore(v) {
        let s = 0;
        const n = v.name || '';
        if (/natural|neural|online/i.test(n)) s += 4;                   // giọng neural (Edge/Windows)
        if (/google/i.test(n)) s += 3;
        if (v.localService) s += 1;
        if (/^vi[-_]VN$/i.test(v.lang || '')) s += 1;
        return s;
    }

    function getViVoices() {
        if (!synth || !synth.getVoices) return [];
        return (synth.getVoices() || []).filter(isViVoice).sort((a, b) => voiceScore(b) - voiceScore(a));
    }

    function getDeviceVoice() {
        const list = getViVoices();
        if (settings.deviceVoice) {
            const chosen = list.find((v) => v.name === settings.deviceVoice);
            if (chosen) return chosen;
        }
        return list[0] || null;
    }

    function resolveEngine() {
        const hasVi = !!getDeviceVoice();
        if (settings.engine === 'gemini') return 'gemini';
        if (settings.engine === 'device') return hasVi ? 'device' : 'none';
        return hasVi ? 'device' : 'gemini';                              // auto
    }

    // Trình duyệt tải danh sách giọng bất đồng bộ -> nạp lại nhiều lần cho chắc.
    function loadVoices() {
        populateVoiceSelect();
        refreshVoiceStatus();
    }

    // ---------- Đọc bằng giọng thiết bị ----------
    function speakDevice(text, id, wait) {
        if (!synth) { toast('Trình duyệt chưa hỗ trợ đọc to.'); finish(id); return; }
        const voice = getDeviceVoice();
        if (!voice) { noViVoiceHint(); finish(id); return; }

        const parts = chunk(text, 120);

        // Đọc TUẦN TỰ từng đoạn: đoạn sau chỉ bắt đầu khi đoạn trước đã xong.
        const next = (i) => {
            if (id !== speakId) return;
            if (i >= parts.length) { finish(id); return; }

            const u = new SpeechSynthesisUtterance(parts[i]);
            u.voice = voice;
            u.lang = voice.lang || 'vi-VN';
            u.rate = settings.rate || 1;
            u.pitch = 1;
            u.volume = 1;

            let advanced = false;
            const advance = () => {
                if (advanced) return;
                advanced = true;
                clearTimeout(watchdog);
                next(i + 1);
            };
            u.onend = advance;
            u.onerror = (e) => {
                if (id !== speakId) return;
                if (e && (e.error === 'canceled' || e.error === 'interrupted')) return;   // do mình chủ động dừng
                advance();                                                               // lỗi một đoạn -> đọc tiếp đoạn sau
            };

            currentUtterance = u;
            synth.speak(u);

            // Chốt chặn: trình duyệt "quên" bắn onend thì tự chuyển đoạn.
            clearTimeout(watchdog);
            watchdog = setTimeout(() => {
                if (id === speakId && !advanced && !synth.speaking && !synth.pending) advance();
            }, Math.max(4000, (parts[i].length * 140) / (settings.rate || 1)));
        };

        // Gọi speak() ngay sau cancel() làm Chrome/Android nuốt mất đầu câu -> chờ một nhịp.
        clearTimeout(startTimer);
        startTimer = setTimeout(() => next(0), wait ? 150 : 0);
    }

    function noViVoiceHint() {
        toast('Thiết bị chưa có giọng đọc tiếng Việt. Hãy chọn "Giọng AI Gemini" trong Cài đặt › Giọng nói, hoặc cài giọng Tiếng Việt cho thiết bị.', 6000);
    }

    // ---------- Đọc bằng giọng AI Gemini ----------
    // Thử lần lượt các model TTS (model mới trước); nhớ model đã chạy được.
    const GEMINI_TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'];
    let workingModel = null;
    const audioCache = new Map();                                       // "giọng|văn bản" -> Promise<Blob>
    const ttsAudio = new Audio();                                       // MỘT phần tử dùng lại (iOS chỉ cần "mở khóa" một lần)

    function geminiKey() {
        try {
            if (typeof getApiKey === 'function') return getApiKey();
        } catch (e) { /* bỏ qua */ }
        return store.get('eco_gemini_api_key');
    }

    function geminiBody(model, text) {
        const voice = settings.geminiVoice || 'Kore';
        const legacy = /3\.1|2\.5/.test(model);                         // định dạng giọng của model đời cũ
        return {
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: legacy ? { prebuiltVoiceConfig: { voiceName: voice } } : { voice }
                }
            }
        };
    }

    function b64ToBytes(b64) {
        return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    }

    // PCM 16-bit mono -> file WAV phát được bằng <audio>
    function pcmToWav(pcm, rate = 24000) {
        const buf = new ArrayBuffer(44 + pcm.length);
        const v = new DataView(buf);
        const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE');
        str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        str(36, 'data'); v.setUint32(40, pcm.length, true);
        new Uint8Array(buf, 44).set(pcm);
        return new Blob([buf], { type: 'audio/wav' });
    }

    function audioPartToBlob(inlineData) {
        const bytes = b64ToBytes(inlineData.data);
        const mime = inlineData.mimeType || inlineData.mime_type || '';
        const isWav = /wav/i.test(mime) || (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF');
        if (isWav) return new Blob([bytes], { type: 'audio/wav' });
        const rate = parseInt((/rate=(\d+)/i.exec(mime) || [])[1], 10) || 24000;   // L16 thô -> thêm header WAV
        return pcmToWav(bytes, rate);
    }

    async function fetchGeminiAudio(text) {
        const key = geminiKey();
        if (!key) { const e = new Error('Thiếu API Key Gemini'); e.code = 'nokey'; throw e; }

        const models = workingModel ? [workingModel, ...GEMINI_TTS_MODELS.filter((m) => m !== workingModel)] : GEMINI_TTS_MODELS;
        let lastStatus = 0;

        for (const model of models) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 25000);
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                    body: JSON.stringify(geminiBody(model, text)),
                    signal: ctrl.signal
                });
                if (!res.ok) {
                    lastStatus = res.status;
                    if (res.status === 401 || res.status === 403) { const e = new Error('API Key không hợp lệ'); e.code = 'badkey'; throw e; }
                    continue;                                            // 400/404/429/5xx -> thử model kế tiếp
                }
                const json = await res.json();
                const part = (json.candidates?.[0]?.content?.parts || []).find((p) => (p.inlineData || p.inline_data)?.data);
                if (!part) { lastStatus = 204; continue; }
                workingModel = model;
                return audioPartToBlob(part.inlineData || part.inline_data);
            } catch (e) {
                if (e.code === 'badkey') throw e;
                lastStatus = lastStatus || -1;
            } finally {
                clearTimeout(timer);
            }
        }
        const err = new Error('Gemini TTS lỗi ' + lastStatus);
        err.code = lastStatus === 429 ? 'quota' : 'fail';
        throw err;
    }

    // Có cache: đọc lại cùng một câu không tốn thêm lượt gọi API.
    function geminiAudio(text) {
        const k = (settings.geminiVoice || 'Kore') + '|' + text;
        if (audioCache.has(k)) return audioCache.get(k);
        const p = fetchGeminiAudio(text);
        audioCache.set(k, p);
        p.catch(() => audioCache.delete(k));                             // lỗi thì không giữ trong cache
        if (audioCache.size > 30) audioCache.delete(audioCache.keys().next().value);
        return p;
    }

    function playBlob(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const done = (err) => {
                ttsAudio.onended = null;
                ttsAudio.onerror = null;
                playCancel = null;
                URL.revokeObjectURL(url);
                err ? reject(err) : resolve();
            };
            playCancel = () => { try { ttsAudio.pause(); } catch (e) { /* bỏ qua */ } done(); };
            ttsAudio.onended = () => done();
            ttsAudio.onerror = () => done(new Error('audio'));
            ttsAudio.src = url;
            const rate = Math.min(1.3, Math.max(0.7, settings.rate || 1));
            ttsAudio.defaultPlaybackRate = rate;
            ttsAudio.playbackRate = rate;
            const p = ttsAudio.play();
            if (p && p.catch) p.catch((e) => done(e));
        });
    }

    async function speakGemini(text, id) {
        const parts = chunk(text, 220);                                  // đoạn dài hơn để ít lần gọi API
        let played = false;
        try {
            let pending = geminiAudio(parts[0]);
            for (let i = 0; i < parts.length; i++) {
                const blob = await pending;
                if (id !== speakId) return;
                // tải sẵn đoạn kế tiếp trong lúc đang phát đoạn này
                pending = i + 1 < parts.length ? geminiAudio(parts[i + 1]) : null;
                if (pending) pending.catch(() => {});
                played = true;
                await playBlob(blob);
                if (id !== speakId) return;
            }
            finish(id);
        } catch (e) {
            if (id !== speakId) return;
            console.warn('[Voice] Gemini TTS:', e);
            if (!played && getDeviceVoice()) {                           // dự phòng: giọng tiếng Việt của thiết bị
                toast('Giọng AI chưa dùng được, chuyển sang giọng của thiết bị.');
                speakDevice(text, id, false);
                return;
            }
            if (e && e.name === 'NotAllowedError') toast('Trình duyệt chặn tự phát âm thanh. Hãy bấm nút "Đọc to".');
            else if (e && e.code === 'nokey') toast('Chưa có API Key Gemini để dùng giọng AI.');
            else if (e && e.code === 'badkey') toast('API Key Gemini không hợp lệ.');
            else if (e && e.code === 'quota') toast('Giọng AI Gemini đang hết hạn mức, hãy thử lại sau.');
            else toast('Không tải được giọng AI Gemini. Kiểm tra mạng và thử lại.');
            finish(id);
        }
    }

    // ---------- Điều khiển đọc ----------
    function finish(id) {
        if (id !== speakId) return;
        clearTimeout(watchdog);
        speaking = false;
        currentSource = null;
        currentUtterance = null;
        refreshUI();
        const cb = doneCb;
        doneCb = null;
        if (cb) { try { cb(); } catch (e) { console.warn('[Voice] onDone lỗi:', e); } }
    }

    // opts.onDone: hàm gọi khi đọc xong (không gọi nếu bị ngắt bằng stop() hoặc bị câu mới thay thế)
    function speak(raw, source, opts) {
        const text = cleanText(raw);
        if (!text) { if (opts && opts.onDone) opts.onDone(); return; }

        const wasActive = !!(synth && (synth.speaking || synth.pending));
        stopSpeaking();
        if (listening) cancelListening();

        const engine = resolveEngine();
        if (engine === 'none') { noViVoiceHint(); if (opts && opts.onDone) opts.onDone(); return; }

        const id = ++speakId;
        doneCb = (opts && opts.onDone) || null;
        currentSource = source || null;
        speaking = true;
        refreshUI();

        if (engine === 'gemini') speakGemini(text, id);
        else speakDevice(text, id, wasActive);
    }

    function stopSpeaking() {
        speakId++;
        doneCb = null;
        clearTimeout(startTimer);
        clearTimeout(watchdog);
        if (synth) synth.cancel();
        if (playCancel) playCancel();
        speaking = false;
        currentSource = null;
        currentUtterance = null;
        refreshUI();
    }

    // iOS/Safari chỉ cho phát âm thanh sau lần chạm đầu tiên của người dùng:
    // "mở khóa" cả speechSynthesis lẫn phần tử <audio> để tính năng tự động đọc sau này có tiếng.
    function unlockAudio() {
        try {
            if (synth) {
                const u = new SpeechSynthesisUtterance('');
                u.volume = 0;
                synth.speak(u);
            }
        } catch (e) { /* bỏ qua */ }
        try {
            const url = URL.createObjectURL(pcmToWav(new Uint8Array(480), 24000));
            ttsAudio.src = url;
            const p = ttsAudio.play();
            if (p && p.then) {
                p.then(() => { if (!speaking) ttsAudio.pause(); URL.revokeObjectURL(url); })
                 .catch(() => URL.revokeObjectURL(url));
            }
        } catch (e) { /* bỏ qua */ }
    }

    // ---------- Nhận dạng giọng nói (STT) ----------
    function startListening() {
        if (!SR) {
            toast('Trình duyệt chưa hỗ trợ nhận dạng giọng nói. Hãy dùng Chrome hoặc Edge.');
            return;
        }
        const input = document.getElementById('chat-input');
        if (!input) return;

        stopSpeaking();
        abortRequested = false;

        recognition = new SR();
        recognition.lang = 'vi-VN';
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;

        let transcript = '';

        recognition.onstart = () => { listening = true; refreshUI(); };

        recognition.onresult = (e) => {
            transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
            input.value = transcript;
        };

        recognition.onerror = (e) => {
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                toast('Bạn chưa cấp quyền micro cho trang này.');
            } else if (e.error === 'no-speech') {
                toast('Không nghe thấy gì, hãy thử lại nhé.');
            } else if (e.error === 'network') {
                toast('Lỗi mạng khi nhận dạng giọng nói.');
            } else if (e.error !== 'aborted') {
                toast('Không nhận dạng được: ' + e.error);
            }
        };

        recognition.onend = () => {
            listening = false;
            recognition = null;
            refreshUI();
            if (!transcript || abortRequested) { abortRequested = false; return; }
            if (settings.autoSend) {
                voiceInitiated = true;
                document.getElementById('send-btn')?.click();
            } else {
                input.focus();
            }
        };

        try {
            recognition.start();
        } catch (err) {
            console.warn('[Voice] start lỗi:', err);
        }
    }

    function stopListening() {
        if (recognition) {
            try { recognition.stop(); } catch (e) { /* bỏ qua */ }
        }
    }

    // Hủy nghe: dừng ngay và KHÔNG gửi phần chữ đang nhận dạng dở.
    function cancelListening() {
        if (!recognition) return;
        abortRequested = true;
        try { recognition.abort(); } catch (e) { /* bỏ qua */ }
    }

    function toggleListening() {
        listening ? stopListening() : startListening();
    }

    // Nghe MỘT câu (không gắn với ô chat) — dùng cho trò chuyện rảnh tay ở Greeny Live.
    // Trả về { stop(), abort() } hoặc null nếu không bắt đầu được.
    function listenOnce({ onInterim, onFinal, onEnd, onError } = {}) {
        if (!SR) { if (onError) onError({ error: 'unsupported' }); if (onEnd) onEnd(); return null; }
        const rec = new SR();
        rec.lang = 'vi-VN';
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;

        let transcript = '';
        let aborted = false;

        rec.onresult = (e) => {
            transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
            if (onInterim) onInterim(transcript);
        };
        rec.onerror = (e) => { if (e.error !== 'aborted' && onError) onError(e); };
        rec.onend = () => {
            if (transcript && !aborted && onFinal) onFinal(transcript);
            if (onEnd) onEnd();
        };

        try {
            rec.start();
        } catch (err) {
            if (onError) onError({ error: 'start' });
            if (onEnd) onEnd();
            return null;
        }
        return {
            stop() { try { rec.stop(); } catch (e) { /* bỏ qua */ } },
            abort() { aborted = true; try { rec.abort(); } catch (e) { /* bỏ qua */ } }
        };
    }

    // ---------- Giao diện (phần tử đã có sẵn trong index.html) ----------
    function bindMicButton() {
        const btn = document.getElementById('voice-mic-btn');
        if (!btn || btn.dataset.voiceBound) return;
        btn.dataset.voiceBound = '1';
        btn.addEventListener('click', toggleListening);
        if (!SR) {
            btn.style.opacity = '0.45';
            btn.title = 'Trình duyệt chưa hỗ trợ nhận dạng giọng nói';
        }
    }

    function bindSpeakButton() {
        const btn = document.getElementById('voice-speak-btn');
        if (!btn || btn.dataset.voiceBound) return;
        btn.dataset.voiceBound = '1';
        btn.addEventListener('click', () => {
            if (speaking && currentSource === 'scan-screen') stopSpeaking();
            else speak(buildScanText(), 'scan-screen');
        });
    }

    function populateVoiceSelect() {
        const sel = document.getElementById('voice-device');
        if (!sel) return;
        const list = getViVoices();
        const html = ['<option value="">Tự chọn giọng tốt nhất</option>']
            .concat(list.map((v) => `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name.replace(/</g, '&lt;')}</option>`));
        const sig = html.join('');
        if (sel.dataset.sig !== sig) {
            sel.innerHTML = sig;
            sel.dataset.sig = sig;
        }
        sel.value = list.some((v) => v.name === settings.deviceVoice) ? settings.deviceVoice : '';
        sel.disabled = list.length === 0;
    }

    function refreshVoiceStatus() {
        const el = document.getElementById('voice-status');
        if (!el) return;
        const dev = getDeviceVoice();
        let msg;
        if (settings.engine === 'gemini') {
            msg = 'Đang dùng giọng AI Gemini (cần mạng).';
        } else if (dev) {
            msg = `Giọng thiết bị đang dùng: ${dev.name}.`;
        } else if (settings.engine === 'device') {
            msg = 'Thiết bị chưa có giọng tiếng Việt nên chưa đọc được. Hãy cài giọng hoặc chọn "Giọng AI Gemini".';
        } else {
            msg = 'Thiết bị chưa có giọng tiếng Việt, tự động dùng giọng AI Gemini.';
        }
        el.textContent = msg;
    }

    function bindSettings() {
        const auto = document.getElementById('voice-auto-toggle');
        const send = document.getElementById('voice-send-toggle');
        const rate = document.getElementById('voice-rate');
        const rateVal = document.getElementById('voice-rate-val');
        const engine = document.getElementById('voice-engine');
        const device = document.getElementById('voice-device');
        const gvoice = document.getElementById('voice-gemini-voice');
        const test = document.getElementById('voice-test-btn');
        if (!auto || !send || !rate || auto.dataset.voiceBound) return;
        auto.dataset.voiceBound = '1';

        auto.checked = settings.autoSpeak;
        send.checked = settings.autoSend;
        rate.value = settings.rate;
        if (rateVal) rateVal.textContent = (settings.rate || 1).toFixed(1) + 'x';
        if (engine) engine.value = settings.engine;
        if (gvoice) gvoice.value = settings.geminiVoice;
        populateVoiceSelect();
        refreshVoiceStatus();

        auto.addEventListener('change', () => {
            settings.autoSpeak = auto.checked;
            store.set(LS.auto, auto.checked ? '1' : '0');
            if (!auto.checked) stopSpeaking();
        });
        send.addEventListener('change', () => {
            settings.autoSend = send.checked;
            store.set(LS.send, send.checked ? '1' : '0');
        });
        rate.addEventListener('input', () => {
            settings.rate = parseFloat(rate.value) || 1;
            if (rateVal) rateVal.textContent = settings.rate.toFixed(1) + 'x';
            store.set(LS.rate, String(settings.rate));
        });
        engine?.addEventListener('change', () => {
            settings.engine = engine.value;
            store.set(LS.engine, settings.engine);
            refreshVoiceStatus();
        });
        device?.addEventListener('change', () => {
            settings.deviceVoice = device.value;
            store.set(LS.device, settings.deviceVoice);
            refreshVoiceStatus();
        });
        gvoice?.addEventListener('change', () => {
            settings.geminiVoice = gvoice.value;
            store.set(LS.gvoice, settings.geminiVoice);
        });
        test?.addEventListener('click', () => {
            if (speaking) { stopSpeaking(); return; }
            speak('Xin chào, mình là Greeny. Chai nhựa thuộc nhóm rác tái chế. Hãy rửa sạch rồi bỏ vào thùng nhé.', null);
        });
    }

    function refreshUI() {
        document.getElementById('voice-mic-btn')?.classList.toggle('listening', listening);
        document.getElementById('voice-speak-btn')?.classList.toggle('speaking', speaking && currentSource === 'scan-screen');
        const test = document.getElementById('voice-test-btn');
        if (test) test.textContent = speaking && currentSource === null ? 'Dừng' : 'Nghe thử';
    }

    // ---------- Gắn vào luồng sẵn có của app ----------
    function buildScanText() {
        const name = document.getElementById('item-name')?.textContent || '';
        const tag = document.getElementById('item-tag')?.textContent || '';
        const sug = document.getElementById('ai-suggestion')?.innerHTML || '';   // giữ HTML để cleanText ngắt ý
        return composeScan(name, tag, sug);
    }

    // gemini.js gọi trực tiếp hai hàm này (setupChat và updateResultUI).
    function speakReply(text) {
        const byVoice = voiceInitiated;      // câu hỏi vừa được nói bằng mic
        voiceInitiated = false;
        if (settings.autoSpeak || byVoice) speak(text, 'chat-screen');
    }

    function speakScanResult(result) {
        if (!settings.autoSpeak || !result) return;
        speak(composeScan(result.name, result.tag, result.suggestion), 'scan-screen');
    }

    function init() {
        bindMicButton();
        bindSpeakButton();
        bindSettings();

        if (synth) {
            loadVoices();
            synth.addEventListener?.('voiceschanged', loadVoices);
            let tries = 0;                                               // Safari/Android không phải lúc nào cũng bắn voiceschanged
            const poll = setInterval(() => {
                loadVoices();
                if (getViVoices().length || ++tries > 12) clearInterval(poll);
            }, 400);
        }

        window.addEventListener('pagehide', () => { stopSpeaking(); cancelListening(); });

        const events = ['pointerdown', 'keydown', 'touchend'];
        const unlockOnce = () => {
            unlockAudio();
            events.forEach((ev) => document.removeEventListener(ev, unlockOnce, true));
        };
        events.forEach((ev) => document.addEventListener(ev, unlockOnce, true));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // API công khai
    window.ecoVoice = {
        speak,
        speakReply,
        speakScanResult,
        stop: stopSpeaking,
        startListening,
        stopListening,
        cancelListening,
        toggleListening,
        listenOnce,
        settings,
        get isSpeaking() { return speaking; },
        get isSupported() { return { stt: !!SR, tts: !!synth, viVoice: !!getDeviceVoice() }; }
    };
})();

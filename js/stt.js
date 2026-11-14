/**
 * ViGreen - stt.js
 * GIỌNG NÓI -> CHỮ ở ô chat (SpeechRecognition). Đây là chức năng RIÊNG:
 *   - Chỉ chuyển lời nói thành chữ trong ô #chat-input (hiện chữ ngay khi đang nói).
 *   - Không đọc to câu trả lời. Việc đọc to do js/voice.js lo (nút "Đọc to" / "Tự động đọc").
 *   - Không liên quan Greeny Live: voice chat realtime nằm ở js/live.js và có bộ nhận giọng riêng.
 *
 * Tùy chọn "Nói xong tự gửi" (Cài đặt › Giọng nói) thuộc về chức năng này.
 * Yêu cầu trong index.html: #voice-mic-btn, #chat-input, #send-btn, #voice-send-toggle
 * và <script src="js/stt.js"> (sau state.js).
 * app.js gọi ecoSTT.cancel() khi chuyển màn hình.
 */
(() => {
    'use strict';

    const LS_SEND = 'eco_voice_autosend';

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ }; }
    };

    // Dùng chung đối tượng cài đặt với state.js (cùng khóa localStorage với trước đây).
    const settings = (window.ecoState && window.ecoState.voice) || { autoSend: store.get(LS_SEND) !== '0' };

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    let recognition = null;
    let listening = false;
    let abortRequested = false;    // true khi hủy nghe (chuyển màn hình) -> không tự gửi

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

    function refreshUI() {
        document.getElementById('voice-mic-btn')?.classList.toggle('listening', listening);
    }

    function start() {
        if (!SR) {
            toast('Trình duyệt chưa hỗ trợ nhận dạng giọng nói. Hãy dùng Chrome hoặc Edge.');
            return;
        }
        const input = document.getElementById('chat-input');
        if (!input) return;

        window.ecoVoice?.stop();          // đang đọc to thì dừng để mic không thu tiếng loa
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
                document.getElementById('send-btn')?.click();
            } else {
                input.focus();
            }
        };

        try {
            recognition.start();
        } catch (err) {
            console.warn('[STT] start lỗi:', err);
        }
    }

    function stop() {
        if (recognition) {
            try { recognition.stop(); } catch (e) { /* bỏ qua */ }
        }
    }

    // Hủy nghe: dừng ngay và KHÔNG gửi phần chữ đang nhận dạng dở.
    function cancel() {
        if (!recognition) return;
        abortRequested = true;
        try { recognition.abort(); } catch (e) { /* bỏ qua */ }
    }

    function toggle() {
        listening ? stop() : start();
    }

    function bindMicButton() {
        const btn = document.getElementById('voice-mic-btn');
        if (!btn || btn.dataset.sttBound) return;
        btn.dataset.sttBound = '1';
        btn.addEventListener('click', toggle);
        if (!SR) {
            btn.style.opacity = '0.45';
            btn.title = 'Trình duyệt chưa hỗ trợ nhận dạng giọng nói';
        }
    }

    function bindSendToggle() {
        const send = document.getElementById('voice-send-toggle');
        if (!send || send.dataset.sttBound) return;
        send.dataset.sttBound = '1';
        send.checked = !!settings.autoSend;
        send.addEventListener('change', () => {
            settings.autoSend = send.checked;
            store.set(LS_SEND, send.checked ? '1' : '0');
        });
    }

    function init() {
        bindMicButton();
        bindSendToggle();
        // Khi bắt đầu đọc to (voice.js) thì tự ngắt mic, không gửi chữ dở dang.
        document.addEventListener('eco:tts-start', cancel);
        window.addEventListener('pagehide', cancel);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.ecoSTT = {
        start,
        stop,
        cancel,
        toggle,
        get isListening() { return listening; },
        get isSupported() { return !!SR; }
    };
})();

// live.js — Greeny Live: nhận diện NHIỀU vật thể theo thời gian thực + trò chuyện bằng giọng nói rảnh tay.
//
//   camera -> YOLO (ONNX, chạy trên máy) -> theo dõi vật thể ổn định -> khung + nhãn + nhóm rác gợi ý
//   micro  -> nhận dạng tiếng Việt -> Gemini (kèm danh sách vật thể + khung hình hiện tại) -> đọc to câu trả lời
//
// VOICE CHAT REALTIME là chức năng RIÊNG, độc lập với "giọng nói -> chữ" ở ô chat (js/stt.js):
// module này tự có bộ nhận dạng giọng nói (listenOnce bên dưới); chỉ dùng ecoVoice để ĐỌC câu trả lời.
//
// Đây là chuỗi "gần realtime" (phát hiện ~3-8 khung/giây tùy máy; hội thoại theo lượt nói), không dùng Gemini Live WebSocket.
// Khung hình chỉ được gửi cho Gemini khi bạn hỏi (và có thể tắt bằng nút con mắt), không gửi liên tục.
(() => {
    'use strict';

    const TARGET_FRAME_MS = 120;        // nhịp vòng lặp phát hiện (nhanh hơn nếu máy kịp)
    const WORK_MAX = 640;               // cạnh dài tối đa của ảnh đưa vào YOLO / gửi Gemini
    const MAX_TRACKS = 12;
    // minHits/showConf: chỉ hiện vật đã thấy ổn định qua >=3 khung và đủ chắc chắn -> bớt nhận sai thoáng qua.
    // voteDecay: nhãn của mỗi vật được "bỏ phiếu" theo thời gian, nhãn mới phải vượt trội mới đổi (tránh nhảy chai <-> cốc).
    const TRACK = { minHits: 3, maxAgeMs: 900, alpha: 0.4, matchIou: 0.3, crossIou: 0.5, showConf: 0.5, voteDecay: 0.75, switchRatio: 1.3 };
    const MIN_DET_CONF = 0.45;          // bỏ phát hiện yếu ngay từ đầu
    const MIN_AREA = 0.012;             // bỏ khung quá nhỏ (nhiễu), tính theo tỉ lệ diện tích khung hình
    const MAX_AREA = 0.9;               // bỏ khung phủ gần hết khung hình (thường là nền)
    const ASK_DEADLINE_MS = 18000;      // chờ Gemini tối đa ~18 giây rồi trả lời dự phòng
    const MAX_SILENT_LISTENS = 4;       // im lặng 4 lượt liên tiếp thì tắt chế độ nghe để khỏi kêu bíp mãi

    // Các lớp COCO không phải rác/đồ dùng cần phân loại (đồ nội thất, biển báo...) -> bỏ để khỏi gán nhầm "nhóm rác".
    const LIVE_IGNORE = new Set([
        'bicycle', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'skis', 'snowboard',
        'kite', 'baseball bat', 'baseball glove', 'chair', 'couch', 'bed', 'dining table', 'toilet', 'sink',
        'refrigerator', 'microwave', 'oven'
    ]);

    function keepDetection(d) {
        if (!d || !d.bboxRel || LIVE_IGNORE.has(d.class)) return false;
        if (d.confidence < MIN_DET_CONF) return false;
        const area = d.bboxRel.width * d.bboxRel.height;
        return area >= MIN_AREA && area <= MAX_AREA;
    }

    // Tỉ lệ % hiển thị = điểm cố định theo nhóm rác, dùng CHUNG với chế độ chụp ảnh.
    const scoreOf = (group) => (window.ecoScore ? window.ecoScore.forGroup(group) : 50);

    // ---------- Nhóm rác gợi ý nhanh cho các lớp COCO (Gemini sẽ giải thích chi tiết khi được hỏi) ----------
    const GROUPS = {
        tai_che: { label: 'tái chế', color: '#27C860' },
        huu_co: { label: 'hữu cơ', color: '#F59E0B' },
        nguy_hiem: { label: 'nguy hại', color: '#EF4444' },
        vo_co: { label: 'vô cơ', color: '#94A3B8' }
    };

    const WASTE_MAP = {
        bottle: 'tai_che', 'wine glass': 'tai_che', cup: 'tai_che', book: 'tai_che',
        fork: 'tai_che', knife: 'tai_che', spoon: 'tai_che', scissors: 'tai_che',
        banana: 'huu_co', apple: 'huu_co', orange: 'huu_co', broccoli: 'huu_co', carrot: 'huu_co',
        sandwich: 'huu_co', 'hot dog': 'huu_co', pizza: 'huu_co', donut: 'huu_co', cake: 'huu_co', 'potted plant': 'huu_co',
        laptop: 'nguy_hiem', 'cell phone': 'nguy_hiem', keyboard: 'nguy_hiem', mouse: 'nguy_hiem',
        remote: 'nguy_hiem', tv: 'nguy_hiem', microwave: 'nguy_hiem', oven: 'nguy_hiem',
        toaster: 'nguy_hiem', 'hair drier': 'nguy_hiem', clock: 'nguy_hiem'
    };

    const groupOf = (cls) => WASTE_MAP[cls] || 'vo_co';

    const $ = (id) => document.getElementById(id);
    const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

    // ---------- Theo dõi vật thể (thuần túy, dễ kiểm thử) ----------
    let nextTrackId = 0;

    function iou(a, b) {
        const x1 = Math.max(a.x, b.x);
        const y1 = Math.max(a.y, b.y);
        const x2 = Math.min(a.x + a.width, b.x + b.width);
        const y2 = Math.min(a.y + a.height, b.y + b.height);
        const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const union = a.width * a.height + b.width * b.height - inter;
        return union > 0 ? inter / union : 0;
    }

    // Cập nhật phiếu bầu nhãn của một vật; chỉ đổi nhãn hiển thị khi nhãn mới vượt trội rõ rệt.
    function castVote(t, d, opts) {
        for (const k of Object.keys(t.votes)) t.votes[k].score *= opts.voteDecay;
        const v = t.votes[d.class] || (t.votes[d.class] = { score: 0, conf: d.confidence, classVi: d.classVi || d.class });
        v.score += d.confidence;
        v.conf = v.conf * (1 - opts.alpha) + d.confidence * opts.alpha;

        let leader = t.class;
        for (const k of Object.keys(t.votes)) if (t.votes[k].score > t.votes[leader].score) leader = k;
        if (leader !== t.class && t.votes[leader].score > t.votes[t.class].score * opts.switchRatio) {
            t.class = leader;
            t.classVi = t.votes[leader].classVi;
            t.group = groupOf(leader);
        }
        t.conf = t.votes[t.class].conf;
    }

    // Ghép phát hiện mới vào các track cũ (IoU cao) để khung không nhấp nháy và nhãn ổn định.
    function updateTracks(tracks, dets, now, opts = TRACK) {
        tracks.forEach((t) => { t._matched = false; });

        for (const d of dets) {
            let best = null;
            let bestIou = 0;
            for (const t of tracks) {
                if (t._matched) continue;
                const v = iou(t.box, d.bboxRel);
                const need = t.class === d.class ? opts.matchIou : (opts.crossIou ?? opts.matchIou);
                if (v >= need && v > bestIou) { bestIou = v; best = t; }
            }
            if (best) {
                const a = opts.alpha;
                best._matched = true;
                best.box = {
                    x: best.box.x * (1 - a) + d.bboxRel.x * a,
                    y: best.box.y * (1 - a) + d.bboxRel.y * a,
                    width: best.box.width * (1 - a) + d.bboxRel.width * a,
                    height: best.box.height * (1 - a) + d.bboxRel.height * a
                };
                best.hits++;
                best.lastSeen = now;
                castVote(best, d, opts);
            } else {
                tracks.push({
                    id: ++nextTrackId,
                    class: d.class,
                    classVi: d.classVi || d.class,
                    box: { ...d.bboxRel },
                    conf: d.confidence,
                    votes: { [d.class]: { score: d.confidence, conf: d.confidence, classVi: d.classVi || d.class } },
                    hits: 1,
                    lastSeen: now,
                    group: groupOf(d.class),
                    _matched: true
                });
            }
        }
        return tracks.filter((t) => now - t.lastSeen <= opts.maxAgeMs);
    }

    const visibleTracks = (tracks, opts = TRACK) =>
        tracks.filter((t) => t.hits >= opts.minHits && t.conf >= (opts.showConf || 0)).sort((a, b) => b.conf - a.conf).slice(0, MAX_TRACKS);

    function positionOf(box) {
        const cx = box.x + box.width / 2;
        return cx < 0.33 ? 'bên trái' : cx > 0.66 ? 'bên phải' : 'ở giữa';
    }

    // Tóm tắt cho Gemini: mỗi dòng một vật.
    function summarize(tracks) {
        const list = visibleTracks(tracks);
        if (!list.length) return 'Máy chưa phát hiện được vật thể nào (hãy dựa vào ảnh nếu có).';
        return list.map((t) =>
            `- ${t.classVi} (${positionOf(t.box)}, máy chắc chắn ${Math.round(t.conf * 100)}%) → gợi ý nhóm: rác ${GROUPS[t.group].label}`
        ).join('\n');
    }

    // Đổi khung tương đối (0..1 trên khung hình video) sang tọa độ hiển thị với object-fit: cover.
    function mapBox(box, vw, vh, cw, ch) {
        const scale = Math.max(cw / vw, ch / vh);
        const ox = (cw - vw * scale) / 2;
        const oy = (ch - vh * scale) / 2;
        return { x: ox + box.x * vw * scale, y: oy + box.y * vh * scale, w: box.width * vw * scale, h: box.height * vh * scale };
    }

    // ---------- Trạng thái ----------
    const S = {
        running: false,
        voice: false,                 // chế độ trò chuyện rảnh tay
        state: 'idle',                // idle | listening | thinking | speaking
        stream: null,
        facing: 'environment',
        tracks: [],
        history: [],                  // các lượt hội thoại (chỉ văn bản) gửi kèm cho Gemini
        sendFrame: true,
        speakReplies: true,
        detectorReady: false,
        loopTimer: null,
        rec: null,
        askId: 0,
        work: null,
        selectedClass: null,          // lớp vật thể đang được chọn xem chi tiết
        chipSig: '',                  // chữ ký danh sách nhãn (chỉ dựng lại khi thay đổi, để chạm không bị mất)
        fails: 0,                     // số lần liên tiếp Gemini không trả lời được
        silent: 0,                    // số lượt nghe liên tiếp không có tiếng nói
        heard: false,                 // đã nhận được ít nhất một câu nói (để phân biệt "mất quyền micro" với "iOS đòi chạm lại")
        speakTimer: null              // chốt chặn khi giọng đọc không báo "xong" (hay gặp trên điện thoại)
    };

    // ---------- Giao diện ----------
    const STATE_LABEL = {
        idle: 'Trò chuyện',
        listening: 'Đang nghe…',
        thinking: 'Đang nghĩ…',
        speaking: 'Chạm để ngắt'
    };

    function setStatus(msg) {
        const el = $('live-status');
        if (el) el.textContent = msg;
    }

    function setState(st) {
        S.state = st;
        const mic = $('live-mic-btn');
        if (mic) {
            mic.dataset.state = st;
            mic.classList.toggle('active', S.voice);
        }
        const label = $('live-mic-label');
        if (label) label.textContent = S.voice || st !== 'idle' ? STATE_LABEL[st] || STATE_LABEL.idle : STATE_LABEL.idle;
    }

    function setUser(text, interim) {
        const el = $('live-user');
        if (!el) return;
        el.textContent = text ? `Bạn: ${text}` : '';
        el.classList.toggle('interim', !!interim);
    }

    function setBot(text) {
        const el = $('live-bot');
        if (el) el.textContent = text;
    }

    const GROUP_TIP = {
        tai_che: 'Thường là rác tái chế: làm sạch, làm khô rồi bỏ vào thùng rác tái chế.',
        huu_co: 'Thường là rác hữu cơ: bỏ vào thùng rác hữu cơ hoặc ủ phân compost.',
        nguy_hiem: 'Có thể là rác nguy hại/điện tử: không vứt chung rác thường, hãy mang đến điểm thu gom riêng.',
        vo_co: 'Thường là rác vô cơ (rác còn lại): bỏ đúng thùng, không xả ra môi trường.'
    };

    function renderDetail() {
        const box = $('live-detail');
        if (!box) return;
        const list = visibleTracks(S.tracks).filter((t) => t.class === S.selectedClass);
        if (!S.selectedClass || !list.length) {
            S.selectedClass = null;
            box.classList.add('hidden');
            return;
        }
        const t = list[0];
        const conf = scoreOf(t.group);
        const g = GROUPS[t.group];
        $('live-detail-name').textContent = list.length > 1 ? `${t.classVi} ×${list.length}` : t.classVi;
        const gl = $('live-detail-group');
        gl.textContent = `rác ${g.label} · ${conf}%`;
        gl.style.setProperty('--c', g.color);
        $('live-detail-tip').textContent = GROUP_TIP[t.group];
        box.classList.remove('hidden');
    }

    function selectClass(cls) {
        S.selectedClass = S.selectedClass === cls ? null : cls;
        S.chipSig = '';
        renderChips();
        render();
    }

    function renderChips() {
        const box = $('live-chips');
        if (!box) return;
        const list = visibleTracks(S.tracks);
        const counts = new Map();
        list.forEach((t) => {
            const c = counts.get(t.class) || { t, n: 0 };
            c.n++;
            counts.set(t.class, c);
        });
        if (S.selectedClass && !counts.has(S.selectedClass)) S.selectedClass = null;

        const sig = [...counts.entries()].map(([k, v]) => `${k}:${v.n}`).join('|') + `#${S.selectedClass || ''}#${S.detectorReady ? 1 : 0}`;
        if (sig !== S.chipSig) {
            S.chipSig = sig;
            box.textContent = '';
            counts.forEach(({ t, n }, cls) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'live-chip' + (S.selectedClass === cls ? ' active' : '');
                chip.style.setProperty('--c', GROUPS[t.group].color);
                chip.textContent = `${t.classVi}${n > 1 ? ' ×' + n : ''} · ${GROUPS[t.group].label}`;
                chip.addEventListener('click', () => selectClass(cls));
                box.appendChild(chip);
            });
            if (!counts.size && S.detectorReady) {
                const hint = document.createElement('span');
                hint.className = 'live-chip empty';
                hint.textContent = 'Hướng camera vào vật cần xem';
                box.appendChild(hint);
            }
        }
        renderDetail();
    }

    function render() {
        const video = $('live-video');
        const canvas = $('live-overlay');
        if (!video || !canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
            canvas.width = Math.round(cw * dpr);
            canvas.height = Math.round(ch * dpr);
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        visibleTracks(S.tracks).forEach((t) => {
            const b = mapBox(t.box, vw, vh, cw, ch);
            const color = GROUPS[t.group].color;
            const dim = S.selectedClass && t.class !== S.selectedClass;
            const hot = S.selectedClass && t.class === S.selectedClass;
            ctx.globalAlpha = dim ? 0.35 : 1;

            ctx.lineWidth = hot ? 5 : 3;
            ctx.strokeStyle = color;
            ctx.fillStyle = color + '22';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, 10);
            else ctx.rect(b.x, b.y, b.w, b.h);
            ctx.fill();
            ctx.stroke();

            const label = `${t.classVi} ${scoreOf(t.group)}%`;
            ctx.font = '700 13px Inter, sans-serif';
            const tw = ctx.measureText(label).width;
            const ly = Math.max(0, b.y - 24);
            ctx.fillStyle = color;
            ctx.fillRect(b.x, ly, tw + 14, 22);
            ctx.fillStyle = '#fff';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, b.x + 7, ly + 11);
            ctx.globalAlpha = 1;
        });
    }

    // ---------- Khung hình ----------
    function drawToWork(video) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.min(1, WORK_MAX / Math.max(vw, vh));
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));
        if (!S.work) S.work = document.createElement('canvas');
        if (S.work.width !== w) S.work.width = w;
        if (S.work.height !== h) S.work.height = h;
        S.work.getContext('2d').drawImage(video, 0, 0, w, h);
        return S.work;
    }

    function grabFrameBase64() {
        const video = $('live-video');
        if (!video || !video.videoWidth) return null;
        try {
            const url = drawToWork(video).toDataURL('image/jpeg', 0.6);
            return url.split(',')[1] || null;
        } catch (e) {
            return null;
        }
    }

    // ---------- Vòng lặp phát hiện ----------
    async function loop() {
        if (!S.running) return;
        const t0 = performance.now();
        try {
            const video = $('live-video');
            if (video && video.videoWidth > 0 && video.readyState >= 2) {
                if (S.detectorReady && window.yoloDetector) {
                    const dets = await window.yoloDetector.detectFrame(drawToWork(video));
                    if (dets && S.running) S.tracks = updateTracks(S.tracks, dets.filter(keepDetection).slice(0, 12), Date.now());
                }
                render();
                renderChips();
            }
        } catch (e) {
            console.warn('[Live] lỗi vòng lặp:', e);
        }
        if (!S.running) return;
        const dt = performance.now() - t0;
        S.loopTimer = setTimeout(loop, Math.max(30, TARGET_FRAME_MS - dt));
    }

    async function openCamera() {
        const placeholder = $('live-placeholder');
        if (!navigator.mediaDevices?.getUserMedia) {
            if (placeholder) { placeholder.textContent = 'Trình duyệt không hỗ trợ camera (cần HTTPS).'; placeholder.style.display = 'flex'; }
            return false;
        }
        try {
            S.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            if (!S.running) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; return false; }
            const video = $('live-video');
            video.srcObject = S.stream;
            if (video.play) video.play().catch(() => {});
            if (placeholder) placeholder.style.display = 'none';
            return true;
        } catch (e) {
            console.error('[Live] camera:', e);
            if (placeholder) { placeholder.textContent = 'Không thể truy cập camera. Hãy cấp quyền rồi thử lại.'; placeholder.style.display = 'flex'; }
            return false;
        }
    }

    async function start() {
        if (S.running) return;
        S.running = true;
        S.tracks = [];
        setUser('');
        setState('idle');
        setStatus('Đang khởi động camera…');

        const ok = await openCamera();
        if (!ok) { setStatus('Chưa có camera'); }

        // nạp mô hình nhận diện (nếu lỗi vẫn trò chuyện được, Greeny nhìn khung hình)
        const yolo = window.yoloDetector;
        if (yolo) {
            setStatus('Đang tải mô hình nhận diện…');
            let ready = yolo.isReady;
            if (!ready) { try { ready = await yolo.init(); } catch (e) { ready = false; } }
            S.detectorReady = !!ready && typeof yolo.detectFrame === 'function';
            setStatus(S.detectorReady ? 'Đang nhận diện trực tiếp' : 'Không tải được mô hình — Greeny vẫn có thể nhìn khung hình');
        } else {
            setStatus('Chưa có mô hình nhận diện — Greeny vẫn có thể nhìn khung hình');
        }

        if (S.running) loop();
    }

    function stop() {
        S.running = false;
        S.voice = false;
        S.askId++;
        clearTimeout(S.loopTimer);
        clearTimeout(S.speakTimer);
        S.fails = 0; S.silent = 0; S.heard = false;
        if (S.rec) { try { S.rec.abort(); } catch (e) { /* bỏ qua */ } S.rec = null; }
        window.ecoVoice?.stop();
        if (S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
        const video = $('live-video');
        if (video) video.srcObject = null;
        S.tracks = [];
        setState('idle');
        const canvas = $('live-overlay');
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        const box = $('live-chips');
        if (box) box.textContent = '';
        S.selectedClass = null;
        S.chipSig = '';
        $('live-detail')?.classList.add('hidden');
    }

    async function flip() {
        if (!S.running) return;
        if (S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
        S.facing = S.facing === 'environment' ? 'user' : 'environment';
        S.tracks = [];
        await openCamera();
    }

    // ---------- Hội thoại với Greeny ----------
    function buildSystem() {
        return 'Bạn là Greeny — trợ lý môi trường của ứng dụng ViGreen — đang trò chuyện bằng GIỌNG NÓI với người dùng qua camera trực tiếp. ' +
            'Trả lời bằng tiếng Việt, tự nhiên như đang nói chuyện, tối đa 3 câu ngắn, KHÔNG dùng markdown, emoji hay gạch đầu dòng. ' +
            'Khi được hỏi về vật trong camera, dựa vào danh sách vật thể máy phát hiện bên dưới (có thể sai — hãy đối chiếu với ảnh nếu có) ' +
            'và hướng dẫn cách phân loại / xử lý (rác tái chế, hữu cơ, nguy hại, vô cơ). Nếu câu hỏi không liên quan, trả lời ngắn rồi nhẹ nhàng gợi ý quay lại chủ đề môi trường.\n\n' +
            'Vật thể đang thấy:\n' + summarize(S.tracks);
    }

    // Trả lời dự phòng bằng dữ liệu nhận diện trên máy khi Gemini không phản hồi (mạng yếu, quá tải...).
    function localAnswer() {
        const list = visibleTracks(S.tracks);
        if (!list.length) return 'Mình chưa nhìn thấy vật nào rõ ràng. Bạn đưa camera lại gần vật cần xem nhé.';
        const names = [...new Set(list.map((t) => t.classVi))].slice(0, 4).join(', ');
        const first = list[0];
        return `Mình đang thấy ${names}. ${first.classVi}: ${GROUP_TIP[first.group]}`;
    }

    // Hiện chữ + đọc to câu trả lời, rồi chuyển sang lượt kế tiếp.
    function deliver(my, reply, ok) {
        setBot(clip(reply.replace(/[*_`#>]+/g, ' '), 600));
        clearTimeout(S.speakTimer);
        if (S.speakReplies && window.ecoVoice) {
            setState('speaking');
            // Điện thoại đôi khi không bắn sự kiện "đọc xong" -> tự chuyển lượt sau thời gian hợp lý.
            const ms = Math.min(60000, 8000 + reply.length * 130);
            S.speakTimer = setTimeout(() => {
                if (my !== S.askId || !S.running || S.state !== 'speaking') return;
                window.ecoVoice?.stop();
                afterReply(my, ok);
            }, ms);
            window.ecoVoice.speak(reply, 'live-screen', {
                onDone: () => { clearTimeout(S.speakTimer); afterReply(my, ok); }
            });
        } else {
            afterReply(my, ok);
        }
    }

    async function ask(rawText) {
        const text = clip(rawText, 300);
        if (!text || !S.running) return;
        const ai = window.ecoAI;
        const my = ++S.askId;
        clearTimeout(S.speakTimer);
        S.silent = 0;

        setUser(text);
        setState('thinking');

        if (!ai) { setBot('Chưa nạp được module AI.'); return afterReply(my, false); }

        const parts = [{ text }];
        if (S.sendFrame) {
            const img = grabFrameBase64();
            if (img) parts.push({ inlineData: { mimeType: 'image/jpeg', data: img } });
        }

        try {
            // Có hạn chót cứng: dù mạng điện thoại chậm, vài chục giây sau vẫn có câu trả lời (không treo ở "Đang nghĩ…").
            const reply = await Promise.race([
                ai.chat({
                    system: buildSystem(),
                    contents: [...S.history.slice(-6), { role: 'user', parts }],
                    temperature: 0.6,
                    deadlineMs: ASK_DEADLINE_MS
                }),
                new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ASK_DEADLINE_MS + 4000))
            ]);
            if (my !== S.askId || !S.running) return;               // đã bị ngắt hoặc thoát màn hình

            S.fails = 0;
            S.history.push({ role: 'user', parts: [{ text }] }, { role: 'model', parts: [{ text: reply }] });
            S.history = S.history.slice(-12);
            deliver(my, reply, true);
        } catch (e) {
            if (my !== S.askId || !S.running) return;
            console.warn('[Live] Gemini lỗi:', e);

            if (e.code === 'nokey' || e.code === 'badkey') {         // lỗi cấu hình: không thể tự khỏi -> dừng hẳn
                setBot(e.code === 'nokey' ? 'Chưa có API Key Gemini để trò chuyện.' : 'API Key Gemini không hợp lệ.');
                S.voice = false;
                setState('idle');
                return;
            }

            // Lỗi tạm thời (quá tải, mạng chậm...): vẫn trả lời bằng dữ liệu trên máy để người dùng không bị im lặng.
            S.fails++;
            const why = e.code === 'quota' ? 'Greeny đang hết hạn mức AI nên mình trả lời nhanh bằng dữ liệu trên máy. '
                : 'Greeny đang bận nên mình trả lời nhanh bằng dữ liệu trên máy. ';
            if (S.fails >= 3) S.voice = false;                       // lỗi liên tục thì thôi chế độ rảnh tay để không lặp vô hạn
            deliver(my, why + localAnswer(), S.fails < 3);
        }
    }

    // Sau khi Greeny trả lời xong: rảnh tay thì nghe tiếp, không thì về trạng thái chờ.
    function afterReply(id, ok) {
        if (id !== S.askId || !S.running) return;
        clearTimeout(S.speakTimer);
        if (S.voice && ok) setTimeout(() => { if (id === S.askId && S.voice && S.running && S.state !== 'listening') beginListening(); }, 350);
        else setState('idle');
    }

    // Nghe MỘT câu bằng SpeechRecognition riêng của Greeny Live (không dùng chung với ô chat).
    // Trả về { stop(), abort() } hoặc null nếu không bắt đầu được.
    function listenOnce({ onInterim, onFinal, onEnd, onError } = {}) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
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

    function beginListening() {
        if (!S.voice || !S.running) return;

        setState('listening');
        setUser('');
        S.rec = listenOnce({
            onInterim: (t) => setUser(t, true),
            onFinal: (t) => { S.heard = true; S.silent = 0; ask(t); },
            onError: (e) => {
                if (e.error === 'unsupported') {
                    S.voice = false;
                    setBot('Trình duyệt chưa hỗ trợ nhận dạng giọng nói. Hãy dùng Chrome/Edge hoặc gõ câu hỏi bên dưới.');
                } else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    S.voice = false;
                    // Safari trên iPhone chỉ cho bật mic khi người dùng chạm -> sau câu trả lời cần chạm micro lại.
                    setBot(S.heard ? 'Chạm vào micro để nói tiếp nhé.' : 'Chưa cấp quyền micro cho trang này (hoặc trình duyệt không cho nhận giọng nói). Bạn có thể gõ câu hỏi bên dưới.');
                } else if (e.error === 'audio-capture') {
                    S.voice = false;
                    setBot('Không mở được micro. Hãy kiểm tra quyền micro rồi thử lại, hoặc gõ câu hỏi bên dưới.');
                } else if (e.error === 'network') {
                    S.voice = false;
                    setBot('Lỗi mạng khi nhận dạng giọng nói. Bạn thử lại hoặc gõ câu hỏi bên dưới nhé.');
                }
            },
            onEnd: () => {
                S.rec = null;
                if (S.voice && S.running && S.state === 'listening') {
                    // im lặng / chưa nói gì -> nghe tiếp, nhưng quá nhiều lượt im lặng thì tạm dừng (đỡ bíp liên tục trên Android)
                    if (++S.silent >= MAX_SILENT_LISTENS) {
                        S.voice = false;
                        S.silent = 0;
                        setBot('Mình chưa nghe thấy gì nên tạm dừng nghe. Chạm vào micro để nói tiếp nhé.');
                        setState('idle');
                        return;
                    }
                    setTimeout(beginListening, 400);
                } else if (!S.voice && S.state === 'listening') setState('idle');
            }
        });
        if (!S.rec && S.state === 'listening') { S.voice = false; setState('idle'); }
    }

    function stopVoiceMode() {
        S.voice = false;
        S.askId++;
        clearTimeout(S.speakTimer);
        if (S.rec) { try { S.rec.abort(); } catch (e) { /* bỏ qua */ } S.rec = null; }
        window.ecoVoice?.stop();
        setState('idle');
    }

    function onMic() {
        if (!S.running) return;
        if (!S.voice) {
            S.voice = true;
            S.silent = 0;
            S.fails = 0;
            window.ecoVoice?.stop();
            beginListening();
            return;
        }
        if (S.state === 'speaking') {                               // ngắt lời Greeny, chuyển sang nghe
            S.askId++;
            clearTimeout(S.speakTimer);
            window.ecoVoice?.stop();
            beginListening();
            return;
        }
        stopVoiceMode();                                            // đang nghe / nghĩ -> thoát chế độ rảnh tay
    }

    // ---------- Khởi tạo ----------
    function init() {
        if (!$('live-screen') || $('live-screen').dataset.bound) return;
        $('live-screen').dataset.bound = '1';

        $('open-live-btn')?.addEventListener('click', () => window.navigateTo?.('live-screen'));
        $('close-live-btn')?.addEventListener('click', () => window.navigateTo?.('scan-screen'));
        $('live-flip-btn')?.addEventListener('click', flip);
        $('live-detail-close')?.addEventListener('click', () => { S.selectedClass = null; S.chipSig = ''; renderChips(); render(); });
        $('live-detail-ask')?.addEventListener('click', () => {
            const t = visibleTracks(S.tracks).find((x) => x.class === S.selectedClass);
            if (!t) return;
            window.ecoVoice?.stop();
            if (S.rec) { try { S.rec.abort(); } catch (err) { /* bỏ qua */ } S.rec = null; }
            ask(`Cho mình biết ${t.classVi} này là loại rác nào và nên xử lý thế nào?`);
        });
        $('live-mic-btn')?.addEventListener('click', onMic);

        $('live-frame-toggle')?.addEventListener('click', (e) => {
            S.sendFrame = !S.sendFrame;
            e.currentTarget.classList.toggle('off', !S.sendFrame);
            e.currentTarget.title = S.sendFrame ? 'Greeny đang xem khung hình khi bạn hỏi (chạm để tắt)' : 'Greeny không xem khung hình (chạm để bật)';
        });

        $('live-speak-toggle')?.addEventListener('click', (e) => {
            S.speakReplies = !S.speakReplies;
            e.currentTarget.classList.toggle('off', !S.speakReplies);
            if (!S.speakReplies) window.ecoVoice?.stop();
        });

        $('live-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = $('live-input');
            const text = input?.value.trim();
            if (!text) return;
            input.value = '';
            window.ecoVoice?.stop();
            if (S.rec) { try { S.rec.abort(); } catch (err) { /* bỏ qua */ } S.rec = null; }
            ask(text);
        });

        setState('idle');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.ecoLive = {
        start, stop, ask, flip,
        // phục vụ kiểm thử
        updateTracks, visibleTracks, summarize, mapBox, groupOf, iou, positionOf, renderChips, selectClass,
        _state: S
    };
})();

// learn.js — Học & Chơi: Quiz và mini game giáo dục môi trường, nội dung do AI tạo mới mỗi lần.
//
//  - Quiz AI .............. 5 câu trắc nghiệm, đạt >= 70% thì nhận EXP
//  - Phân loại nhanh ...... đưa vật vào đúng 1 trong 4 thùng rác, có đồng hồ đếm ngược
//  - Ghép cặp xanh ........ ghép vật/khái niệm với nhóm/cách xử lý/tác động tương ứng
//
// EXP cộng qua ecoState.addLearnExp (có hạn mức mỗi ngày). Nếu AI chưa dùng được (không có key, hết hạn mức,
// mất mạng) thì dùng bộ câu hỏi có sẵn để tính năng vẫn chạy.
(() => {
    'use strict';

    const CONFIG = {
        quizCount: 5,
        sortCount: 10,
        matchPairs: 6,
        passRate: 0.7,
        sortSeconds: 10,
        revealMs: 1100
    };

    const TOPICS = [
        'Phân loại rác tại nguồn',
        'Tái chế & tái sử dụng',
        'Rác nhựa & đại dương',
        'Tiết kiệm năng lượng',
        'Biến đổi khí hậu',
        'Sống xanh hằng ngày'
    ];

    const LEVELS = [
        { id: 'easy', label: 'Dễ', desc: 'dễ, kiến thức cơ bản cho học sinh phổ thông' },
        { id: 'medium', label: 'Vừa', desc: 'trung bình, cần hiểu biết thực tế' },
        { id: 'hard', label: 'Khó', desc: 'khó, cần suy luận hoặc số liệu cụ thể' }
    ];

    // 4 thùng rác của app (khớp với nhãn trong gemini.js)
    const BINS = {
        tai_che: { label: 'Tái chế', icon: 'fa-recycle', color: '#27C860' },
        huu_co: { label: 'Hữu cơ', icon: 'fa-leaf', color: '#F59E0B' },
        nguy_hiem: { label: 'Nguy hại', icon: 'fa-skull-crossbones', color: '#EF4444' },
        vo_co: { label: 'Vô cơ', icon: 'fa-trash', color: '#64748B' }
    };

    // ---------- Bộ nội dung có sẵn (dự phòng khi AI chưa dùng được) ----------
    const FALLBACK = {
        quiz: [
            { question: 'Pin cũ thuộc nhóm rác nào?', options: ['Rác nguy hại', 'Rác hữu cơ', 'Rác tái chế thông thường', 'Rác vô cơ'], correctIndex: 0, explanation: 'Pin chứa kim loại nặng và hóa chất có thể rò rỉ gây ô nhiễm đất, nước nên cần thu gom riêng.' },
            { question: 'Vỏ chuối nên được xử lý thế nào để thân thiện với môi trường?', options: ['Ủ làm phân compost', 'Đốt ngoài trời', 'Vứt xuống cống', 'Trộn với pin cũ'], correctIndex: 0, explanation: 'Rác hữu cơ như vỏ chuối có thể ủ thành phân bón, giúp giảm lượng rác chôn lấp.' },
            { question: 'Trước khi bỏ chai nhựa vào thùng tái chế, bạn nên làm gì?', options: ['Rửa sạch và ép dẹp', 'Đổ thêm nước vào', 'Đập vỡ thành mảnh nhỏ', 'Đốt bỏ nắp'], correctIndex: 0, explanation: 'Chai sạch, khô và ép dẹp giúp tái chế hiệu quả hơn và tiết kiệm chỗ chứa.' },
            { question: 'Túi ni-lông cần khoảng bao lâu để phân hủy hoàn toàn ngoài môi trường?', options: ['Vài ngày', 'Khoảng 1 tháng', 'Hàng trăm năm', 'Đúng 1 năm'], correctIndex: 2, explanation: 'Nhựa ni-lông rất bền, có thể tồn tại hàng trăm năm nên cần hạn chế dùng một lần.' },
            { question: 'Trong quy tắc 3R, việc nên ưu tiên đầu tiên là gì?', options: ['Giảm thiểu (Reduce)', 'Tái chế (Recycle)', 'Chôn lấp', 'Đốt rác'], correctIndex: 0, explanation: 'Giảm thiểu rác ngay từ đầu là cách hiệu quả nhất, sau đó mới đến tái sử dụng và tái chế.' },
            { question: 'Khí nào là nguyên nhân chính khiến Trái Đất nóng lên do hoạt động của con người?', options: ['Khí CO₂', 'Khí oxy', 'Khí nitơ', 'Hơi nước ở ao hồ'], correctIndex: 0, explanation: 'CO₂ từ đốt nhiên liệu hóa thạch là khí nhà kính chủ yếu làm tăng nhiệt độ toàn cầu.' },
            { question: 'Điện thoại và sạc hỏng nên được xử lý thế nào?', options: ['Đưa đến điểm thu gom rác điện tử', 'Vứt chung rác sinh hoạt', 'Chôn dưới đất', 'Đốt trong sân'], correctIndex: 0, explanation: 'Rác điện tử chứa kim loại quý và chất độc hại, cần thu gom chuyên dụng để tái chế an toàn.' },
            { question: 'Ngày Trái Đất được tổ chức hằng năm vào ngày nào?', options: ['22/4', '5/6', '1/1', '10/10'], correctIndex: 0, explanation: 'Ngày Trái Đất là 22/4 hằng năm, nhằm nâng cao ý thức bảo vệ môi trường.' },
            { question: 'Loại giấy nào dễ tái chế nhất?', options: ['Giấy báo và bìa carton sạch, khô', 'Giấy dính nhiều dầu mỡ', 'Giấy ướt, bẩn', 'Giấy dán keo dày'], correctIndex: 0, explanation: 'Giấy sạch và khô giữ được chất lượng sợi nên tái chế tốt hơn giấy bẩn hoặc dính dầu mỡ.' },
            { question: 'Thủy tinh có thể tái chế bao nhiêu lần mà chất lượng gần như không giảm?', options: ['Gần như vô hạn', 'Chỉ 1 lần', 'Đúng 2 lần', 'Không thể tái chế'], correctIndex: 0, explanation: 'Thủy tinh có thể nấu chảy và tạo hình lại nhiều lần mà gần như không mất chất lượng.' },
            { question: 'Bã cà phê sau khi pha có thể dùng làm gì?', options: ['Làm phân bón hoặc khử mùi', 'Đổ xuống sông', 'Trộn với pin cũ', 'Đốt lấy khói'], correctIndex: 0, explanation: 'Bã cà phê là rác hữu cơ, có thể trộn vào đất trồng hoặc để khử mùi tủ lạnh.' },
            { question: 'Hành động nào giúp tiết kiệm điện hiệu quả nhất trong gia đình?', options: ['Tắt thiết bị khi không dùng', 'Bật quạt cả ngày', 'Mở tủ lạnh liên tục', 'Để đèn sáng khi ra khỏi phòng'], correctIndex: 0, explanation: 'Tắt đèn và rút phích cắm thiết bị không dùng giúp giảm điện năng tiêu thụ chờ.' }
        ],
        sort: [
            { name: 'Chai nước nhựa', emoji: '🧴', bin: 'tai_che', hint: 'Rửa sạch, ép dẹp rồi cho vào thùng tái chế.' },
            { name: 'Vỏ chuối', emoji: '🍌', bin: 'huu_co', hint: 'Rác thực phẩm có thể ủ làm phân.' },
            { name: 'Pin cũ', emoji: '🔋', bin: 'nguy_hiem', hint: 'Chứa kim loại nặng, cần thu gom riêng.' },
            { name: 'Lon nước ngọt', emoji: '🥫', bin: 'tai_che', hint: 'Kim loại nhôm tái chế được nhiều lần.' },
            { name: 'Vỏ trứng', emoji: '🥚', bin: 'huu_co', hint: 'Vỏ trứng phân hủy tự nhiên, tốt cho đất.' },
            { name: 'Bóng đèn huỳnh quang', emoji: '💡', bin: 'nguy_hiem', hint: 'Chứa hơi thủy ngân, không được đập vỡ.' },
            { name: 'Hộp bìa carton', emoji: '📦', bin: 'tai_che', hint: 'Gấp gọn, giữ khô để tái chế.' },
            { name: 'Rau củ thừa', emoji: '🥬', bin: 'huu_co', hint: 'Rác hữu cơ, ủ phân hoặc làm thức ăn chăn nuôi.' },
            { name: 'Mảnh bát sứ vỡ', emoji: '🍽️', bin: 'vo_co', hint: 'Gốm sứ không tái chế như thủy tinh, bỏ vào rác còn lại.' },
            { name: 'Thuốc quá hạn', emoji: '💊', bin: 'nguy_hiem', hint: 'Cần đưa đến điểm thu gom thuốc, không vứt bừa bãi.' },
            { name: 'Báo cũ', emoji: '📰', bin: 'tai_che', hint: 'Giấy sạch, khô rất dễ tái chế.' },
            { name: 'Bã cà phê', emoji: '☕', bin: 'huu_co', hint: 'Dùng làm phân bón hoặc khử mùi.' },
            { name: 'Túi ni-lông bẩn', emoji: '🛍️', bin: 'vo_co', hint: 'Dính bẩn, khó tái chế nên bỏ vào rác còn lại.' },
            { name: 'Chai thủy tinh', emoji: '🍾', bin: 'tai_che', hint: 'Thủy tinh tái chế gần như vô hạn.' },
            { name: 'Bình xịt côn trùng', emoji: '🧪', bin: 'nguy_hiem', hint: 'Chứa hóa chất độc hại, cần xử lý riêng.' },
            { name: 'Xương cá', emoji: '🐟', bin: 'huu_co', hint: 'Là rác hữu cơ từ thực phẩm.' }
        ],
        match: [
            { left: 'Pin cũ', right: 'Rác nguy hại' },
            { left: 'Vỏ trái cây', right: 'Ủ phân compost' },
            { left: 'Chai nhựa sạch', right: 'Thùng tái chế' },
            { left: 'Rác điện tử', right: 'Điểm thu gom chuyên dụng' },
            { left: 'Khí CO₂', right: 'Gây hiệu ứng nhà kính' },
            { left: 'Túi vải', right: 'Thay túi ni-lông' },
            { left: 'Tắt đèn khi ra khỏi phòng', right: 'Tiết kiệm điện' },
            { left: 'Rác thải nhựa', right: 'Ô nhiễm đại dương' },
            { left: 'Cây xanh', right: 'Hấp thụ khí CO₂' },
            { left: 'Chai thủy tinh', right: 'Tái chế nhiều lần' }
        ]
    };

    // ---------- Tiện ích ----------
    const $ = (id) => document.getElementById(id);

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

    const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function sample(arr, n) {
        return shuffle(arr).slice(0, n);
    }

    const store = {
        get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } }
    };

    // Nhớ các câu/vật đã gặp để lần sau yêu cầu AI tạo nội dung KHÁC
    function seenList(kind) {
        const list = store.get('eco_learn_seen_' + kind);
        return Array.isArray(list) ? list : [];
    }

    function rememberSeen(kind, items) {
        const list = seenList(kind).concat(items.map((s) => clip(s, 80)));
        store.set('eco_learn_seen_' + kind, list.slice(-40));
    }

    // ---------- Chuẩn hóa / kiểm tra dữ liệu AI trả về (không tin tưởng đầu vào) ----------
    function normalizeQuiz(raw, wanted = CONFIG.quizCount) {
        const list = Array.isArray(raw?.questions) ? raw.questions : [];
        const out = [];
        for (const q of list) {
            const question = clip(q?.question, 220);
            const options = Array.isArray(q?.options) ? q.options.map((o) => clip(o, 90)).filter(Boolean) : [];
            const idx = Number(q?.correctIndex);
            if (!question || options.length !== 4 || new Set(options).size !== 4) continue;
            if (!Number.isInteger(idx) || idx < 0 || idx > 3) continue;
            // xáo trộn đáp án để vị trí đúng không lệ thuộc AI
            const tagged = options.map((text, i) => ({ text, ok: i === idx }));
            const mixed = shuffle(tagged);
            out.push({
                question,
                options: mixed.map((o) => o.text),
                correctIndex: mixed.findIndex((o) => o.ok),
                explanation: clip(q?.explanation, 260)
            });
            if (out.length >= wanted) break;
        }
        if (out.length < 3) throw new Error('AI tạo quiz chưa hợp lệ.');
        return { title: clip(raw?.title, 60) || 'Quiz môi trường', questions: out };
    }

    function normalizeSort(raw, wanted = CONFIG.sortCount) {
        const list = Array.isArray(raw?.items) ? raw.items : [];
        const seen = new Set();
        const out = [];
        for (const it of list) {
            const name = clip(it?.name, 40);
            const bin = String(it?.bin || '').trim();
            if (!name || !BINS[bin] || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            const emoji = clip(it?.emoji, 8) || '♻️';
            out.push({ name, emoji, bin, hint: clip(it?.hint, 160) });
        }
        const bins = new Set(out.map((i) => i.bin));
        if (out.length < 6 || bins.size < 3) throw new Error('AI tạo trò chơi phân loại chưa hợp lệ.');
        return { title: clip(raw?.title, 60) || 'Phân loại nhanh', items: shuffle(out).slice(0, wanted) };
    }

    function normalizeMatch(raw, wanted = CONFIG.matchPairs) {
        const list = Array.isArray(raw?.pairs) ? raw.pairs : [];
        const lefts = new Set();
        const rights = new Set();
        const out = [];
        for (const p of list) {
            const left = clip(p?.left, 40);
            const right = clip(p?.right, 48);
            if (!left || !right || lefts.has(left.toLowerCase()) || rights.has(right.toLowerCase())) continue;
            lefts.add(left.toLowerCase());
            rights.add(right.toLowerCase());
            out.push({ left, right });
            if (out.length >= wanted) break;
        }
        if (out.length < 4) throw new Error('AI tạo trò chơi ghép cặp chưa hợp lệ.');
        return { title: clip(raw?.title, 60) || 'Ghép cặp xanh', pairs: out };
    }

    // ---------- Tính EXP (thuần túy, dễ kiểm thử) ----------
    function quizReward(correct, total) {
        const pass = total > 0 && correct / total >= CONFIG.passRate;
        return { pass, exp: pass ? correct * 10 + (correct === total ? 20 : 0) : 0 };
    }

    function sortReward(correct, total) {
        const pass = total > 0 && correct / total >= CONFIG.passRate;
        return { pass, exp: pass ? correct * 5 + (correct === total ? 10 : 0) : 0 };
    }

    function matchReward(pairs, mistakes) {
        const accuracy = pairs / (pairs + mistakes);
        const pass = accuracy >= 0.6;
        return { pass, exp: pass ? Math.round(pairs * 8 * accuracy) + (mistakes === 0 ? 10 : 0) : 0 };
    }

    // ---------- Gọi AI tạo nội dung ----------
    const SYSTEM = 'Bạn là giáo viên giáo dục môi trường cho người Việt Nam. Chỉ trả về JSON đúng schema, nội dung tiếng Việt, ' +
        'chính xác về khoa học và phù hợp thực tế Việt Nam (rác chia 4 nhóm: tái chế, hữu cơ, nguy hại, vô cơ/rác còn lại). ' +
        'Ngắn gọn, dễ hiểu, không nội dung gây hiểu lầm.';

    const S = { type: 'STRING' };
    const SCHEMAS = {
        quiz: {
            type: 'OBJECT',
            properties: {
                title: S,
                questions: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: { question: S, options: { type: 'ARRAY', items: S }, correctIndex: { type: 'INTEGER' }, explanation: S },
                        required: ['question', 'options', 'correctIndex', 'explanation']
                    }
                }
            },
            required: ['title', 'questions']
        },
        sort: {
            type: 'OBJECT',
            properties: {
                title: S,
                items: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: { name: S, emoji: S, bin: { type: 'STRING', enum: Object.keys(BINS) }, hint: S },
                        required: ['name', 'emoji', 'bin', 'hint']
                    }
                }
            },
            required: ['title', 'items']
        },
        match: {
            type: 'OBJECT',
            properties: {
                title: S,
                pairs: { type: 'ARRAY', items: { type: 'OBJECT', properties: { left: S, right: S }, required: ['left', 'right'] } }
            },
            required: ['title', 'pairs']
        }
    };

    function buildPrompt(kind, topic, level) {
        const avoid = seenList(kind).slice(-12).join(' | ') || 'không có';
        const rand = Math.random().toString(36).slice(2, 8);
        const lv = LEVELS.find((l) => l.id === level)?.desc || LEVELS[1].desc;
        if (kind === 'quiz') {
            return `Tạo bộ ${CONFIG.quizCount} câu hỏi trắc nghiệm MỚI về chủ đề "${topic}". Độ khó: ${lv}. ` +
                `Mỗi câu có đúng 4 đáp án khác nhau (chỉ 1 đúng), kèm giải thích tối đa 2 câu. ` +
                `Không lặp lại các câu đã dùng: ${avoid}. Mã ngẫu nhiên: ${rand}.`;
        }
        if (kind === 'sort') {
            return `Tạo ${CONFIG.sortCount} vật dụng/rác thải phổ biến ở Việt Nam (chủ đề: "${topic}", độ khó: ${lv}) ` +
                `để chơi trò phân loại vào 4 thùng: tai_che (tái chế), huu_co (hữu cơ), nguy_hiem (nguy hại), vo_co (vô cơ/rác còn lại). ` +
                `Chia đều các nhóm, tránh vật gây tranh cãi, mỗi vật có 1 emoji và gợi ý 1 câu. ` +
                `Không lặp lại: ${avoid}. Mã ngẫu nhiên: ${rand}.`;
        }
        return `Tạo ${CONFIG.matchPairs} cặp ghép MỚI về chủ đề "${topic}" (độ khó: ${lv}). ` +
            `"left" là vật hoặc khái niệm (tối đa 4 từ); "right" là nhóm / cách xử lý / tác động tương ứng (tối đa 6 từ). ` +
            `Các "right" phải khác nhau và không mơ hồ. Không lặp lại: ${avoid}. Mã ngẫu nhiên: ${rand}.`;
    }

    const NORMALIZERS = { quiz: normalizeQuiz, sort: normalizeSort, match: normalizeMatch };

    // Trả về { data, source: 'ai' | 'fallback', reason? }
    async function generate(kind, topic, level) {
        const ai = window.ecoAI;
        if (ai && ai.hasKey()) {
            try {
                const raw = await ai.generateJSON({
                    system: SYSTEM,
                    prompt: buildPrompt(kind, topic, level),
                    schema: SCHEMAS[kind],
                    temperature: 1
                });
                return { data: NORMALIZERS[kind](raw), source: 'ai' };
            } catch (e) {
                console.warn('[Learn] AI lỗi, dùng bộ có sẵn:', e);
                return { data: fromFallback(kind), source: 'fallback', reason: e };
            }
        }
        return { data: fromFallback(kind), source: 'fallback', reason: new Error('Chưa có API Key') };
    }

    function fromFallback(kind) {
        if (kind === 'quiz') {
            return normalizeQuiz({ title: 'Quiz môi trường', questions: sample(FALLBACK.quiz, CONFIG.quizCount) });
        }
        if (kind === 'sort') {
            return normalizeSort({ title: 'Phân loại nhanh', items: sample(FALLBACK.sort, CONFIG.sortCount) });
        }
        return normalizeMatch({ title: 'Ghép cặp xanh', pairs: sample(FALLBACK.match, CONFIG.matchPairs) });
    }

    // ---------- Trạng thái ----------
    const ui = { topic: TOPICS[0], custom: '', level: 'medium' };
    let runId = 0;              // tăng mỗi lần đổi màn hình để bỏ qua kết quả AI "về muộn"
    let timers = [];
    let game = null;            // phiên chơi hiện tại

    function later(fn, ms) {
        const t = setTimeout(fn, ms);
        timers.push(t);
        return t;
    }

    function every(fn, ms) {
        const t = setInterval(fn, ms);
        timers.push(t);
        return t;
    }

    function stopTimers() {
        timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
        timers = [];
    }

    const root = () => $('learn-root');
    const html = (s) => { const r = root(); if (r) r.innerHTML = s; };

    function currentTopic() {
        return clip(ui.custom, 80) || ui.topic;
    }

    // ---------- Màn hình: Menu ----------
    function renderHub() {
        stopTimers();
        runId++;
        game = null;

        const state = window.ecoState;
        const cap = state?.LEARN_DAILY_CAP || 300;
        const left = state ? state.learnQuota() : cap;
        const earned = cap - left;
        const pct = Math.min(100, Math.round((earned / cap) * 100));

        html(`
            <div class="learn-quota">
                <div class="learn-quota-text"><i class="fa-solid fa-bolt"></i> EXP học tập hôm nay
                    <strong>${earned}/${cap}</strong></div>
                <div class="learn-bar"><span style="width:${pct}%"></span></div>
            </div>

            <div class="border-card learn-setup">
                <h3 class="section-subtitle">Chủ đề</h3>
                <div class="learn-chips">
                    ${TOPICS.map((t) => `<button type="button" class="learn-chip ${!ui.custom && ui.topic === t ? 'active' : ''}" data-action="topic" data-value="${esc(t)}">${esc(t)}</button>`).join('')}
                </div>
                <input type="text" id="learn-custom-topic" class="learn-input" maxlength="80"
                    placeholder="Hoặc tự nhập chủ đề (vd: rác thải ở biển)" value="${esc(ui.custom)}">

                <h3 class="section-subtitle" style="margin-top:16px;">Độ khó</h3>
                <div class="learn-levels">
                    ${LEVELS.map((l) => `<button type="button" class="learn-chip ${ui.level === l.id ? 'active' : ''}" data-action="level" data-value="${l.id}">${l.label}</button>`).join('')}
                </div>
            </div>

            <div class="learn-cards">
                <button type="button" class="learn-card" data-action="start" data-kind="quiz">
                    <span class="learn-card-icon" style="background:#EBF8EF;color:#1E9F4A"><i class="fa-solid fa-graduation-cap"></i></span>
                    <span class="learn-card-body"><strong>Quiz AI</strong>
                        <small>${CONFIG.quizCount} câu mới mỗi lần · đạt ≥ ${Math.round(CONFIG.passRate * 100)}% nhận EXP</small></span>
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
                <button type="button" class="learn-card" data-action="start" data-kind="sort">
                    <span class="learn-card-icon" style="background:#FFF4E0;color:#D98A00"><i class="fa-solid fa-trash-can-arrow-up"></i></span>
                    <span class="learn-card-body"><strong>Phân loại nhanh</strong>
                        <small>Đưa vật vào đúng thùng trước khi hết giờ</small></span>
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
                <button type="button" class="learn-card" data-action="start" data-kind="match">
                    <span class="learn-card-icon" style="background:#EEF2FF;color:#4F5BD5"><i class="fa-solid fa-puzzle-piece"></i></span>
                    <span class="learn-card-body"><strong>Ghép cặp xanh</strong>
                        <small>Ghép vật với cách xử lý / tác động đúng</small></span>
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
            <p class="learn-note">Nội dung do AI tạo mới mỗi lần chơi. Hết hạn mức EXP trong ngày vẫn chơi được nhưng không cộng thêm.</p>
        `);
    }

    function renderLoading(kind) {
        const label = { quiz: 'bộ quiz', sort: 'trò chơi phân loại', match: 'trò chơi ghép cặp' }[kind];
        html(`
            <div class="learn-loading">
                <div class="learn-spinner"></div>
                <p>AI đang tạo ${label} mới về <strong>${esc(currentTopic())}</strong>…</p>
                <button type="button" class="learn-ghost" data-action="home">Hủy</button>
            </div>
        `);
    }

    function fallbackBanner(res) {
        if (res.source !== 'fallback') return '';
        const why = res.reason?.code === 'quota' ? 'AI đang hết hạn mức'
            : res.reason?.code === 'nokey' || /API Key/.test(res.reason?.message || '') ? 'chưa có API Key'
                : 'AI chưa khả dụng';
        return `<div class="learn-banner"><i class="fa-solid fa-circle-info"></i> ${why} — đang dùng bộ câu hỏi có sẵn.</div>`;
    }

    // ---------- Khởi động một trò ----------
    async function start(kind) {
        stopTimers();
        const my = ++runId;
        renderLoading(kind);

        const res = await generate(kind, currentTopic(), ui.level);
        if (my !== runId) return;                       // người dùng đã thoát / bắt đầu việc khác

        if (res.source === 'ai') {
            const names = kind === 'quiz' ? res.data.questions.map((q) => q.question)
                : kind === 'sort' ? res.data.items.map((i) => i.name)
                    : res.data.pairs.map((p) => p.left);
            rememberSeen(kind, names);
        }

        game = { kind, res, awarded: false };
        if (kind === 'quiz') startQuiz();
        else if (kind === 'sort') startSort();
        else startMatch();
    }

    // ---------- Phần thưởng + màn kết quả ----------
    function finishGame(summary) {
        stopTimers();
        const { kind, res } = game;
        const calc = summary.reward;
        let granted = 0;

        if (!game.awarded) {
            game.awarded = true;
            if (calc.pass && window.ecoState) {
                const label = kind === 'quiz' ? 'Quiz' : 'Mini game';
                granted = window.ecoState.addLearnExp(calc.exp, {
                    name: clip(`${label}: ${res.data.title}`, 60),
                    tag: kind === 'quiz' ? 'QUIZ' : 'MINIGAME',
                    icon: kind === 'quiz' ? 'fa-graduation-cap' : 'fa-gamepad'
                });
            }
        }

        let expLine;
        if (!calc.pass) expLine = `<div class="learn-exp none">Chưa đạt yêu cầu — không nhận EXP lần này</div>`;
        else if (granted <= 0) expLine = `<div class="learn-exp none">Bạn đã đạt hạn mức EXP học tập hôm nay — hẹn ngày mai nhé!</div>`;
        else if (granted < calc.exp) expLine = `<div class="learn-exp"><i class="fa-solid fa-bolt"></i> +${granted} EXP <small>(còn lại trong hạn mức ngày)</small></div>`;
        else expLine = `<div class="learn-exp"><i class="fa-solid fa-bolt"></i> +${granted} EXP</div>`;

        html(`
            <div class="learn-result">
                <div class="learn-score ${calc.pass ? 'pass' : 'fail'}">${esc(summary.scoreText)}</div>
                <h3>${calc.pass ? summary.passTitle : 'Cố gắng thêm nhé!'}</h3>
                <p class="learn-sub">${esc(summary.detail)}</p>
                ${expLine}
                ${summary.review || ''}
                <div class="learn-actions">
                    <button type="button" class="learn-primary" data-action="start" data-kind="${kind}">Tạo bộ mới</button>
                    <button type="button" class="learn-ghost" data-action="home">Về menu</button>
                </div>
            </div>
        `);
    }

    // ---------- Quiz ----------
    function startQuiz() {
        game.i = 0;
        game.correct = 0;
        game.wrong = [];
        renderQuestion();
    }

    function renderQuestion() {
        const qs = game.res.data.questions;
        const q = qs[game.i];
        const letters = ['A', 'B', 'C', 'D'];
        html(`
            <div class="learn-play">
                <div class="learn-topbar">
                    <button type="button" class="learn-back" data-action="home" aria-label="Thoát"><i class="fa-solid fa-xmark"></i></button>
                    <div class="learn-bar"><span style="width:${(game.i / qs.length) * 100}%"></span></div>
                    <span class="learn-count">${game.i + 1}/${qs.length}</span>
                </div>
                ${fallbackBanner(game.res)}
                <h3 class="learn-question">${esc(q.question)}</h3>
                <div class="learn-options">
                    ${q.options.map((o, i) => `<button type="button" class="learn-option" data-action="answer" data-i="${i}"><b>${letters[i]}</b><span>${esc(o)}</span></button>`).join('')}
                </div>
                <div class="learn-feedback hidden" id="learn-feedback"></div>
            </div>
        `);
        game.locked = false;
    }

    function answer(i) {
        if (!game || game.kind !== 'quiz' || game.locked) return;
        game.locked = true;
        const qs = game.res.data.questions;
        const q = qs[game.i];
        const ok = i === q.correctIndex;
        if (ok) game.correct++;
        else game.wrong.push({ q, picked: i });

        document.querySelectorAll('.learn-option').forEach((btn) => {
            const idx = Number(btn.dataset.i);
            btn.disabled = true;
            if (idx === q.correctIndex) btn.classList.add('correct');
            else if (idx === i) btn.classList.add('wrong');
        });

        const last = game.i === qs.length - 1;
        const fb = $('learn-feedback');
        if (fb) {
            fb.classList.remove('hidden');
            fb.innerHTML = `
                <div class="learn-fb-title ${ok ? 'ok' : 'bad'}"><i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${ok ? 'Chính xác!' : 'Chưa đúng'}</div>
                ${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}
                <button type="button" class="learn-primary" data-action="next">${last ? 'Xem kết quả' : 'Câu tiếp theo'}</button>`;
        }
    }

    function nextQuestion() {
        if (!game || game.kind !== 'quiz') return;
        const qs = game.res.data.questions;
        if (game.i < qs.length - 1) {
            game.i++;
            renderQuestion();
            return;
        }
        const total = qs.length;
        const pct = Math.round((game.correct / total) * 100);
        const reward = quizReward(game.correct, total);
        const review = game.wrong.length
            ? `<div class="learn-review"><h4>Ôn lại câu sai</h4>${game.wrong.map(({ q }) => `
                <div class="learn-review-item">
                    <p><b>${esc(q.question)}</b></p>
                    <p class="ok">Đáp án đúng: ${esc(q.options[q.correctIndex])}</p>
                    ${q.explanation ? `<p class="muted">${esc(q.explanation)}</p>` : ''}
                </div>`).join('')}</div>`
            : '';
        finishGame({
            reward,
            scoreText: `${game.correct}/${total}`,
            passTitle: game.correct === total ? 'Hoàn hảo! 🌟' : 'Làm tốt lắm! 🌿',
            detail: `Bạn đúng ${pct}% — cần ≥ ${Math.round(CONFIG.passRate * 100)}% để nhận EXP.`,
            review
        });
    }

    // ---------- Mini game 1: Phân loại nhanh ----------
    function startSort() {
        game.i = 0;
        game.correct = 0;
        game.missed = [];
        renderSortItem();
    }

    function renderSortItem() {
        const items = game.res.data.items;
        const it = items[game.i];
        game.locked = false;
        game.timeLeft = CONFIG.sortSeconds;

        html(`
            <div class="learn-play">
                <div class="learn-topbar">
                    <button type="button" class="learn-back" data-action="home" aria-label="Thoát"><i class="fa-solid fa-xmark"></i></button>
                    <div class="learn-bar timer"><span id="learn-timer-bar" style="width:100%"></span></div>
                    <span class="learn-count">${game.i + 1}/${items.length}</span>
                </div>
                ${fallbackBanner(game.res)}
                <div class="learn-sort-card">
                    <div class="learn-emoji">${esc(it.emoji)}</div>
                    <div class="learn-sort-name">${esc(it.name)}</div>
                    <div class="learn-sort-hint hidden" id="learn-sort-hint"></div>
                </div>
                <div class="learn-bins">
                    ${Object.entries(BINS).map(([id, b]) => `
                        <button type="button" class="learn-bin" data-action="bin" data-bin="${id}" style="--bin:${b.color}">
                            <i class="fa-solid ${b.icon}"></i><span>${b.label}</span>
                        </button>`).join('')}
                </div>
            </div>
        `);

        stopTimers();
        const total = CONFIG.sortSeconds * 1000;
        const t0 = Date.now();
        every(() => {
            const left = Math.max(0, total - (Date.now() - t0));
            const bar = $('learn-timer-bar');
            if (bar) bar.style.width = `${(left / total) * 100}%`;
            if (left <= 0) sortPick(null);               // hết giờ
        }, 100);
    }

    function sortPick(binId) {
        if (!game || game.kind !== 'sort' || game.locked) return;
        game.locked = true;
        stopTimers();

        const items = game.res.data.items;
        const it = items[game.i];
        const ok = binId === it.bin;
        if (ok) game.correct++;
        else game.missed.push({ it, picked: binId });

        document.querySelectorAll('.learn-bin').forEach((btn) => {
            btn.disabled = true;
            if (btn.dataset.bin === it.bin) btn.classList.add('correct');
            else if (btn.dataset.bin === binId) btn.classList.add('wrong');
        });
        const hint = $('learn-sort-hint');
        if (hint) {
            hint.classList.remove('hidden');
            hint.textContent = (ok ? '✔ Đúng! ' : binId ? `✘ Đúng ra là thùng ${BINS[it.bin].label}. ` : `⏱ Hết giờ! Thùng đúng: ${BINS[it.bin].label}. `) + (it.hint || '');
        }

        later(() => {
            if (game.i < items.length - 1) {
                game.i++;
                renderSortItem();
                return;
            }
            const total = items.length;
            const reward = sortReward(game.correct, total);
            const review = game.missed.length
                ? `<div class="learn-review"><h4>Ôn lại</h4>${game.missed.map(({ it: m }) => `
                    <div class="learn-review-item">
                        <p><b>${esc(m.emoji)} ${esc(m.name)}</b> → <span class="ok">${esc(BINS[m.bin].label)}</span></p>
                        ${m.hint ? `<p class="muted">${esc(m.hint)}</p>` : ''}
                    </div>`).join('')}</div>`
                : '';
            finishGame({
                reward,
                scoreText: `${game.correct}/${total}`,
                passTitle: game.correct === total ? 'Chuyên gia phân loại! 🏆' : 'Phân loại tốt! ♻️',
                detail: `Bạn phân loại đúng ${game.correct}/${total} vật — cần ≥ ${Math.round(CONFIG.passRate * 100)}% để nhận EXP.`,
                review
            });
        }, CONFIG.revealMs);
    }

    // ---------- Mini game 2: Ghép cặp xanh ----------
    function startMatch() {
        const pairs = game.res.data.pairs;
        game.mistakes = 0;
        game.matched = new Set();
        game.selected = null;
        game.locked = false;
        game.rightOrder = shuffle(pairs.map((_, i) => i));
        renderMatch();
    }

    function renderMatch() {
        const pairs = game.res.data.pairs;
        html(`
            <div class="learn-play">
                <div class="learn-topbar">
                    <button type="button" class="learn-back" data-action="home" aria-label="Thoát"><i class="fa-solid fa-xmark"></i></button>
                    <div class="learn-bar"><span id="learn-match-bar" style="width:0%"></span></div>
                    <span class="learn-count" id="learn-match-count">0/${pairs.length}</span>
                </div>
                ${fallbackBanner(game.res)}
                <p class="learn-sub center">Chạm một ô bên trái, rồi chạm ô tương ứng bên phải. <b>Lượt sai:</b> <span id="learn-mistakes">0</span></p>
                <div class="learn-match">
                    <div class="learn-col">
                        ${pairs.map((p, i) => `<button type="button" class="learn-tile left" data-action="left" data-i="${i}">${esc(p.left)}</button>`).join('')}
                    </div>
                    <div class="learn-col">
                        ${game.rightOrder.map((i) => `<button type="button" class="learn-tile right" data-action="right" data-i="${i}">${esc(pairs[i].right)}</button>`).join('')}
                    </div>
                </div>
            </div>
        `);
    }

    function matchLeft(i) {
        if (!game || game.kind !== 'match' || game.locked || game.matched.has(i)) return;
        game.selected = i;
        document.querySelectorAll('.learn-tile.left').forEach((b) => b.classList.toggle('selected', Number(b.dataset.i) === i));
    }

    function matchRight(i) {
        if (!game || game.kind !== 'match' || game.locked || game.matched.has(i) || game.selected === null) return;
        const pairs = game.res.data.pairs;
        const leftBtn = document.querySelector(`.learn-tile.left[data-i="${game.selected}"]`);
        const rightBtn = document.querySelector(`.learn-tile.right[data-i="${i}"]`);

        if (game.selected === i) {
            game.matched.add(i);
            leftBtn?.classList.remove('selected');
            leftBtn?.classList.add('matched');
            rightBtn?.classList.add('matched');
            if (leftBtn) leftBtn.disabled = true;
            if (rightBtn) rightBtn.disabled = true;
            game.selected = null;

            const done = game.matched.size;
            const bar = $('learn-match-bar');
            if (bar) bar.style.width = `${(done / pairs.length) * 100}%`;
            const cnt = $('learn-match-count');
            if (cnt) cnt.textContent = `${done}/${pairs.length}`;

            if (done === pairs.length) {
                game.locked = true;
                later(() => {
                    const reward = matchReward(pairs.length, game.mistakes);
                    finishGame({
                        reward,
                        scoreText: `${pairs.length}/${pairs.length}`,
                        passTitle: game.mistakes === 0 ? 'Ghép hoàn hảo! 🌟' : 'Ghép xong rồi! 🌿',
                        detail: `Bạn ghép đúng ${pairs.length} cặp với ${game.mistakes} lượt sai.`,
                        review: `<div class="learn-review"><h4>Đáp án</h4>${pairs.map((p) => `
                            <div class="learn-review-item"><p><b>${esc(p.left)}</b> → <span class="ok">${esc(p.right)}</span></p></div>`).join('')}</div>`
                    });
                }, 500);
            }
        } else {
            game.mistakes++;
            game.locked = true;
            const m = $('learn-mistakes');
            if (m) m.textContent = String(game.mistakes);
            rightBtn?.classList.add('wrong');
            leftBtn?.classList.add('wrong');
            later(() => {
                rightBtn?.classList.remove('wrong');
                leftBtn?.classList.remove('wrong', 'selected');
                game.selected = null;
                game.locked = false;
            }, Math.round(CONFIG.revealMs / 2));
        }
    }

    // ---------- Sự kiện ----------
    function onClick(e) {
        const el = e.target.closest('[data-action]');
        if (!el || !root()?.contains(el)) return;
        const a = el.dataset.action;

        if (a === 'home') renderHub();
        else if (a === 'topic') { ui.topic = el.dataset.value; ui.custom = ''; renderHub(); }
        else if (a === 'level') { ui.level = el.dataset.value; renderHub(); }
        else if (a === 'start') start(el.dataset.kind);
        else if (a === 'answer') answer(Number(el.dataset.i));
        else if (a === 'next') nextQuestion();
        else if (a === 'bin') sortPick(el.dataset.bin);
        else if (a === 'left') matchLeft(Number(el.dataset.i));
        else if (a === 'right') matchRight(Number(el.dataset.i));
    }

    function onInput(e) {
        if (e.target && e.target.id === 'learn-custom-topic') {
            ui.custom = e.target.value;
            document.querySelectorAll('.learn-chip[data-action="topic"]').forEach((b) => b.classList.toggle('active', !ui.custom && b.dataset.value === ui.topic));
        }
    }

    function init() {
        const r = root();
        if (!r || r.dataset.bound) return;
        r.dataset.bound = '1';
        r.addEventListener('click', onClick);
        r.addEventListener('input', onInput);
        renderHub();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.ecoLearn = {
        onEnter: renderHub,
        onLeave() { stopTimers(); runId++; game = null; },
        config: CONFIG,
        TOPICS,
        BINS,
        // phục vụ kiểm thử
        normalizeQuiz, normalizeSort, normalizeMatch,
        quizReward, sortReward, matchReward,
        buildPrompt,
        _ui: ui
    };
})();

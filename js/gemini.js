
// Không còn API Key mặc định trong mã nguồn: key hệ thống nằm trên máy chủ (Netlify Function, xem js/gemini-gateway.js).

const VISION_SYSTEM_INSTRUCTION = `Bạn là chuyên gia phân loại rác thông minh. Hãy tập trung vào vật thể nằm ở GIỮA khung hình (vật mà người dùng đang hướng camera vào). Bỏ qua các vật nền hoặc vật ở rìa ảnh. Bắt buộc phải dự đoán tên một vật thể cụ thể, KHÔNG trả về "vật thể không xác định" hay "không rõ".
Trả về JSON thuần (không markdown) theo cấu trúc:
{"name":"Tên vật thể (VD: Chai nhựa PET, Vỏ chuối, Hộp bìa carton)","percentage":0-100 (Độ an toàn và thân thiện với môi trường),"tag":"RÁC TÁI CHẾ|RÁC HỮU CƠ|RÁC NGUY HIỂM|RÁC VÔ CƠ","description":"1-2 câu tác động môi trường","suggestion":"1-2 câu cách phân loại/xử lý","icon":"fa-icon-name","boundingBox":{"x":0-1,"y":0-1,"width":0-1,"height":0-1}}
percentage: 0=rất ô nhiễm, 100=an toàn. boundingBox: tọa độ tương đối từ 0-1 bao quanh vật. Trả lời bằng tiếng Việt.`;

const YOLO_ENHANCED_INSTRUCTION = `Bạn là chuyên gia phân loại rác thông minh. Hệ thống nhận diện vật thể (YOLO) đã phát hiện vật thể trong ảnh. Dựa trên ảnh cắt và thông tin YOLO cung cấp, hãy phân loại rác chi tiết.
Trả về JSON thuần (không markdown) theo cấu trúc:
{"name":"Tên vật thể chi tiết bằng tiếng Việt (VD: Chai nhựa PET, Vỏ lon nhôm, Hộp bìa carton)","percentage":0-100 (Độ an toàn và thân thiện với môi trường),"tag":"RÁC TÁI CHẾ|RÁC HỮU CƠ|RÁC NGUY HIỂM|RÁC VÔ CƠ","description":"1-2 câu tác động môi trường","suggestion":"1-2 câu cách phân loại/xử lý","icon":"fa-icon-name"}
percentage: 0=rất ô nhiễm, 100=an toàn. Trả lời bằng tiếng Việt. Hãy phân tích thật chính xác.`;

const MULTI_SYSTEM_INSTRUCTION = `Bạn là chuyên gia phân loại rác thông minh. Hãy nhận diện TẤT CẢ các vật thể riêng biệt nhìn thấy trong ảnh (tối đa 8 vật, kể cả vật nhỏ hoặc ở rìa ảnh nếu nhận ra được) và phân loại rác cho TỪNG vật. Bỏ qua người, động vật, xe cộ, tường, sàn nhà, bầu trời. Mỗi vật chỉ liệt kê một lần. Nếu chỉ có một vật thì trả về mảng một phần tử. Bắt buộc đặt tên cụ thể cho mỗi vật, KHÔNG dùng "không rõ".
Trả về JSON thuần (không markdown) là MỘT MẢNG, mỗi phần tử theo cấu trúc:
{"name":"Tên vật thể cụ thể (VD: Chai nhựa PET, Vỏ chuối, Hộp bìa carton)","percentage":0-100 (Độ an toàn và thân thiện với môi trường),"tag":"RÁC TÁI CHẾ|RÁC HỮU CƠ|RÁC NGUY HIỂM|RÁC VÔ CƠ","description":"1 câu tác động môi trường","suggestion":"1 câu cách phân loại/xử lý","icon":"fa-icon-name","boundingBox":{"x":0-1,"y":0-1,"width":0-1,"height":0-1}}
percentage: 0=rất ô nhiễm, 100=an toàn. boundingBox: tọa độ tương đối từ 0-1 bao quanh vật. Trả lời bằng tiếng Việt.`;

const DIY_SYSTEM_INSTRUCTION = `Gợi ý một ý tưởng tái chế sáng tạo. Trả JSON thuần (không markdown):
[{"title":"Tên ý tưởng","emoji":"emoji","difficulty":"easy|medium|hard","steps":["Bước 1","Bước 2"]}]
Mỗi ý tưởng 2-3 bước, thực tế, tiếng Việt.`;

// Chỉ trả về key CÁ NHÂN người dùng tự nhập ('' nếu không có -> app gọi qua máy chủ).
function getApiKey() {
    return localStorage.getItem('eco_gemini_api_key') || '';
}

window.saveApiKey = function () {
    const input = document.getElementById('api-key-input-pad');
    if (!input) return;
    const val = input.value.trim();
    if (val) {
        localStorage.setItem('eco_gemini_api_key', val);
        alert('Đã lưu API Key của bạn!');
    } else {
        localStorage.removeItem('eco_gemini_api_key');
        alert('Đã xóa API Key cá nhân. Thay vào đó sẽ dùng Key mặc định của hệ thống.');
    }
};

const GeminiManager = {
    currentContext: null,
    diyLoaded: false,

    init() {
        this.setupChat();
        this.setupChatAboutBtn();
        this.setupDIYButton();
        this.setupMultiList();

        const input = document.getElementById('api-key-input-pad');
        const savedKey = localStorage.getItem('eco_gemini_api_key');
        if (input && savedKey) {
            input.value = savedKey;
        }

        if (window.ecoState && window.ecoState.aiEngine === 'yolo_gemini') {
            this._preloadYolo();
        }
    },

    async _preloadYolo() {
        if (window.yoloDetector && !window.yoloDetector.isReady) {
            window.yoloDetector._updateStatusBadge('loading');
            await window.yoloDetector.init();
        }
    },

    async callGeminiAPI(systemInstruction, contents, temperature = 0.7) {
        // Thứ tự: model nhanh còn được cấp -> model mạnh hơn -> alias mới nhất -> model cũ.
        // (gemini-2.0-* đã ngừng; gemini-2.5-* chỉ còn với tài khoản đã dùng từ trước -> key mới có thể báo 404.)
        // Model không tồn tại chỉ mất ~0,4 giây rồi tự chuyển sang model kế tiếp.
        const modelsToTry = [
            'gemini-3.5-flash-lite',
            'gemini-3.8-flash',
            'gemini-flash-latest',
            'gemini-2.5-flash'
        ];

        const body = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: contents,
            generationConfig: { temperature: temperature }
        };

        let lastError = null;

        for (const model of modelsToTry) {
            try {
                console.log(`[Gemini] Đang thử model: ${model}...`);
                const res = await window.ecoGeminiGateway.generateContent(model, body);

                if (!res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    const errMsg = errBody.error?.message || 'Lỗi kết nối';
                    if (window.ecoGeminiGateway.isNoKeyError(errBody)) throw new Error('Chưa cấu hình API key trên máy chủ. Hãy nhập API Key cá nhân trong Setting.');

                    if (res.status === 503 || errMsg.toLowerCase().includes('high demand') || errMsg.toLowerCase().includes('overloaded')) {
                        console.warn(`[Gemini] Model ${model} đang quá tải, chuyển sang model dự phòng...`);
                        lastError = new Error(errMsg);
                        continue;
                    }
                    
                    throw new Error(errMsg);
                }

                const data = await res.json();
                if (!data.candidates || data.candidates.length === 0) {
                    throw new Error('Gemini không phản hồi dữ liệu hợp lệ');
                }

                console.log(`[Gemini] Thành công với model: ${model}`);
                return data.candidates[0].content.parts[0].text;

            } catch (err) {
                if (err.message !== 'Gemini không phản hồi dữ liệu hợp lệ' && !err.message.includes('API key')) {
                    lastError = err;
                } else {
                    throw err;
                }
            }
        }

        throw new Error(`Hệ thống AI đang bảo trì do quá tải. Xin vui lòng thử lại sau vài giây. Lỗi: ${lastError?.message || 'Unknown'}`);
    },

    parseJSONResponse(text) {
        try {
            if (text.startsWith('```json')) text = text.replace(/^```json\n/, '').replace(/\n```$/, '');
            else if (text.startsWith('```')) text = text.replace(/^```\n/, '').replace(/\n```$/, '');
            return JSON.parse(text.trim());
        } catch (e) {
            console.error("Failed to parse AI response:", text);
            throw new Error("Dữ liệu phản hồi từ AI không đúng định dạng JSON");
        }
    },

    // ================= NHẬN DIỆN ĐA VẬT THỂ (1 lần chụp) =================
    _tagHex(tag) {
        if (tag === 'RÁC NGUY HIỂM') return '#FF4757';
        if (tag === 'RÁC VÔ CƠ') return '#F5A623';
        if (tag === 'RÁC HỮU CƠ') return '#1E9F4A';
        return '#27C860';
    },

    _normalizeItem(it) {
        if (!it || typeof it !== 'object') return null;
        const r = { ...it };
        r.name = String(r.name || '').trim();
        if (!r.name) return null;
        r.tag = r.tag || 'KHÔNG RÕ';
        r.description = r.description || 'Không có mô tả chi tiết về tác động môi trường.';
        r.suggestion = r.suggestion || 'Hãy phân loại và bỏ rác đúng nơi quy định để bảo vệ môi trường.';

        r.percentage = window.ecoScore.forTag(r.tag);   // cố định theo nhóm rác

        const b = r.boundingBox;
        let box = null;
        if (b && [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && isFinite(n))
            && b.x <= 1 && b.y <= 1 && b.width <= 1.01 && b.height <= 1.01) {
            const x = Math.max(0, Math.min(1, b.x));
            const y = Math.max(0, Math.min(1, b.y));
            const width = Math.min(b.width, 1 - x);
            const height = Math.min(b.height, 1 - y);
            if (width > 0.01 && height > 0.01) box = { x, y, width, height };
        }
        r.boundingBox = box;

        this._applyTagColors(r);
        r._multi = true;
        return r;
    },

    // Trả về true nếu đã hiển thị kết quả đa vật thể; false -> để luồng cũ (1 vật) xử lý.
    async _analyzeMulti(imageDataUrl, detections) {
        try {
            this._updateStepIndicator('gemini', 'Đang nhận diện các vật thể trong ảnh...');
            const [header, base64Data] = imageDataUrl.split(',');
            const mimeType = header.split(':')[1].split(';')[0];

            let hint = '';
            if (detections && detections.length) {
                hint = '\nGợi ý từ máy (có thể sai hoặc thiếu): ' +
                    detections.slice(0, 12).map((d) => `${d.classVi} (${Math.round(d.confidence * 100)}%)`).join(', ') + '.';
            }
            const contents = [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType, data: base64Data } },
                    { text: 'Nhận diện TẤT CẢ vật thể riêng biệt trong ảnh và phân loại rác cho từng vật.' + hint }
                ]
            }];

            const aiText = await this.callGeminiAPI(MULTI_SYSTEM_INSTRUCTION, contents, 0.4);
            const m = aiText.match(/\[[\s\S]*\]/);
            let parsed = this.parseJSONResponse(m ? m[0] : aiText);
            if (parsed && !Array.isArray(parsed)) parsed = parsed.items || parsed.objects || [parsed];
            if (!Array.isArray(parsed) || !parsed.length) return false;

            const items = parsed.slice(0, 8).map((it) => this._normalizeItem(it)).filter(Boolean);
            if (!items.length) return false;

            await this._showMulti(imageDataUrl, items);
            return true;
        } catch (err) {
            console.warn('[Multi] Không nhận diện đa vật thể được, dùng cách cũ:', err);
            return false;
        }
    },

    async _showMulti(imageDataUrl, items) {
        this.multiItems = items;
        this.multiImage = imageDataUrl;

        // Vật hiển thị đầu tiên: vật gần giữa khung và lớn nhất (giống cách chọn trước đây)
        let primary = 0;
        let bestScore = -1;
        items.forEach((it, i) => {
            const b = it.boundingBox;
            let sc = 0.3;
            if (b) {
                const d = Math.hypot(b.x + b.width / 2 - 0.5, b.y + b.height / 2 - 0.5) / Math.SQRT2;
                sc = (1 - d * 0.7) + Math.min(b.width * b.height * 2, 0.3);
            }
            if (sc > bestScore) { bestScore = sc; primary = i; }
        });

        this._updateStepIndicator('done', '');
        await this.selectMultiItem(primary);
        if (window.ecoState) window.ecoState.addPoints(items[primary].points || 10, items[primary]);
    },

    async selectMultiItem(idx) {
        const items = this.multiItems || [];
        const item = items[idx];
        if (!item) return;
        this.multiSelected = idx;
        item.otherItems = items.filter((_, i) => i !== idx).map((o) => o.name);

        this.currentContext = item;
        this.diyLoaded = false;

        const annotated = await this.createMultiAnnotatedImage(this.multiImage, items, idx);
        this.updateResultUI(item, annotated);
        this.renderMultiList();
    },

    renderMultiList() {
        const card = document.getElementById('multi-items-card');
        const list = document.getElementById('multi-items-list');
        const count = document.getElementById('multi-items-count');
        if (!card || !list) return;

        const items = this.multiItems || [];
        list.textContent = '';
        if (items.length < 2) { card.classList.add('hidden'); return; }

        if (count) count.textContent = items.length;
        items.forEach((it, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'multi-chip' + (i === this.multiSelected ? ' active' : '');
            btn.dataset.idx = String(i);
            btn.style.setProperty('--c', this._tagHex(it.tag));
            btn.textContent = `${i + 1}. ${it.name}`;
            list.appendChild(btn);
        });
        card.classList.remove('hidden');
    },

    setupMultiList() {
        const list = document.getElementById('multi-items-list');
        if (!list || list.dataset.bound) return;
        list.dataset.bound = '1';
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('.multi-chip');
            if (!btn) return;
            const idx = parseInt(btn.dataset.idx, 10);
            if (idx === this.multiSelected) return;
            this.selectMultiItem(idx);
        });
    },

    createMultiAnnotatedImage(imageDataUrl, items, selectedIdx) {
        return new Promise((resolve) => {
            if (!items.some((it) => it.boundingBox)) { resolve(imageDataUrl); return; }
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // Vẽ vật không chọn trước, vật được chọn vẽ sau cùng để nằm trên
                const order = items.map((_, i) => i).sort((a, b) => (a === selectedIdx) - (b === selectedIdx));
                order.forEach((i) => {
                    const it = items[i];
                    const bb = it.boundingBox;
                    if (!bb) return;
                    const sel = i === selectedIdx;
                    const x = bb.x * img.width, y = bb.y * img.height;
                    const w = bb.width * img.width, h = bb.height * img.height;
                    const color = this._tagHex(it.tag);

                    ctx.globalAlpha = sel ? 1 : 0.75;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = sel ? Math.max(4, img.width * 0.006) : Math.max(2, img.width * 0.003);
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8); else ctx.rect(x, y, w, h);
                    ctx.stroke();
                    if (sel) {
                        const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.12)`;
                        ctx.fill();
                    }

                    const name = it.name.length > 22 ? it.name.slice(0, 21) + '…' : it.name;
                    const label = `${i + 1}. ${name}`;
                    const fontSize = Math.max(sel ? 14 : 12, img.width * (sel ? 0.022 : 0.017));
                    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
                    const tw = ctx.measureText(label).width;
                    const px = 10, badgeH = fontSize + 12;
                    const bx = x, by = Math.max(0, y - badgeH - 3);
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(bx, by, tw + px * 2, badgeH, 6); else ctx.rect(bx, by, tw + px * 2, badgeH);
                    ctx.fill();
                    ctx.fillStyle = '#FFF';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, bx + px, by + badgeH / 2);
                    ctx.globalAlpha = 1;
                });

                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };
            img.onerror = () => resolve(imageDataUrl);
            img.src = imageDataUrl;
        });
    },

    async analyzeWithYolo(imageDataUrl) {
        try {
            this._updateStepIndicator('yolo', 'Đang quét hình ảnh...');

            const yoloResult = await window.yoloDetector.detect(imageDataUrl);

            // Ưu tiên nhận diện tất cả vật thể trong ảnh; lỗi thì rơi về luồng 1 vật như cũ
            if (await this._analyzeMulti(imageDataUrl, yoloResult && yoloResult.detections)) return;

            if (!yoloResult || !yoloResult.bestDetection) {

                this._updateStepIndicator('gemini', 'Đang phân tích chi tiết...');
                return await this.analyzeImage(imageDataUrl, true);
            }

            const best = yoloResult.bestDetection;
            console.log(`[Pipeline] YOLO detected: ${best.class} (${(best.confidence * 100).toFixed(1)}%)`);

            this._updateStepIndicator('gemini', `Đang phân loại rác thải...`);

            const croppedImage = yoloResult.croppedDataUrl;
            const [header, base64Data] = croppedImage.split(',');
            const mimeType = header.split(':')[1].split(';')[0];

            const contextMessage = `Hệ thống YOLO đã phát hiện vật thể "${best.class}" (${best.classVi}) với độ tin cậy ${(best.confidence * 100).toFixed(1)}%. Dựa trên ảnh cắt này, hãy phân loại rác chi tiết.`;

            const contents = [{
                role: "user",
                parts: [
                    { inlineData: { mimeType: mimeType, data: base64Data } },
                    { text: contextMessage }
                ]
            }];

            const aiText = await this.callGeminiAPI(YOLO_ENHANCED_INSTRUCTION, contents, 0.4);
            const resultJson = this.parseJSONResponse(aiText);

            resultJson.tag = resultJson.tag || 'KHÔNG RÕ';
            resultJson.name = resultJson.name || best.classVi || 'Vật thể không xác định';
            resultJson.description = resultJson.description || 'Không có mô tả chi tiết về tác động môi trường.';
            resultJson.suggestion = resultJson.suggestion || 'Hãy phân loại và bỏ rác đúng nơi quy định để bảo vệ môi trường.';

            resultJson.percentage = window.ecoScore.forTag(resultJson.tag);   // cố định theo nhóm rác

            resultJson.boundingBox = best.bboxRel;
            resultJson.yoloClass = best.class;
            resultJson.yoloClassVi = best.classVi;
            resultJson.yoloConfidence = best.confidence;
            resultJson.allDetections = yoloResult.detections;

            this._applyTagColors(resultJson);

            this.currentContext = resultJson;
            this.diyLoaded = false;

            const annotatedUrl = await this.createAnnotatedImage(imageDataUrl, resultJson);
            this._updateStepIndicator('done', '');
            this.updateResultUI(resultJson, annotatedUrl);

            if (window.ecoState) window.ecoState.addPoints(resultJson.points || 10, resultJson);

        } catch (err) {
            console.error('[Pipeline] Hybrid error:', err);
            this._updateStepIndicator('done', '');
            this.showAnalysisError(err);
        }
    },

    async _drawYoloAnnotations(imageDataUrl, yoloResult, resultJson) {
        const detections = yoloResult.detections.map((det, idx) => {
            let wasteColor = '#3B82F6';
            if (idx === 0) {
                if (resultJson.tag === 'RÁC TÁI CHẾ') wasteColor = '#27C860';
                else if (resultJson.tag === 'RÁC HỮU CƠ') wasteColor = '#1E9F4A';
                else if (resultJson.tag === 'RÁC NGUY HIỂM') wasteColor = '#FF4757';
                else if (resultJson.tag === 'RÁC VÔ CƠ') wasteColor = '#F5A623';
            }
            return {
                ...det,
                wasteColor,
                displayName: idx === 0 ? resultJson.name : `${det.classVi} ${Math.round(det.confidence * 100)}%`
            };
        });

        return window.yoloDetector.drawDetections(imageDataUrl, detections);
    },

    _updateStepIndicator(step, message) {
        const skeleton = document.getElementById('analysis-skeleton');
        if (!skeleton) return;

        let indicator = document.getElementById('pipeline-step-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'pipeline-step-indicator';
            indicator.style.cssText = 'text-align:center; padding: 12px 16px; font-size: 13px; font-weight: 600; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 10px;';
            skeleton.parentNode.insertBefore(indicator, skeleton);
        }

        if (step === 'done') {
            indicator.remove();
            return;
        }

        const icons = {
            yolo: '<i class="fa-solid fa-crosshairs fa-spin" style="color: var(--primary);"></i>',
            gemini: '<i class="fa-solid fa-brain fa-beat" style="color: #3B82F6;"></i>'
        };

        indicator.innerHTML = `${icons[step] || ''} ${message}`;
    },


    async analyzeImage(imageDataUrl, skipMulti = false) {
        try {
            if (!skipMulti && await this._analyzeMulti(imageDataUrl, null)) return;

            const [header, base64Data] = imageDataUrl.split(',');
            const mimeType = header.split(':')[1].split(';')[0];

            const contents = [{
                role: "user",
                parts: [
                    { inlineData: { mimeType: mimeType, data: base64Data } },
                    { text: "Hãy tập trung vào vật thể nằm ở GIỮA ảnh (vật mà người dùng đang chĩa camera vào). Nhận diện vật thể đó và cho biết nếu vứt bỏ đi thì nó thuộc loại rác nào." }
                ]
            }];

            const aiText = await this.callGeminiAPI(VISION_SYSTEM_INSTRUCTION, contents, 0.4);
            const resultJson = this.parseJSONResponse(aiText);

            resultJson.tag = resultJson.tag || 'KHÔNG RÕ';
            resultJson.name = resultJson.name || 'Vật thể không xác định';
            resultJson.description = resultJson.description || 'Không có mô tả chi tiết về tác động môi trường.';
            resultJson.suggestion = resultJson.suggestion || 'Hãy phân loại và bỏ rác đúng nơi quy định để bảo vệ môi trường.';

            resultJson.percentage = window.ecoScore.forTag(resultJson.tag);   // cố định theo nhóm rác

            this._applyTagColors(resultJson);

            this.currentContext = resultJson;
            this.diyLoaded = false;

            const annotatedUrl = await this.createAnnotatedImage(imageDataUrl, resultJson);
            this._updateStepIndicator('done', '');
            this.updateResultUI(resultJson, annotatedUrl);

            if (window.ecoState) window.ecoState.addPoints(resultJson.points || 10, resultJson);

        } catch (err) {
            console.error('Analyze error:', err);
            this._updateStepIndicator('done', '');
            this.showAnalysisError(err);
        }
    },

    _applyTagColors(resultJson) {
        if (resultJson.tag === 'RÁC TÁI CHẾ') {
            resultJson.tagColor = 'var(--primary-dark)';
            resultJson.points = 50;
        } else if (resultJson.tag === 'RÁC HỮU CƠ') {
            resultJson.tagColor = 'var(--primary-dark)';
            resultJson.points = 30;
        } else if (resultJson.tag === 'RÁC NGUY HIỂM') {
            resultJson.tagColor = 'var(--danger)';
            resultJson.points = 100;
        } else {
            resultJson.tagColor = 'var(--text-muted)';
            resultJson.points = 10;
        }

        const pct = resultJson.percentage || 0;
        if (pct >= 60) {
            resultJson.strokeColor = '#1B9E4B';
        } else if (pct >= 35) {
            resultJson.strokeColor = 'var(--warning)';
        } else {
            resultJson.strokeColor = 'var(--danger)';
        }
    },

    createAnnotatedImage(imageDataUrl, result) {
        return new Promise((resolve) => {
            if (!result.boundingBox) { resolve(imageDataUrl); return; }

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');

                ctx.drawImage(img, 0, 0);

                const bbox = result.boundingBox;
                const x = bbox.x * img.width;
                const y = bbox.y * img.height;
                const w = bbox.width * img.width;
                const h = bbox.height * img.height;

                let color = '#27C860';
                if (result.tag === 'RÁC NGUY HIỂM') color = '#FF4757';
                else if (result.tag === 'RÁC VÔ CƠ') color = '#F5A623';

                ctx.strokeStyle = color;
                ctx.lineWidth = Math.max(3, img.width * 0.004);
                ctx.beginPath();
                ctx.roundRect(x, y, w, h, 8);
                ctx.stroke();

                const r = parseInt(color.slice(1, 3), 16);
                const g = parseInt(color.slice(3, 5), 16);
                const b = parseInt(color.slice(5, 7), 16);
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.1)`;
                ctx.fill();

                const cLen = Math.min(28, w * 0.15, h * 0.15);
                ctx.strokeStyle = color;
                ctx.lineWidth = Math.max(5, img.width * 0.006);

                [[x, y + cLen, x, y, x + cLen, y],
                [x + w - cLen, y, x + w, y, x + w, y + cLen],
                [x, y + h - cLen, x, y + h, x + cLen, y + h],
                [x + w - cLen, y + h, x + w, y + h, x + w, y + h - cLen]
                ].forEach(([x1, y1, x2, y2, x3, y3]) => {
                    ctx.beginPath();
                    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
                    ctx.stroke();
                });

                if (result.name) {
                    const fontSize = Math.max(14, img.width * 0.022);
                    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
                    const tm = ctx.measureText(result.name);
                    const px = 12, badgeH = fontSize + 14;
                    const bx = x, by = Math.max(0, y - badgeH - 4);

                    ctx.shadowColor = 'rgba(0,0,0,0.2)';
                    ctx.shadowBlur = 6;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.roundRect(bx, by, tm.width + px * 2, badgeH, 6);
                    ctx.fill();

                    ctx.shadowBlur = 0;
                    ctx.fillStyle = '#FFF';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(result.name, bx + px, by + badgeH / 2);
                }

                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };
            img.onerror = () => resolve(imageDataUrl);
            img.src = imageDataUrl;
        });
    },

    updateResultUI(result, imageDataUrl) {
        if (!result._multi) { this.multiItems = []; this.renderMultiList(); }   // kết quả 1 vật: ẩn danh sách
        window.currentMapReportImage = imageDataUrl;
        window.currentMapReportDesc = result.name;

        document.getElementById('analysis-skeleton')?.classList.add('hidden');
        const content = document.getElementById('analysis-content');
        if (content) content.classList.remove('hidden');

        const itemTag = document.getElementById('item-tag');
        const itemName = document.getElementById('item-name');
        const safeDesc = document.getElementById('safety-description');
        const aiSug = document.getElementById('ai-suggestion');

        if (itemTag) { itemTag.innerText = result.tag; itemTag.style.color = result.tagColor || 'var(--primary-dark)'; }
        if (itemName) itemName.innerText = result.name;
        if (safeDesc) safeDesc.innerText = result.description;
        if (aiSug) aiSug.innerHTML = result.suggestion;

        const yoloBadge = document.getElementById('yolo-detection-info');
        if (yoloBadge) {
            yoloBadge.classList.add('hidden'); 
        }

        const circle = document.getElementById('safety-circle');
        const pctText = document.getElementById('safety-percentage-text');

        if (circle) {
            circle.classList.remove('animate');
            void circle.offsetWidth;
            circle.style.stroke = result.strokeColor || 'var(--primary)';
            circle.style.strokeDasharray = `${result.percentage}, 100`;
        }

        if (pctText) {
            let v = 0;
            const step = Math.max(1, result.percentage / 60);
            const t = setInterval(() => {
                v += step;
                if (v >= result.percentage) { pctText.innerText = result.percentage; clearInterval(t); }
                else pctText.innerText = Math.floor(v);
            }, 16);
        }

        this.updateChatContextBadge(result);
        window.ecoVoice?.speakScanResult(result);

        const imageCard = document.getElementById('scanned-image-card');
        const imagePreview = document.getElementById('scanned-image-preview');
        if (imageCard && imagePreview && imageDataUrl) {
            imagePreview.src = imageDataUrl;
            imageCard.classList.remove('hidden');
        }

        const diySection = document.getElementById('diy-section');
        const diyIdeas = document.getElementById('diy-ideas');
        const diySkeleton = document.getElementById('diy-skeleton');
        if (diySection) diySection.classList.add('hidden');
        if (diyIdeas) { diyIdeas.classList.add('hidden'); diyIdeas.innerHTML = ''; }
        if (diySkeleton) diySkeleton.classList.remove('hidden');
    },

    showAnalysisError(err) {
        document.getElementById('analysis-skeleton')?.classList.add('hidden');
        const content = document.getElementById('analysis-content');
        if (content) content.classList.remove('hidden');

        const itemTag = document.getElementById('item-tag');
        const itemName = document.getElementById('item-name');
        const safeDesc = document.getElementById('safety-description');
        const aiSug = document.getElementById('ai-suggestion');
        const circle = document.getElementById('safety-circle');

        const errMsg = err && err.message ? err.message : 'Không xác định';

        if (itemTag) { itemTag.innerText = 'LỖI HỆ THỐNG'; itemTag.style.color = 'var(--danger)'; }
        if (itemName) itemName.innerText = 'Không thể phân tích';
        if (safeDesc) safeDesc.innerText = 'Lỗi chi tiết: ' + errMsg;
        if (aiSug) aiSug.innerHTML = 'Hệ thống AI từ chối phân tích bức ảnh này. Xin vui lòng thử một bức ảnh nhỏ hơn hoặc khác định dạng.';
        if (circle) {
            circle.style.stroke = 'var(--danger)';
            circle.style.strokeDasharray = '0, 100';
        }
        const pctText = document.getElementById('safety-percentage-text');
        if (pctText) pctText.innerText = '0';

        const yoloBadge = document.getElementById('yolo-detection-info');
        if (yoloBadge) yoloBadge.classList.add('hidden');
    },

    updateChatContextBadge(result) {
        const badge = document.getElementById('chat-context-badge');
        const text = document.getElementById('chat-context-text');
        if (badge && text) {
            text.innerText = result.name;
            badge.classList.remove('hidden');
        }
    },

    setupChatAboutBtn() {
        const btn = document.getElementById('chat-about-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (window.navigateTo) window.navigateTo('chat-screen');
        });
    },


    setupDIYButton() {
        const btn = document.getElementById('diy-btn');
        if (!btn) return;

        btn.addEventListener('click', async () => {
            if (!this.currentContext || !this.currentContext.name) {
                return;
            }

            const diySection = document.getElementById('diy-section');
            const diyIdeas = document.getElementById('diy-ideas');
            const diySkeleton = document.getElementById('diy-skeleton');

            if (this.diyLoaded) {
                diySection?.classList.toggle('hidden');
                if (diySection && !diySection.classList.contains('hidden')) window.ecoVoice?.speakCreative();
                return;
            }
            if (diySection) diySection.classList.remove('hidden');
            if (diySkeleton) diySkeleton.classList.remove('hidden');
            if (diyIdeas) diyIdeas.classList.add('hidden');

            try {
                const contents = [{
                    role: "user",
                    parts: [{ text: `${this.currentContext.name} (${this.currentContext.tag})` }]
                }];

                const aiText = await this.callGeminiAPI(DIY_SYSTEM_INSTRUCTION, contents, 0.8);
                const ideas = this.parseJSONResponse(aiText);

                if (diySkeleton) diySkeleton.classList.add('hidden');
                if (diyIdeas) {
                    diyIdeas.innerHTML = ideas.map(idea => {
                        const diffClass = idea.difficulty === 'easy' ? 'easy' : idea.difficulty === 'hard' ? 'hard' : 'medium';
                        const diffLabel = idea.difficulty === 'easy' ? 'Dễ' : idea.difficulty === 'hard' ? 'Khó' : 'Trung bình';
                        const stepsHtml = (idea.steps || []).map(s => `<li>${s}</li>`).join('');

                        return `
                            <div class="diy-idea-card">
                                <div class="diy-idea-title">
                                    <span class="diy-idea-emoji">${idea.emoji || '♻️'}</span>
                                    <h5>${idea.title || 'Ý tưởng thú vị'}</h5>
                                </div>
                                <span class="diy-difficulty ${diffClass}">${diffLabel}</span>
                                <ul class="diy-steps">${stepsHtml}</ul>
                            </div>
                        `;
                    }).join('');
                    diyIdeas.classList.remove('hidden');
                }

                this.diyLoaded = true;
                window.ecoVoice?.speakCreative();

            } catch (err) {
                console.error('DIY error:', err);
                if (diySkeleton) diySkeleton.classList.add('hidden');
                if (diyIdeas) {
                    diyIdeas.innerHTML = `
                        <div class="diy-error">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <p>Không thể tạo ý tưởng. Hãy thử lại sau nhé!</p>
                        </div>
                    `;
                    diyIdeas.classList.remove('hidden');
                }
            }
        });
    },

    // ---- CHAT ----
    setupChat() {
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');

        const sendMessage = async () => {
            const text = input?.value.trim();
            if (!text) return;

            this.appendChatMessage(text, 'sent');
            if (input) input.value = '';

            this.appendChatMessage('Greeny đang soạn...', 'received', true);

            try {
                let systemInstruction = "You are Greeny, a helpful AI assistant for the ViEcoLens app. You help users classify waste and learn about environmental protection. Answer in Vietnamese, keep it concise, polite, and engaging.";

                if (this.currentContext && this.currentContext.name) {
                    systemInstruction += `\nThe user recently scanned: "${this.currentContext.name}" (${this.currentContext.tag}).`;
                    if (this.currentContext.yoloClass) {
                        systemInstruction += ` YOLO detected: "${this.currentContext.yoloClass}" with ${(this.currentContext.yoloConfidence * 100).toFixed(0)}% confidence.`;
                    }
                    if (this.currentContext.otherItems && this.currentContext.otherItems.length) {
                        systemInstruction += ` The same photo also contained: ${this.currentContext.otherItems.join(', ')}.`;
                    }
                    systemInstruction += ` When relevant, refer to this context to give them specific advice.`;
                }

                const contents = [{
                    role: "user",
                    parts: [{ text: text }]
                }];

                const replyText = await this.callGeminiAPI(systemInstruction, contents, 0.7);

                this.removeTypingIndicator();
                this.appendChatMessage(replyText, 'received');
                window.ecoVoice?.speakReply(replyText);

            } catch (err) {
                console.error('Chat error:', err);
                this.removeTypingIndicator();
                const errText = 'Xin lỗi, kết nối thất bại. Hãy kiểm tra API Key và thử lại sau nhé.';
                this.appendChatMessage(errText, 'received');
                window.ecoVoice?.speakReply(errText);
            }
        };

        if (sendBtn) sendBtn.addEventListener('click', sendMessage);
        if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    },

    appendChatMessage(text, cls, isTyping = false) {
        const container = document.getElementById('chat-container');
        if (!container) return;

        const wrapper = document.createElement('div');
        wrapper.className = `message ${cls}`;

        let processed = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        if (isTyping) {
            wrapper.id = 'typing-indicator';
            wrapper.innerHTML = `<div class="bubble" style="opacity:0.65;font-style:italic;">${processed}</div>`;
        } else {
            wrapper.innerHTML = `<div class="bubble">${processed}</div>`;
        }

        container.appendChild(wrapper);
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    },

    removeTypingIndicator() {
        document.getElementById('typing-indicator')?.remove();
    }
};

window.ecoGemini = GeminiManager;

document.addEventListener('DOMContentLoaded', () => GeminiManager.init());

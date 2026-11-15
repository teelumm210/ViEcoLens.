

const YoloDetector = {
    session: null,
    isLoading: false,
    isReady: false,
    modelPath: 'models/yolov8n.onnx',
    inputSize: 640,
    confidenceThreshold: 0.35,
    iouThreshold: 0.45,

    ignoredClasses: new Set([
        'person',       
        'bird',         
        'cat',          
        'dog',         
        'horse',    
        'sheep',       
        'cow',          
        'elephant',   
        'bear',   
        'zebra',    
        'giraffe', 
        'car',         
        'motorcycle',
        'airplane',   
        'bus',        
        'train',      
        'truck',        
        'boat',      
    ]),

    classNames: [
        'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
        'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
        'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
        'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
        'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
        'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
        'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake',
        'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop',
        'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
        'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
    ],

    classNameVi: {
        'bottle': 'Chai/Lọ', 'wine glass': 'Ly thủy tinh', 'cup': 'Cốc/Ly',
        'fork': 'Nĩa', 'knife': 'Dao', 'spoon': 'Muỗng/Thìa', 'bowl': 'Tô/Bát',
        'banana': 'Quả chuối', 'apple': 'Quả táo', 'sandwich': 'Bánh sandwich',
        'orange': 'Quả cam', 'broccoli': 'Bông cải xanh', 'carrot': 'Cà rốt',
        'hot dog': 'Xúc xích', 'pizza': 'Pizza', 'donut': 'Bánh donut', 'cake': 'Bánh ngọt',
        'chair': 'Ghế', 'couch': 'Sofa', 'potted plant': 'Cây chậu', 'bed': 'Giường',
        'dining table': 'Bàn ăn', 'toilet': 'Bồn cầu', 'tv': 'Tivi', 'laptop': 'Laptop',
        'mouse': 'Chuột máy tính', 'remote': 'Điều khiển', 'keyboard': 'Bàn phím',
        'cell phone': 'Điện thoại', 'microwave': 'Lò vi sóng', 'oven': 'Lò nướng',
        'toaster': 'Máy nướng bánh', 'sink': 'Bồn rửa', 'refrigerator': 'Tủ lạnh',
        'book': 'Sách', 'clock': 'Đồng hồ', 'vase': 'Bình hoa', 'scissors': 'Kéo',
        'teddy bear': 'Gấu bông', 'hair drier': 'Máy sấy tóc', 'toothbrush': 'Bàn chải đánh răng',
        'backpack': 'Ba lô', 'umbrella': 'Ô/Dù', 'handbag': 'Túi xách', 'tie': 'Cà vạt',
        'suitcase': 'Vali', 'frisbee': 'Đĩa frisbee', 'sports ball': 'Bóng thể thao',
        'skateboard': 'Ván trượt', 'surfboard': 'Ván lướt sóng', 'tennis racket': 'Vợt tennis',
        'person': 'Người', 'bicycle': 'Xe đạp', 'car': 'Ô tô', 'motorcycle': 'Xe máy',
        'bus': 'Xe buýt', 'truck': 'Xe tải', 'bird': 'Chim', 'cat': 'Mèo', 'dog': 'Chó'
    },

    // Mô hình mặc định (YOLOv8n COCO) được giữ làm phương án dự phòng; mô hình rác riêng được ưu tiên.
    // Đặt localStorage 'eco_yolo_model' = 'coco' để buộc dùng mô hình cũ.
    async init() {
        if (this.isLoading || this.isReady) return this.isReady;
        this.isLoading = true;

        let order = [this._wasteProfile, this._cocoProfile];
        try { if (localStorage.getItem('eco_yolo_model') === 'coco') order = [this._cocoProfile]; } catch (e) { /* bỏ qua */ }
        if (this._forceCoco) order = [this._cocoProfile];

        for (const profile of order) {
            try {
                console.log(`[YOLO] Loading model "${profile.id}" (${profile.modelPath})...`);
                const startTime = performance.now();

                this.session = await ort.InferenceSession.create(profile.modelPath, {
                    executionProviders: ['wasm'],
                    graphOptimizationLevel: 'all'
                });

                this._applyProfile(profile);

                const loadTime = ((performance.now() - startTime) / 1000).toFixed(1);
                console.log(`[YOLO] Model "${profile.id}" loaded in ${loadTime}s`);
                this.isReady = true;
                this.isLoading = false;
                this._updateStatusBadge('ready');
                return true;
            } catch (err) {
                console.error(`[YOLO] Failed to load model "${profile.id}":`, err);
                this.session = null;
            }
        }

        this.isLoading = false;
        this._updateStatusBadge('error');
        return false;
    },

    // Mô hình rác tải được nhưng chạy lỗi (thiếu bộ nhớ, thiếu toán tử...) -> chuyển hẳn sang mô hình COCO nhỏ.
    async _fallbackToCoco(err) {
        console.error('[YOLO] Mô hình rác chạy lỗi, chuyển sang YOLOv8n:', err);
        this._forceCoco = true;
        this.isReady = false;
        this.session = null;
        return this.init();
    },

    _applyProfile(p) {
        this.profileId = p.id;
        this.modelPath = p.modelPath;
        this.inputSize = p.inputSize;
        this.confidenceThreshold = p.confidenceThreshold;
        this.classNames = p.classNames;
        this.classNameVi = p.classNameVi;
        this.ignoredClasses = p.ignoredClasses;
        this._pre = null;          // canvas tiền xử lý phụ thuộc kích thước đầu vào
    },

    async detect(imageSource) {
        if (!this.isReady) {
            const loaded = await this.init();
            if (!loaded) return null;
        }

        const img = await this._loadImage(imageSource);
        if (!img) return null;

        const startTime = performance.now();

        const { tensor, ratioX, ratioY, padX, padY } = this._preprocess(img);

        const feeds = {};
        const inputName = this.session.inputNames[0];
        feeds[inputName] = tensor;

        let results;
        try {
            results = await this.session.run(feeds);
        } catch (err) {
            if (this.profileId === 'waste' && !this._forceCoco) {
                if (await this._fallbackToCoco(err)) return this.detect(imageSource);
            }
            console.error('[YOLO] Lỗi chạy mô hình:', err);
            return null;
        }
        const outputName = this.session.outputNames[0];
        const output = results[outputName];

        const detections = this._postprocess(output, img.width, img.height, ratioX, ratioY, padX, padY);

        const inferTime = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`[YOLO] Detection done in ${inferTime}s — found ${detections.length} object(s)`);

        if (detections.length === 0) return { detections: [], bestDetection: null, croppedDataUrl: null };

        const bestDetection = detections.reduce((best, det) => {
            const detCenterX = det.bboxRel.x + det.bboxRel.width / 2;
            const detCenterY = det.bboxRel.y + det.bboxRel.height / 2;

            const dx = (detCenterX - 0.5) * 2; 
            const dy = (detCenterY - 0.5) * 2; 
            const distFromCenter = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2; 

            const centerWeight = 1.0 - distFromCenter * 0.7;

            const area = det.bboxRel.width * det.bboxRel.height;
            const areaBonus = Math.min(area * 2, 0.15); 

            det._score = det.confidence * centerWeight + areaBonus;

            const bestCenterX = best.bboxRel.x + best.bboxRel.width / 2;
            const bestCenterY = best.bboxRel.y + best.bboxRel.height / 2;
            const bdx = (bestCenterX - 0.5) * 2;
            const bdy = (bestCenterY - 0.5) * 2;
            const bestDist = Math.sqrt(bdx * bdx + bdy * bdy) / Math.SQRT2;
            const bestCenterWeight = 1.0 - bestDist * 0.7;
            const bestArea = best.bboxRel.width * best.bboxRel.height;
            const bestAreaBonus = Math.min(bestArea * 2, 0.15);
            if (!best._score) best._score = best.confidence * bestCenterWeight + bestAreaBonus;

            return det._score > best._score ? det : best;
        });

        console.log(`[YOLO] Best detection: "${bestDetection.class}" (score=${bestDetection._score?.toFixed(3)}, conf=${(bestDetection.confidence*100).toFixed(1)}%)`);

        const bestCX = bestDetection.bboxRel.x + bestDetection.bboxRel.width / 2;
        const bestCY = bestDetection.bboxRel.y + bestDetection.bboxRel.height / 2;

        const distFromCenter = Math.sqrt((bestCX - 0.5) ** 2 + (bestCY - 0.5) ** 2);

        if (distFromCenter > 0.25) {
            console.log(`[YOLO] Best "${bestDetection.class}" center=(${bestCX.toFixed(2)},${bestCY.toFixed(2)}) dist=${distFromCenter.toFixed(2)} > 0.25 → fallback to Gemini`);
            return { detections, bestDetection: null, croppedDataUrl: null, inferenceTime: parseFloat(inferTime) };
        }

        const croppedDataUrl = this._cropDetection(img, bestDetection);

        return {
            detections,
            bestDetection,
            croppedDataUrl,
            inferenceTime: parseFloat(inferTime)
        };
    },

    // Phát hiện nhanh cho video realtime: nhận canvas, không crop/không log, trả về TẤT CẢ vật thể (mảng).
    // Trả về null nếu mô hình chưa sẵn sàng.
    async detectFrame(source) {
        if (!this.isReady || !this.session) return null;
        const w = source.width;
        const h = source.height;
        if (!w || !h) return [];

        const { tensor, ratioX, ratioY, padX, padY } = this._preprocess(source);
        let results;
        try {
            results = await this.session.run({ [this.session.inputNames[0]]: tensor });
        } catch (err) {
            if (this.profileId === 'waste' && !this._forceCoco) await this._fallbackToCoco(err);
            return null;                  // khung này bỏ qua; khung sau dùng mô hình dự phòng
        }
        const output = results[this.session.outputNames[0]];
        return this._postprocess(output, w, h, ratioX, ratioY, padX, padY);
    },

    _preprocess(img) {
        if (!this._pre) {
            const c = document.createElement('canvas');
            c.width = this.inputSize;
            c.height = this.inputSize;
            this._pre = { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) };
        }
        const ctx = this._pre.ctx;

        const scale = Math.min(this.inputSize / img.width, this.inputSize / img.height);
        const newW = Math.round(img.width * scale);
        const newH = Math.round(img.height * scale);
        const padX = (this.inputSize - newW) / 2;
        const padY = (this.inputSize - newH) / 2;

        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, this.inputSize, this.inputSize);
        ctx.drawImage(img, padX, padY, newW, newH);

        const imageData = ctx.getImageData(0, 0, this.inputSize, this.inputSize);
        const pixels = imageData.data;

        const red = new Float32Array(this.inputSize * this.inputSize);
        const green = new Float32Array(this.inputSize * this.inputSize);
        const blue = new Float32Array(this.inputSize * this.inputSize);

        for (let i = 0; i < this.inputSize * this.inputSize; i++) {
            red[i] = pixels[i * 4] / 255.0;
            green[i] = pixels[i * 4 + 1] / 255.0;
            blue[i] = pixels[i * 4 + 2] / 255.0;
        }

        const tensorData = new Float32Array(3 * this.inputSize * this.inputSize);
        tensorData.set(red, 0);
        tensorData.set(green, this.inputSize * this.inputSize);
        tensorData.set(blue, 2 * this.inputSize * this.inputSize);

        const tensor = new ort.Tensor('float32', tensorData, [1, 3, this.inputSize, this.inputSize]);

        return {
            tensor,
            ratioX: img.width / newW,
            ratioY: img.height / newH,
            padX,
            padY
        };
    },


    _postprocess(output, imgWidth, imgHeight, ratioX, ratioY, padX, padY) {


        const data = output.data;
        const numDetections = output.dims[2];
        // số lớp theo đầu ra thật của mô hình ([1, 4 + số lớp, số ô]); không vượt quá danh sách tên đã khai báo
        const numClasses = Math.min(this.classNames.length, output.dims[1] - 4);

        const candidates = [];

        for (let i = 0; i < numDetections; i++) {

            let maxScore = 0;
            let maxClassIdx = 0;

            for (let c = 0; c < numClasses; c++) {
                const score = data[(4 + c) * numDetections + i];
                if (score > maxScore) {
                    maxScore = score;
                    maxClassIdx = c;
                }
            }

            if (maxScore < this.confidenceThreshold) continue;

            const className = this.classNames[maxClassIdx];
            if (this.ignoredClasses.has(className)) continue;

            const cx = data[0 * numDetections + i];
            const cy = data[1 * numDetections + i];
            const w = data[2 * numDetections + i];
            const h = data[3 * numDetections + i];

            const x1 = ((cx - w / 2) - padX) * ratioX;
            const y1 = ((cy - h / 2) - padY) * ratioY;
            const x2 = ((cx + w / 2) - padX) * ratioX;
            const y2 = ((cy + h / 2) - padY) * ratioY;

            const bx = Math.max(0, x1);
            const by = Math.max(0, y1);
            const bw = Math.min(imgWidth, x2) - bx;
            const bh = Math.min(imgHeight, y2) - by;

            if (bw <= 0 || bh <= 0) continue;

            candidates.push({
                class: this.classNames[maxClassIdx],
                classVi: this.classNameVi[this.classNames[maxClassIdx]] || this.classNames[maxClassIdx],
                classIdx: maxClassIdx,
                confidence: maxScore,
                bbox: { x: bx, y: by, w: bw, h: bh },
                bboxRel: {
                    x: bx / imgWidth,
                    y: by / imgHeight,
                    width: bw / imgWidth,
                    height: bh / imgHeight
                }
            });
        }

        return this._nms(candidates);
    },

    _nms(candidates) {
        if (candidates.length === 0) return [];

        candidates.sort((a, b) => b.confidence - a.confidence);

        const selected = [];

        while (candidates.length > 0) {
            const best = candidates.shift();
            selected.push(best);

            candidates = candidates.filter(c => {
                const iou = this._computeIoU(best.bbox, c.bbox);
                return iou < this.iouThreshold;
            });
        }

        return selected;
    },

    _computeIoU(boxA, boxB) {
        const x1 = Math.max(boxA.x, boxB.x);
        const y1 = Math.max(boxA.y, boxB.y);
        const x2 = Math.min(boxA.x + boxA.w, boxB.x + boxB.w);
        const y2 = Math.min(boxA.y + boxA.h, boxB.y + boxB.h);

        const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const areaA = boxA.w * boxA.h;
        const areaB = boxB.w * boxB.h;
        const union = areaA + areaB - intersection;

        return union > 0 ? intersection / union : 0;
    },

    _loadImage(source) {
        return new Promise((resolve) => {
            if (source instanceof HTMLImageElement) {
                if (source.complete) resolve(source);
                else {
                    source.onload = () => resolve(source);
                    source.onerror = () => resolve(null);
                }
                return;
            }

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = source;
        });
    },

    _cropDetection(img, detection) {
        const { x, y, w, h } = detection.bbox;

        const padPct = 0.1;
        const cropX = Math.max(0, x - w * padPct);
        const cropY = Math.max(0, y - h * padPct);
        const cropW = Math.min(img.width - cropX, w * (1 + 2 * padPct));
        const cropH = Math.min(img.height - cropY, h * (1 + 2 * padPct));

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(cropW);
        canvas.height = Math.round(cropH);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL('image/jpeg', 0.85);
    },

    drawDetections(imageDataUrl, detections) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                detections.forEach((det, idx) => {
                    const { x, y, w, h } = det.bbox;

                    const colors = ['#27C860', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
                    const color = det.wasteColor || colors[idx % colors.length];

                    ctx.strokeStyle = color;
                    ctx.lineWidth = Math.max(3, img.width * 0.004);
                    ctx.beginPath();
                    ctx.roundRect(x, y, w, h, 8);
                    ctx.stroke();

                    const r = parseInt(color.slice(1, 3), 16);
                    const g = parseInt(color.slice(3, 5), 16);
                    const b = parseInt(color.slice(5, 7), 16);
                    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.08)`;
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
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
                        ctx.lineTo(x3, y3);
                        ctx.stroke();
                    });

                    const label = det.displayName || `${det.classVi} ${Math.round(det.confidence * 100)}%`;
                    const fontSize = Math.max(14, img.width * 0.022);
                    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
                    const tm = ctx.measureText(label);
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
                    ctx.fillText(label, bx + px, by + badgeH / 2);
                });

                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };
            img.onerror = () => resolve(imageDataUrl);
            img.src = imageDataUrl;
        });
    },

    _updateStatusBadge(status) {
        const badge = document.getElementById('yolo-status-badge');
        if (!badge) return;

        const states = {
            loading: { text: 'Hệ thống đang tải...', color: '#F59E0B', icon: 'fa-spinner fa-spin' },
            ready: { text: 'Hệ thống sẵn sàng', color: '#27C860', icon: 'fa-check-circle' },
            error: { text: 'Lỗi hệ thống', color: '#EF4444', icon: 'fa-exclamation-circle' }
        };

        const s = states[status] || states.loading;
        badge.innerHTML = `<i class="fa-solid ${s.icon}" style="color:${s.color}"></i> <span>${s.text}</span>`;
        badge.style.display = 'flex';
    }
};

// ---- Hồ sơ mô hình ----
YoloDetector._cocoProfile = {
    id: 'coco',
    modelPath: YoloDetector.modelPath,
    inputSize: YoloDetector.inputSize,
    confidenceThreshold: YoloDetector.confidenceThreshold,
    classNames: YoloDetector.classNames,
    classNameVi: YoloDetector.classNameVi,
    ignoredClasses: YoloDetector.ignoredClasses
};

// Mô hình riêng cho rác (YOLOv8m huấn luyện 8 nhóm chất liệu, đã chuyển sang ONNX, trọng số fp16, vào 384x384).
YoloDetector._wasteProfile = {
    id: 'waste',
    modelPath: 'models/waste_384_fp16.onnx',
    inputSize: 384,
    confidenceThreshold: 0.30,
    classNames: ['cardboard', 'e-waste', 'glass', 'medical', 'metal', 'organic', 'paper', 'plastic'],
    classNameVi: {
        cardboard: 'Bìa carton', 'e-waste': 'Rác điện tử', glass: 'Thủy tinh', medical: 'Rác y tế',
        metal: 'Kim loại', organic: 'Hữu cơ', paper: 'Giấy', plastic: 'Nhựa'
    },
    ignoredClasses: new Set()
};

YoloDetector.profileId = 'coco';
window.yoloDetector = YoloDetector;

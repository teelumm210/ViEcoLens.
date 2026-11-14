// Xử lý camera
const CameraManager = {
    videoElement: null,
    stream: null,
    facingMode: 'environment',

    init() {
        this.videoElement = document.getElementById('camera-video');

        const captureBtn = document.getElementById('capture-btn');
        const flipBtn = document.getElementById('flip-camera-btn');
        const resetBtn = document.getElementById('reset-cam-btn');
        const sheetResetBtn = document.getElementById('sheet-reset-btn');
        const fileUpload = document.getElementById('file-upload');
        const uploadBtn = document.getElementById('upload-btn');

        if (captureBtn) captureBtn.addEventListener('click', () => this.captureImage());
        if (flipBtn) flipBtn.addEventListener('click', () => this.flipCamera());
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetCamera());
        if (sheetResetBtn) sheetResetBtn.addEventListener('click', () => this.resetCamera());
        if (uploadBtn) uploadBtn.addEventListener('click', () => fileUpload.click());
        if (fileUpload) fileUpload.addEventListener('change', (e) => this.handleFileUpload(e));

        const startCam = () => setTimeout(() => this.start(), 200);

        document.querySelectorAll('.nav-item[data-target="scan-screen"]').forEach(el => {
            el.addEventListener('click', startCam);
        });
        document.querySelectorAll('.nav-item:not([data-target="scan-screen"])').forEach(el => {
            el.addEventListener('click', () => this.stop());
        });

        // tự động bật cam nếu vào phần quét (chỉ khi không có welcome screen)
        if (document.getElementById('scan-screen')?.classList.contains('view-active')
            && !document.getElementById('welcome-screen')) {
            startCam();
        }
    },

    async start() {
        if (this.stream) return;
        const placeholder = document.getElementById('camera-placeholder');

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: this.facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false
            });
            this.videoElement.srcObject = this.stream;
            if (placeholder) placeholder.style.display = 'none';
        } catch (err) {
            console.error('Camera error:', err);
            if (placeholder) {
                placeholder.innerHTML = `<i class="fa-solid fa-triangle-exclamation fa-2x"></i><p style="margin-top:12px;font-weight:700">Không thể truy cập camera</p><p style="font-size:13px;opacity:0.7;margin-top:4px">Vui lòng cấp quyền và tải lại trang</p>`;
                placeholder.style.display = 'flex';
            }
        }
    },

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
            if (this.videoElement) this.videoElement.srcObject = null;
        }
    },

    flipCamera() {
        this.stop();
        this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
        this.start();
    },

    resetCamera() {
        const sheet = document.getElementById('result-sheet');
        if (sheet) {
            sheet.classList.remove('sheet-open');
            setTimeout(() => sheet.classList.add('hidden'), 400);
        }

        const video = document.getElementById('camera-video');
        const preview = document.getElementById('capture-preview');
        const captureBtn = document.getElementById('capture-btn');
        const resetBtn = document.getElementById('reset-cam-btn');
        const scanFrame = document.getElementById('scan-frame');

        if (video) video.style.display = 'block';
        if (preview) { preview.style.display = 'none'; preview.src = ''; }
        if (captureBtn) captureBtn.classList.remove('hidden');
        if (resetBtn) resetBtn.classList.add('hidden');
        if (scanFrame) scanFrame.style.display = '';

        const content = document.getElementById('analysis-content');
        const skeleton = document.getElementById('analysis-skeleton');
        if (content) content.classList.add('hidden');
        if (skeleton) skeleton.classList.remove('hidden');

        const diySection = document.getElementById('diy-section');
        if (diySection) diySection.classList.add('hidden');

        const imageCard = document.getElementById('scanned-image-card');
        if (imageCard) imageCard.classList.add('hidden');

        this.start();
    },

    captureImage() {
        if (!this.stream) return;

        const flash = document.getElementById('camera-flash');
        if (flash) {
            flash.classList.remove('hidden');
            flash.classList.add('flash-active');
            setTimeout(() => {
                flash.classList.remove('flash-active');
                flash.classList.add('hidden');
            }, 400);
        }

        const canvas = document.createElement('canvas');
        canvas.width = this.videoElement.videoWidth;
        canvas.height = this.videoElement.videoHeight;
        canvas.getContext('2d').drawImage(this.videoElement, 0, 0);

        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        this.processImage(imageDataUrl);
    },

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                const MAX_SIZE = 1200;

                if (width > height && width > MAX_SIZE) {
                    height *= MAX_SIZE / width;
                    width = MAX_SIZE;
                } else if (height > MAX_SIZE) {
                    width *= MAX_SIZE / height;
                    height = MAX_SIZE;
                }

                width = Math.round(width);
                height = Math.round(height);

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                this.processImage(compressedDataUrl);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    processImage(imageDataUrl) {
        const video = document.getElementById('camera-video');
        const preview = document.getElementById('capture-preview');
        const captureBtn = document.getElementById('capture-btn');
        const resetBtn = document.getElementById('reset-cam-btn');
        const scanFrame = document.getElementById('scan-frame');
        const sheet = document.getElementById('result-sheet');
        const skeleton = document.getElementById('analysis-skeleton');
        const content = document.getElementById('analysis-content');

        if (video) video.style.display = 'none';
        if (preview) { preview.src = imageDataUrl; preview.style.display = 'block'; }

        if (captureBtn) captureBtn.classList.add('hidden');
        if (resetBtn) resetBtn.classList.remove('hidden');

        if (scanFrame) scanFrame.style.display = 'none';


        this.stop();

        if (sheet) {
            sheet.classList.remove('hidden');
            void sheet.offsetHeight;
            sheet.classList.add('sheet-open');
        }
        if (skeleton) skeleton.classList.remove('hidden');
        if (content) content.classList.add('hidden');

        if (window.ecoState && window.ecoState.aiEngine === 'yolo_gemini') {
           
            if (window.yoloDetector && window.ecoGemini) {
                window.ecoGemini.analyzeWithYolo(imageDataUrl);
            } else if (window.ecoGemini) {
               
                console.warn('[Camera] YOLO not available, falling back to pure Gemini');
                window.ecoGemini.analyzeImage(imageDataUrl);
            }
        } else if (window.ecoState && window.ecoState.aiEngine === 'tfjs_local') {
            if (window.localTrainer) {
                window.localTrainer.predict(imageDataUrl).then(result => {
                    if (result && window.ecoGemini) {
                        if (result.tag === 'RÁC TÁI CHẾ') {
                            result.tagColor = 'var(--primary-dark)'; result.strokeColor = 'var(--primary)'; result.points = 50;
                        } else if (result.tag === 'RÁC HỮU CƠ') {
                            result.tagColor = 'var(--primary-dark)'; result.strokeColor = 'var(--primary)'; result.points = 30;
                        } else if (result.tag === 'RÁC NGUY HIỂM') {
                            result.tagColor = 'var(--danger)'; result.strokeColor = 'var(--danger)'; result.points = 100;
                        } else {
                            result.tagColor = 'var(--text-muted)'; result.strokeColor = 'var(--warning)'; result.points = 10;
                        }
                        
                        window.ecoGemini.updateResultUI(result, imageDataUrl);
                        if (window.ecoState) window.ecoState.addPoints(result.points || 10, result);
                    } else if (!result && window.ecoGemini) {
                        window.ecoGemini.showAnalysisError({message: "AI Cục Bộ chưa có dữ liệu hoặc độ tự tin quá thấp. Hãy vào Phòng Huấn Luyện AI để học thêm."});
                    }
                }).catch(err => {
                    if (window.ecoGemini) window.ecoGemini.showAnalysisError(err);
                });
            } else if (window.ecoGemini) {
                window.ecoGemini.showAnalysisError({message: "Chưa nạp module Local Trainer."});
            }
        } else {
            if (window.ecoGemini) {
                window.ecoGemini.analyzeImage(imageDataUrl);
            }
        }
    }
};

window.ecoCamera = CameraManager;

document.addEventListener('DOMContentLoaded', () => CameraManager.init());

 
document.addEventListener('DOMContentLoaded', () => {
    // ---- Welcome Screen ----
    const welcomeScreen = document.getElementById('welcome-screen');
    const startBtn = document.getElementById('welcome-start-btn');
 
    function enterApp() {
        if (!welcomeScreen || !welcomeScreen.isConnected || welcomeScreen.classList.contains('fade-out')) return;
        welcomeScreen.classList.add('fade-out');
        setTimeout(() => {
            welcomeScreen.remove();
            if (window.ecoCamera && document.getElementById('scan-screen')?.classList.contains('view-active')) {
                window.ecoCamera.start();
            }
        }, 500);
    }
    window.enterApp = enterApp;

    if (startBtn && welcomeScreen) {
        startBtn.addEventListener('click', async () => {
            // Chờ kiểm tra phiên đăng nhập trên máy chủ (rất nhanh) để không hiện form đăng nhập oan
            try { await window.ecoAuth?.ready; } catch (e) { /* bỏ qua */ }
            // Chưa đăng nhập (và chưa chọn dùng thử) -> hiện form đăng nhập / tạo tài khoản
            if (window.ecoAuth && !window.ecoAuth.isSignedIn()) {
                window.ecoAuth.showPanel();
                return;
            }
            enterApp();
        });
    }

    // ---- Navigation ----
    const desktopNavItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const mobileNavItems = document.querySelectorAll('.mobile-bottom-nav .nav-item');
    const screens = document.querySelectorAll('.screen');
 
    function navigateTo(targetId) {
        // Dừng đọc to / đang nghe khi chuyển màn hình (không gửi tin nhắn dở dang)
        window.ecoVoice?.stop();
        window.ecoSTT?.cancel();
 
        [...desktopNavItems, ...mobileNavItems].forEach(item => {
            item.classList.toggle('active', item.dataset.target === targetId);
        });
 
        screens.forEach(screen => {
            const isTarget = screen.id === targetId;
            screen.classList.toggle('view-active', isTarget);
            screen.classList.toggle('view-hidden', !isTarget);
        });
 
        if (targetId === 'scan-screen') {
            if (window.ecoCamera && !document.getElementById('welcome-screen')) {
                window.ecoCamera.start();
            }
        } else {
            window.ecoCamera?.stop();
        }
 
        if (targetId === 'leaderboard-screen') window.ecoState?.loadLeaderboard();

        if (targetId === 'map-screen') {
            if (window.EcoMapModule) window.EcoMapModule.init();
        }

        // Greeny Live dùng camera riêng: bật khi vào, tắt hẳn khi rời đi
        if (targetId === 'live-screen') window.ecoLive?.start();
        else window.ecoLive?.stop();

        // Học & Chơi: làm mới menu khi vào, dừng đồng hồ/trò chơi dở khi rời đi
        if (targetId === 'learn-screen') window.ecoLearn?.onEnter();
        else window.ecoLearn?.onLeave();
    }
 
    window.navigateTo = navigateTo;
 
   
    [...desktopNavItems, ...mobileNavItems].forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(item.dataset.target);
        });
    });
 
    const openMapBtn = document.getElementById('open-map-btn');
    const closeMapBtn = document.getElementById('close-map-btn');
    if (openMapBtn) {
        openMapBtn.addEventListener('click', () => {
            navigateTo('map-screen');
        });
    }
    if (closeMapBtn) {
        closeMapBtn.addEventListener('click', () => {
            navigateTo('scan-screen');
        });
    }
 
    const engineRadios = document.getElementsByName('ai-engine');
    
    engineRadios.forEach(r => {
        if (r.value === window.ecoState.aiEngine) {
            r.checked = true;
        }
        r.addEventListener('change', (e) => {
            const val = e.target.value;
            window.ecoState.aiEngine = val;
            localStorage.setItem('eco_ai_engine', val);
            
            if (val === 'yolo_gemini' && window.yoloDetector) {
                window.yoloDetector.init();
            } else if (val === 'tfjs_local' && window.localTrainer) {
                window.localTrainer.init();
            }
        });
    });
 
    const trainerModal = document.getElementById('trainer-modal');
    const openTrainerBtn = document.getElementById('open-trainer-btn');
    const closeTrainerBtn = document.getElementById('close-trainer-btn');
    const trainerVideo = document.getElementById('trainer-video');
    const trainerLoader = document.getElementById('trainer-loading');
    let trainerStream = null;
 
    if (openTrainerBtn && trainerModal) {
        openTrainerBtn.addEventListener('click', async () => {
             if(window.localTrainer) {
                 window.localTrainer.init().then(() => {
                     renderTrainerClasses();
                 });
             }
             
             trainerModal.classList.remove('view-hidden');
             trainerModal.classList.add('view-active');
             
             if (window.ecoCamera) window.ecoCamera.stop();
 
             try {
                trainerLoader.style.display = 'flex';
                trainerStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
                    audio: false
                });
                trainerVideo.srcObject = trainerStream;
                trainerVideo.onloadedmetadata = () => {
                    trainerLoader.style.display = 'none';
 
                    if (window.trainerLivePredictInterval) clearInterval(window.trainerLivePredictInterval);
                    window.trainerLivePredictInterval = setInterval(async () => {
                        if (window.localTrainer && window.localTrainer.isReady && window.localTrainer.classifier && window.localTrainer.classifier.getNumClasses() > 0) {
                            try {
                                const result = await window.localTrainer.predict(trainerVideo);
                                const badge = document.getElementById('live-prediction-badge');
                                const badgeName = document.getElementById('live-prediction-name');
                                const badgeConf = document.getElementById('live-prediction-conf');
                                
                                if (result && result.percentage >= 60) {
                                    badge.classList.remove('hidden');
                                    badgeName.innerText = result.name;
                                    badgeConf.innerText = result.percentage + '%';
                                } else {
                                    badge.classList.add('hidden');
                                }
                            } catch(e) {}
                        } else {
                            const badge = document.getElementById('live-prediction-badge');
                            if (badge) badge.classList.add('hidden');
                        }
                    }, 400); 
                };
             } catch(e) {
                 console.error("Trainer Cam:", e);
                 trainerLoader.innerHTML = "<p>Lỗi Camera</p>";
             }
        });
 
        closeTrainerBtn.addEventListener('click', () => {
             trainerModal.classList.add('view-hidden');
             trainerModal.classList.remove('view-active');
             if(trainerStream) {
                 trainerStream.getTracks().forEach(t => t.stop());
                 trainerStream = null;
                 trainerVideo.srcObject = null;
             }
             if (window.trainerLivePredictInterval) {
                 clearInterval(window.trainerLivePredictInterval);
             }
             const badge = document.getElementById('live-prediction-badge');
             if (badge) badge.classList.add('hidden');
        });
    }
 
    const addClassBtn = document.getElementById('trainer-add-class-btn');
    const classInput = document.getElementById('trainer-class-input');
    const classesList = document.getElementById('trainer-classes-list');
 
    window.trainIntervals = {};
    window.trainImageCounts = {};
 
    function renderTrainerClasses() {
        if(!window.localTrainer) return;
        
        let classesToRender = window.localTrainer.classes;
        if(classesToRender.length === 0) {
            classesList.innerHTML = `<div class="empty-history" style="text-align: center; color: var(--text-muted); font-size: 13px;">Chưa có nhãn rác nào. Hãy thêm nhãn mẫu để dạy AI.</div>`;
            return;
        }
 
        classesList.innerHTML = '';
        classesToRender.forEach(className => {
            if(!window.trainImageCounts[className]) window.trainImageCounts[className] = 0;
            const count = window.trainImageCounts[className];
 
            const item = document.createElement('div');
            item.className = "trainer-class-card elevated hover-lift";
            item.style.background = "var(--bg-surface)";
            item.style.padding = "16px";
            item.style.borderRadius = "16px";
            item.style.display = "flex";
            item.style.alignItems = "center";
            item.style.justifyContent = "space-between";
            item.style.border = "1px solid var(--border-medium)";
 
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(39, 200, 96, 0.1); display: flex; align-items: center; justify-content: center; color: var(--primary);">
                        <i class="fa-solid fa-cube" style="font-size: 20px;"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: var(--text-main); text-transform: capitalize;">${className}</h4>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${count > 0 ? 'var(--primary)' : 'var(--warning)'}; box-shadow: 0 0 8px ${count > 0 ? 'rgba(39,200,96,0.5)' : 'rgba(255,71,87,0.5)'};"></span>
                            <span style="font-size: 13px; color: var(--text-muted);"><b id="count-${className.replace(/\s/g, '-')}">${count}</b> mẫu học</span>
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button class="action-btn" id="btn-upload-${className.replace(/\s/g, '-')}" style="width: 38px; height: 38px; border-radius: 12px; background: var(--bg-surface); color: var(--text-muted); border: 1px solid var(--border-medium); cursor: pointer; transition: 0.2s;" title="Tải ảnh mẫu">
                        <i class="fa-solid fa-image"></i>
                    </button>
                    <button class="action-btn" id="btn-delete-${className.replace(/\s/g, '-')}" style="width: 38px; height: 38px; border-radius: 12px; background: rgba(255,71,87,0.1); color: var(--danger); border: none; cursor: pointer; transition: 0.2s;" title="Xoá Lớp Rác này">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                    <button class="record-btn pulse-button" id="btn-train-${className.replace(/\s/g, '-')}" style="width: 50px; height: 50px; border-radius: 50%; background: var(--bg-grey); border: none; outline: none; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; transition: all 0.2s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);" title="Nhấn & Giữ để Học">
                        <div class="record-circle" style="width: 38px; height: 38px; border-radius: 50%; background: var(--danger); display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 2px 8px rgba(255,71,87,0.4); transition: transform 0.2s;">
                           <i class="fa-solid fa-video" style="font-size: 14px;"></i>
                        </div>
                    </button>
                </div>
            `;
            classesList.appendChild(item);
 
            const btn = item.querySelector(`#btn-train-${className.replace(/\s/g, '-')}`);
            const deleteBtn = item.querySelector(`#btn-delete-${className.replace(/\s/g, '-')}`);
            const uploadBtn = item.querySelector(`#btn-upload-${className.replace(/\s/g, '-')}`);
            const countEl = item.querySelector(`#count-${className.replace(/\s/g, '-')}`);
 
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    if (confirm(`Bạn chắc chắn muốn xoá nhãn "${className}"? Toàn bộ mẫu huấn luyện của nhãn này sẽ bị xoá.`)) {
                        window.localTrainer.removeClass(className);
                        renderTrainerClasses();
                    }
                });
            }
 
            if (uploadBtn) {
                uploadBtn.addEventListener('click', () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.accept = 'image/*';
                    input.onchange = (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        
                        // Xử lý tuần tự ảnh
                        let countLoaded = 0;
                        for (let i = 0; i < files.length; i++) {
                            const file = files[i];
                            const reader = new FileReader();
                            reader.onload = (re) => {
                                const img = new Image();
                                img.onload = () => {
                                    window.localTrainer.addExample(img, className);
                                    window.trainImageCounts[className]++;
                                    countEl.innerText = window.trainImageCounts[className];
                                    countLoaded++;
                                    if(countLoaded === files.length) {
                                         window.localTrainer.saveClassifierState();
                                    }
                                };
                                img.src = re.target.result;
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                    input.click();
                });
            }
 
            const startRecord = () => {
                if(!window.localTrainer.isReady) return;
                const recCircle = btn.querySelector('.record-circle');
                if (recCircle) {
                    recCircle.style.transform = "scale(0.85)";
                    recCircle.style.boxShadow = "0 0 15px rgba(255,71,87,0.8)";
                }
                btn.style.transform = "scale(0.95)";
                window.trainIntervals[className] = setInterval(() => {
                    window.localTrainer.addExample(trainerVideo, className);
                    window.trainImageCounts[className]++;
                    countEl.innerText = window.trainImageCounts[className];
                }, 100);
            };
 
            const stopRecord = () => {
                const recCircle = btn.querySelector('.record-circle');
                if (recCircle) {
                    recCircle.style.transform = "scale(1)";
                    recCircle.style.boxShadow = "0 2px 8px rgba(255,71,87,0.4)";
                }
                btn.style.transform = "scale(1)";
                if(window.trainIntervals[className]) {
                    clearInterval(window.trainIntervals[className]);
                    window.localTrainer.saveClassifierState();
                }
            };
 
            btn.addEventListener('mousedown', startRecord);
            btn.addEventListener('mouseup', stopRecord);
            btn.addEventListener('mouseleave', stopRecord);
            
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecord();});
            btn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecord();});
        });
    }
 
    window.renderTrainerClasses = renderTrainerClasses;
 
    if (addClassBtn) {
        addClassBtn.addEventListener('click', () => {
            const val = classInput.value.trim();
            const tagInput = document.getElementById('trainer-class-tag');
            const tagVal = tagInput ? tagInput.value : "KHÔNG RÕ";
 
            if(!val) return;
            if(!window.localTrainer.classes.includes(val)) {
                 window.localTrainer.classes.push(val);
                 window.localTrainer.classMetadata[val] = tagVal;
                 window.trainImageCounts[val] = 0;
                 classInput.value = '';
                 renderTrainerClasses();
                 window.localTrainer.saveClassifierState();
            } else {
                 alert("Tên nhãn này đã tồn tại rồi!");
            }
        });
    }
 
    const resetTrainerBtn = document.getElementById('trainer-reset-btn');
    if (resetTrainerBtn) {
        resetTrainerBtn.addEventListener('click', () => {
             if(confirm("Bạn có chắc chắn muốn xóa toàn bộ dữ liệu huấn luyện cục bộ?")) {
                 if(window.localTrainer) window.localTrainer.resetModel();
                 window.trainImageCounts = {};
                 renderTrainerClasses();
             }
        });
    }
 
    // Model Export / Import
    const downloadModelBtn = document.getElementById('download-model-btn');
    const uploadModelBtn = document.getElementById('upload-model-btn');
    const modelUploadInput = document.getElementById('model-upload-input');
 
    if (downloadModelBtn) {
        downloadModelBtn.addEventListener('click', () => {
            if (window.localTrainer) {
                window.localTrainer.downloadModel();
            }
        });
    }
 
    if (uploadModelBtn) {
        uploadModelBtn.addEventListener('click', () => {
            if (modelUploadInput) modelUploadInput.click();
        });
    }
 
    if (modelUploadInput) {
        modelUploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && window.localTrainer) {
                window.localTrainer.uploadModel(file);
            }
            e.target.value = ''; // Reset input
        });
    }
 
});
 
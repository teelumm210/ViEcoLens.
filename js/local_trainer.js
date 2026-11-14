
const LocalTrainer = {
    classifier: null,
    mobilenetModule: null,
    isInitializing: false,
    isReady: false,
    classes: [],
    classMetadata: {}, 

    async init() {
        if (this.isInitializing || this.isReady) return true;
        this.isInitializing = true;
        
        try {
            console.log("Loading MobileNet & KNN Classifier...");
            this.classifier = knnClassifier.create();
            
            this.mobilenetModule = await mobilenet.load({version: 2, alpha: 0.5});
            this.loadClassifierState();
            
            this.isReady = true;
            this.isInitializing = false;
            console.log("Local AI Train Engine Ready.");
            return true;
        } catch(e) {
            console.error("Local Trainer Init Failed:", e);
            this.isInitializing = false;
            return false;
        }
    },

    async addExample(imageElement, classId) {
        if (!this.isReady) await this.init();
        if (!this.isReady) return;

        try {
            const img = tf.browser.fromPixels(imageElement);
            const resized = tf.image.resizeBilinear(img, [224, 224]);
            const feature = this.mobilenetModule.infer(resized, true);
            this.classifier.addExample(feature, classId);
            if (!this.classes.includes(classId)) {
                this.classes.push(classId);
            }
            img.dispose();
            resized.dispose();
        } catch(e) {
            console.error("Add Example Error:", e);
        }
    },

    async predict(imageElementUrl) {
        if (!this.isReady) await this.init();
        if (!this.isReady || this.classifier.getNumClasses() === 0) {
            console.warn("Chưa có Train data. Chuyển sang Gemini hoặc báo lỗi.");
            return null;  
        }

        const imgEl = new Image();
        imgEl.src = imageElementUrl;

        return new Promise((resolve) => {
            imgEl.onload = async () => {
                try {
                    const img = tf.browser.fromPixels(imgEl);
                    const resized = tf.image.resizeBilinear(img, [224, 224]);
                    const feature = this.mobilenetModule.infer(resized, true);
                    
                    const result = await this.classifier.predictClass(feature);
                    
                    img.dispose();
                    resized.dispose();

                    let bestLabel = result.label;
                    let bestConf = result.confidences[bestLabel];

                    setTimeout(() => {
                        resolve(this.mockResultJSON(bestLabel, bestConf));
                    }, 400); 
                } catch(err) {
                    console.error("Predict error:", err);
                    resolve(null);
                }
            };
        });
    },

    saveClassifierState() {
        if(!this.classifier || this.classifier.getNumClasses() === 0) return;
        
        let dataset = this.classifier.getClassifierDataset();
        let datasetObj = {};
        Object.keys(dataset).forEach((key) => {
            let data = dataset[key].dataSync();
            datasetObj[key] = {
                data: Array.from(data),
                shape: dataset[key].shape
            };
        });
        localStorage.setItem("eco_local_knn_v1", JSON.stringify(datasetObj));
        localStorage.setItem("eco_local_classes", JSON.stringify(this.classes));
        localStorage.setItem("eco_local_metadata", JSON.stringify(this.classMetadata));
        console.log("Đã lưu Model Cục Bộ vào Máy.");
    },

    loadClassifierState() {
        let datasetStr = localStorage.getItem("eco_local_knn_v1");
        let classesStr = localStorage.getItem("eco_local_classes");
        let metadataStr = localStorage.getItem("eco_local_metadata");
        
        if (datasetStr && classesStr) {
            try {
                let datasetObj = JSON.parse(datasetStr);
                let dataset = {};
                Object.keys(datasetObj).forEach(key => {
                    dataset[key] = tf.tensor(datasetObj[key].data, datasetObj[key].shape);
                });
                this.classifier.setClassifierDataset(dataset);
                this.classes = JSON.parse(classesStr);
                this.classMetadata = metadataStr ? JSON.parse(metadataStr) : {};
                console.log("Đã nạp Model Cục Bộ từ localStorage.");
            } catch(e) {
                console.error("Lỗi khi load model cục bộ:", e);
            }
        }
    },

    mockResultJSON(className, confidence) {
        const perc = Math.round(confidence * 100);
        let tag = "KHÔNG RÕ";
        let desc = "Dự đoán từ Trí tuệ Nhân tạo Cục Bộ (In-App Training).";
        let sug = "Model cục bộ chạy hoàn toàn Offline nên không có gợi ý chi tiết.";

        if (this.classMetadata && this.classMetadata[className]) {
             tag = this.classMetadata[className];
        }

        if (tag === "RÁC TÁI CHẾ") {
            desc = "Vật liệu có thể tái chế, giúp tiết kiệm tài nguyên.";
            sug = "Hãy rửa sạch, để khô và phân loại vào thùng rác tái chế.";
        } else if (tag === "RÁC HỮU CƠ") {
            desc = "Phân hủy nhanh, có thể làm phân bón.";
            sug = "Hãy bỏ vào thùng rác hữu cơ hoặc ủ phân xấp vi sinh trực tiếp tại nhà.";
        } else if (tag === "RÁC NGUY HIỂM") {
            desc = "Chứa hóa chất độc hại, gây hại cho môi trường.";
            sug = "Nộp cho các điểm thu gom rác thải nguy hiểm địa phương.";
        } else if (tag === "RÁC VÔ CƠ") {
            desc = "Khó phân hủy và không thể tái chế.";
            sug = "Bỏ vào thùng rác thông thường. Hạn chế sử dụng trong tương lai.";
        }

        let result = {
            tag: tag,
            name: className,
            description: desc,
            suggestion: sug,
            percentage: perc < 60 ? perc + 20 : perc, 
            diyIdeas: [
                "1. Làm đồ vật tái chế sáng tạo",
                "2. Sử dụng làm dụng cụ học tập",
                "3. Chế tạo đồ chơi thủ công"
            ],
            boundingBox: null
        };

        return result;
    },

    downloadModel() {
        if (!this.classifier || this.classifier.getNumClasses() === 0) {
            alert("Chưa có mô hình để tải về!");
            return;
        }

        let datasetStr = localStorage.getItem("eco_local_knn_v1");
        let classesStr = localStorage.getItem("eco_local_classes");

        if (!datasetStr || !classesStr) {
            alert("Không tìm thấy dữ liệu mô hình cục bộ.");
            return;
        }

        const modelData = {
            dataset: JSON.parse(datasetStr),
            classes: JSON.parse(classesStr),
            metadata: this.classMetadata || {}
        };

        const blob = new Blob([JSON.stringify(modelData)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ViGreen_LocalModel.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    uploadModel(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const modelData = JSON.parse(e.target.result);
                if (modelData.dataset && modelData.classes) {
                    localStorage.setItem("eco_local_knn_v1", JSON.stringify(modelData.dataset));
                    localStorage.setItem("eco_local_classes", JSON.stringify(modelData.classes));
                    if (modelData.metadata) {
                        localStorage.setItem("eco_local_metadata", JSON.stringify(modelData.metadata));
                    }
                    this.loadClassifierState();
                    alert("Tải mô hình thành công! Hãy vào Phòng Huấn Luyện để kiểm tra.");
                    if (window.renderTrainerClasses) {
                        window.renderTrainerClasses();
                    }
                } else {
                    alert("Cấu trúc file mô hình không hợp lệ.");
                }
            } catch (err) {
                console.error("Lỗi khi tải file mô hình:", err);
                alert("Lỗi khi đọc file mô hình. Vui lòng kiểm tra lại.");
            }
        };
        reader.readAsText(file);
    },
    
    removeClass(className) {
        if (!this.classifier) return;
        try {
            this.classifier.clearClass(className);
        } catch (e) {
            console.log("Xoá class KNN API (might fail if unsupported by specific tfjs version):", e);
        }
        this.classes = this.classes.filter(c => c !== className);
        delete this.classMetadata[className];
        this.saveClassifierState();
        console.log(`Đã xoá nhãn ${className}`);
    },

    resetModel() {
        if(this.classifier) {
            this.classifier.clearAllClasses();
        }
        this.classes = [];
        this.classMetadata = {};
        localStorage.removeItem("eco_local_knn_v1");
        localStorage.removeItem("eco_local_classes");
        localStorage.removeItem("eco_local_metadata");
    }
};

window.localTrainer = LocalTrainer;

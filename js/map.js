const EcoMapModule = {
    map: null,
    markers: [], 
    reports: [],

    init() {
        if (this.map) return; 

        this.map = L.map('eco-map-container').setView([14.0583, 108.2772], 6);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(this.map);

        this.loadReports();

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                this.map.flyTo([lat, lng], 15);
                
                L.marker([lat, lng]).addTo(this.map)
                    .bindPopup("<b>Vị trí của bạn</b>").openPopup();
                
                window.currentLocation = {lat, lng};
            }, () => {
                console.log("Giới hạn vị trí.");
            });
        }
    },

    loadReports() {
        const saved = localStorage.getItem("eco_map_reports");
        if (saved) {
            this.reports = JSON.parse(saved);
        } else {
            // Mẫu demo giả lập 1 số điểm
            this.reports = [
                { id: "1", lat: 10.762622, lng: 106.660172, type: 'pollution', desc: 'Bãi rác tự phát', timestamp: Date.now() - 100000 },
                { id: "2", lat: 21.028511, lng: 105.804817, type: 'cleaned', desc: 'Vừa dọn dẹp', timestamp: Date.now() - 200000 }
            ];
            this.saveReports();
        }
        this.renderMarkers();
    },

    saveReports() {
        localStorage.setItem("eco_map_reports", JSON.stringify(this.reports));
    },

    createRedIcon() {
        return new L.Icon({
          iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41]
        });
    },

    createGreenIcon() {
        return new L.Icon({
          iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41]
        });
    },

    renderMarkers() {
        this.markers.forEach(m => this.map.removeLayer(m));
        this.markers = [];

        this.reports.forEach(report => {
            const icon = report.type === 'pollution' ? this.createRedIcon() : this.createGreenIcon();
            const marker = L.marker([report.lat, report.lng], { icon }).addTo(this.map);
            
            const popupContent = document.createElement('div');
            if (report.type === 'pollution') {
                let imgHtml = report.imgBase64 ? `<img src="${report.imgBase64}" style="width: 100%; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 8px;">` : '';
                popupContent.innerHTML = `
                    <div style="text-align:center; min-width: 140px;">
                        ${imgHtml}
                        <h3 style="margin-bottom:4px;font-size:15px;color:var(--danger)">Điểm đen ô nhiễm</h3>
                        <p style="margin-bottom:10px;font-size:12px;color:var(--text-main)">${report.desc || 'Cần dọn dẹp'}</p>
                        <button class="action-btn btn-primary" style="width: 100%; padding: 6px 12px; font-size:12px; border-radius: 6px; border:none; color:white; background:var(--primary-gradient);" onclick="EcoMapModule.markCleaned('${report.id}')">
                            <i class="fa-solid fa-broom"></i> Đã Dọn Xong
                        </button>
                    </div>
                `;
            } else {
                let imgHtml = report.imgBase64 ? `<img src="${report.imgBase64}" style="width: 100%; height: 100px; object-fit: cover; border-radius: 8px; margin-bottom: 8px; opacity: 0.8; filter: grayscale(50%);">` : '';
                popupContent.innerHTML = `
                    <div style="text-align:center; min-width: 140px;">
                        ${imgHtml}
                        <h3 style="margin-bottom:4px;font-size:15px;color:var(--primary)">Đã xử lý</h3>
                        <p style="margin-bottom:0;font-size:12px;color:var(--text-muted)">Đã được dọn dẹp bởi người dùng.</p>
                    </div>
                `;
            }
            
            marker.bindPopup(popupContent);
            this.markers.push(marker);
        });
    },

    addReport(lat, lng, desc, imgBase64) {
        const newReport = {
            id: Date.now().toString(),
            lat,
            lng,
            desc,
            imgBase64: imgBase64 || null,
            type: 'pollution',
            timestamp: Date.now()
        };
        this.reports.push(newReport);
        this.saveReports();
        this.renderMarkers();
        this.map.flyTo([lat, lng], 16);
    },

    markCleaned(id) {
        const rep = this.reports.find(r => r.id === id);
        if (rep) {
            rep.type = 'cleaned';
            this.saveReports();
            this.renderMarkers();
            
            alert("Tuyệt vời! Cảm ơn hành động dọn dẹp bảo vệ môi trường của bạn.");
        }
    }
};

window.EcoMapModule = EcoMapModule;

// Tương tác giao diện báo cáo
document.addEventListener('DOMContentLoaded', () => {
    const pinToMapBtn = document.getElementById('pin-to-map-btn');
    
    if (pinToMapBtn) {
        pinToMapBtn.addEventListener('click', () => {
            if (!window.currentLocation) {
                // Thêm tọa độ mock nếu chưa có GPS
                window.currentLocation = {lat: 10.762622, lng: 106.660172}; 
            }
            if (!window.currentMapReportImage) {
                alert("Ảnh nội dung bị lỗi hoặc không tồn tại.");
                return;
            }

            EcoMapModule.addReport(
                window.currentLocation.lat, 
                window.currentLocation.lng, 
                window.currentMapReportDesc || "Vật thể", 
                window.currentMapReportImage
            );
            
            const sheet = document.getElementById('result-sheet');
            if (sheet) {
                sheet.classList.remove('sheet-open');
                setTimeout(() => sheet.classList.add('hidden'), 400);
            }
            
            alert("Ghi nhận bản đồ thành công!");
            if(window.navigateTo) window.navigateTo('map-screen');
        });
    }
});

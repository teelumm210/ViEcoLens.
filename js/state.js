const StateManager = {
    points: 3370,
    history: [],
    pieChartInstance: null,
    barChartInstance: null,
    
    aiEngine: localStorage.getItem('eco_ai_engine') || 'yolo_gemini',
 
    // Cài đặt giọng nói: voice.js đọc/ghi trực tiếp đối tượng này (cùng khóa localStorage)
    // Tài khoản đang đăng nhập: { username, displayName } hoặc null (khách, dữ liệu không được lưu)
    currentUser: null,

    voice: {
        autoSpeak: localStorage.getItem('eco_voice_auto') === '1',
        rate: parseFloat(localStorage.getItem('eco_voice_rate')) || 0.9,
        autoSend: localStorage.getItem('eco_voice_autosend_v2') === '1',   // mặc định TẮT: người dùng tự bấm Gửi
        engine: localStorage.getItem('eco_voice_engine') || 'auto',      // auto | device | gemini
        deviceVoice: localStorage.getItem('eco_voice_device') || '',     // '' = tự chọn giọng tiếng Việt tốt nhất
        geminiVoice: localStorage.getItem('eco_voice_gvoice') || 'Kore'
    },
 
    RANKS: [
        { min: 0, title: 'Tân Binh Xanh' },
        { min: 500, title: 'Người Bảo Vệ' },
        { min: 1000, title: 'Chiến Thần Xanh' },
        { min: 2500, title: 'Siêu Anh Hùng' },
        { min: 5000, title: 'Huyền Thoại Eco' },
    ],
 
    init() {
        this._emptyHistoryHtml = document.getElementById('activity-list')?.innerHTML || '';
        this.updateAllUI();
        this.loadLeaderboard();
        this.initChart();
    },
 
    getRankTitle(pts) {
        let title = this.RANKS[0].title;
        for (const r of this.RANKS) {
            if (pts >= r.min) title = r.title;
        }
        return title;
    },
 
    addPoints(amount, itemData) {
        this.points += amount;
        if (itemData) {
            // Chỉ giữ các trường cần thiết (gọn để lưu được vào tài khoản)
            this.history.unshift({
                name: itemData.name,
                tag: itemData.tag,
                icon: itemData.icon,
                amount,
                time: new Date()
            });
        }
        this.updateAllUI();
        this.showPointsBadge(amount);
        if (itemData) {
            this.prependToHistory(itemData, amount);
            this.updateChart();
        }
        window.ecoAuth?.persist(this);
    },
 
    updateAllUI() {
        const formatted = this.points.toLocaleString('vi-VN');
 
        // thanh điều hướng
        const sidebarEl = document.getElementById('sidebar-points');
        if (sidebarEl) sidebarEl.innerText = `${formatted} Điểm`;

        const nameEl = document.getElementById('sidebar-user-name');
        if (nameEl) nameEl.textContent = this.displayName();
 
        // Camera chip
        const camEl = document.getElementById('cam-points-value');
        if (camEl) camEl.innerText = formatted;
 
        // hồ sơ cá nhân
        const profileEl = document.getElementById('profile-total-points');
        if (profileEl) profileEl.innerText = formatted;
 
        // danh hiệu
        const rankEl = document.getElementById('user-rank-title');
        if (rankEl) rankEl.innerText = this.getRankTitle(this.points);
 
        // bảng xếp hạng
        const lbEl = document.getElementById('leaderboard-user-points');
        if (lbEl) lbEl.innerHTML = `${formatted} <i class="fa-solid fa-leaf text-green"></i>`;
 
        this.renderLeaderboard([
            { id: 1, name: 'Nguyễn Anh', points: 3450, avatar: 'https://i.pravatar.cc/150?u=13' },
            { id: 2, name: this.displayName(), points: this.points, avatar: null, isCurrent: true },
            { id: 3, name: 'Trần Linh', points: 980, avatar: 'https://i.pravatar.cc/150?u=4' },
            { id: 4, name: 'Bảo Trâm', points: 850, avatar: 'https://i.pravatar.cc/150?u=5' },
            { id: 5, name: 'Nguyễn Lâm', points: 720, avatar: 'https://i.pravatar.cc/150?u=2' },
        ], 2);
    },
 
    showPointsBadge(amount) {
        const badge = document.getElementById('points-earned-badge');
        const val = document.getElementById('earned-points-value');
        if (!badge || !val) return;
 
        val.innerText = amount;
        badge.classList.remove('hidden');
        badge.style.transition = '';
        badge.style.opacity = '0';
        badge.style.transform = 'translateY(20px)';
 
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                badge.style.transition = 'all 0.4s cubic-bezier(0.34,1.56,0.64,1)';
                badge.style.opacity = '1';
                badge.style.transform = 'translateY(0)';
            });
        });
 
        setTimeout(() => {
            badge.style.opacity = '0';
            badge.style.transform = 'translateY(-16px)';
            setTimeout(() => badge.classList.add('hidden'), 400);
        }, 3000);
    },
 
    // ---- Học & Chơi: EXP từ quiz / mini game (giới hạn mỗi ngày để không "cày" điểm) ----
    LEARN_DAILY_CAP: 300,

    isLearnTag(tag) {
        return tag === 'QUIZ' || tag === 'MINIGAME';
    },

    learnKey() {
        return 'eco_learn_' + (this.currentUser?.username || 'guest');
    },

    learnToday() {
        const day = new Date().toLocaleDateString('en-CA');           // YYYY-MM-DD theo giờ địa phương
        let rec = null;
        try { rec = JSON.parse(localStorage.getItem(this.learnKey())); } catch (e) { /* bỏ qua */ }
        if (!rec || rec.date !== day) rec = { date: day, earned: 0 };
        return rec;
    },

    learnQuota() {
        return Math.max(0, this.LEARN_DAILY_CAP - this.learnToday().earned);
    },

    // Cộng EXP học tập, tối đa bằng hạn mức còn lại trong ngày. Trả về số EXP thực sự được cộng.
    addLearnExp(amount, itemData) {
        const grant = Math.min(Math.max(0, Math.floor(Number(amount) || 0)), this.learnQuota());
        if (grant <= 0) return 0;
        const rec = this.learnToday();
        rec.earned += grant;
        try { localStorage.setItem(this.learnKey(), JSON.stringify(rec)); } catch (e) { /* bỏ qua */ }
        this.addPoints(grant, itemData);
        return grant;
    },

    displayName() {
        return this.currentUser?.displayName || 'Guest';
    },

    // Nạp dữ liệu của một tài khoản (điểm + lịch sử) vào giao diện
    loadAccount(acc) {
        this.currentUser = { username: acc.username, displayName: acc.displayName || acc.username };
        this.points = Number(acc.points) || 0;
        this.history = (acc.history || []).map(h => ({ ...h, time: new Date(h.time) }));
        this.renderHistory();
        this.updateAllUI();
        this.updateChart();
    },

    escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    },

    timeAgo(t) {
        const d = t instanceof Date ? t : new Date(t);
        const sec = (Date.now() - d.getTime()) / 1000;
        if (isNaN(sec) || sec < 60) return 'Vừa xong';
        if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
        if (sec < 86400) return `${Math.floor(sec / 3600)} giờ trước`;
        return `${Math.floor(sec / 86400)} ngày trước`;
    },

    historyItemHtml(item, timeLabel) {
        const icon = /^fa-[a-z0-9-]+$/.test(item.icon || '') ? item.icon : 'fa-trash';
        return `
            <div class="activity-item">
                <div class="icon-box"><i class="fa-solid ${icon}"></i></div>
                <div class="details">
                    <h4>${this.escapeHtml(item.name)}</h4>
                    <p>${timeLabel}</p>
                </div>
                <div class="score-increase">+${Number(item.amount) || 0}</div>
            </div>`;
    },

    renderHistory() {
        const list = document.getElementById('activity-list');
        if (!list) return;
        if (!this.history.length) {
            if (this._emptyHistoryHtml) list.innerHTML = this._emptyHistoryHtml;
            return;
        }
        list.innerHTML = this.history.map(h => this.historyItemHtml(h, this.timeAgo(h.time))).join('');
    },

    prependToHistory(itemData, amount) {
        const list = document.getElementById('activity-list');
        if (!list) return;

        list.querySelector('.empty-history')?.remove();
        list.insertAdjacentHTML('afterbegin', this.historyItemHtml({ ...itemData, amount }, 'Vừa xong'));
    },

    initChart() {
        const pieCtx = document.getElementById('pieChart');
        const barCtx = document.getElementById('barChart');
        if (!pieCtx || !barCtx) return;
 
        const chartColors = ['#27C860', '#1E9F4A', '#FF4757', '#737887'];
        this.pieChartInstance = new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: ['Tái chế', 'Hữu cơ', 'Nguy hiểm', 'Vô cơ'],
                datasets: [{
                    data: [0, 0, 0, 0],
                    backgroundColor: chartColors,
                    borderWidth: 0,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 16,
                            usePointStyle: true,
                            font: { family: 'Inter', size: 12, weight: '600' }
                        }
                    }
                }
            }
        });
        this.barChartInstance = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: ['Tái chế', 'Hữu cơ', 'Nguy hiểm', 'Vô cơ'],
                datasets: [{
                    label: 'Số lượng thu thập',
                    data: [0, 0, 0, 0],
                    backgroundColor: chartColors,
                    borderRadius: 6,
                    barPercentage: 0.6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, precision: 0, font: { family: 'Inter', size: 11 } },
                        grid: { color: 'rgba(0,0,0,0.04)' },
                        border: { display: false }
                    },
                    x: {
                        ticks: { font: { family: 'Inter', size: 11, weight: '600' } },
                        grid: { display: false },
                        border: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
 
        this.updateChart();
    },
 
    updateChart() {
        if (!this.pieChartInstance || !this.barChartInstance) return;
 
        let counts = { 'Tái chế': 0, 'Hữu cơ': 0, 'Nguy hiểm': 0, 'Vô cơ': 0 };
 
        // Quiz / mini game không tính vào thống kê loại rác
        const scanned = this.history.filter(i => !this.isLearnTag(i.tag));
        for (const item of scanned) {
            if (item.tag === 'RÁC TÁI CHẾ') counts['Tái chế']++;
            else if (item.tag === 'RÁC HỮU CƠ') counts['Hữu cơ']++;
            else if (item.tag === 'RÁC NGUY HIỂM') counts['Nguy hiểm']++;
            else counts['Vô cơ']++;
        }
 
        const hasData = scanned.length > 0;
        const dataArr = [counts['Tái chế'], counts['Hữu cơ'], counts['Nguy hiểm'], counts['Vô cơ']];
 
        this.pieChartInstance.data.datasets[0].data = hasData ? dataArr : [1];
        if (!hasData) {
            this.pieChartInstance.data.datasets[0].backgroundColor = ['#E2E4E9']; // grey
            this.pieChartInstance.data.labels = ['Chưa có dữ liệu'];
            this.pieChartInstance.options.plugins.legend.display = false;
        } else {
            this.pieChartInstance.data.labels = ['Tái chế', 'Hữu cơ', 'Nguy hiểm', 'Vô cơ'];
            this.pieChartInstance.data.datasets[0].backgroundColor = ['#27C860', '#1E9F4A', '#FF4757', '#737887'];
            this.pieChartInstance.options.plugins.legend.display = true;
        }
        this.pieChartInstance.update();
 
        this.barChartInstance.data.datasets[0].data = dataArr;
        this.barChartInstance.update();
    },
 
    // ---- Leaderboard ----
    async loadLeaderboard() {
        try {
            const res = await fetch('/api/leaderboard');
            const data = await res.json();
            this.renderLeaderboard(data.leaderboard, data.currentUserRank);
        } catch (e) {
            console.warn('Could not load leaderboard from API, using defaults');
            this.renderLeaderboard([
                { id: 1, name: 'Nguyễn Anh', points: 3450, avatar: 'https://i.pravatar.cc/150?u=13' },
                { id: 2, name: this.displayName(), points: this.points, avatar: null, isCurrent: true },
                { id: 3, name: 'Trần Linh', points: 980, avatar: 'https://i.pravatar.cc/150?u=4' },
                { id: 4, name: 'Bảo Trâm', points: 850, avatar: 'https://i.pravatar.cc/150?u=5' },
                { id: 5, name: 'Nguyễn Lâm', points: 720, avatar: 'https://i.pravatar.cc/150?u=2' },
            ], 2);
        }
    },
 
    renderLeaderboard(users, currentRank) {
 
        users = users.map(u => u.isCurrent ? { ...u, points: this.points } : u);
        const sorted = [...users].sort((a, b) => b.points - a.points);
 
        const podium = document.getElementById('podium-section');
        if (podium) {
            const top3 = sorted.slice(0, 3);
            const display = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;
            const rankClasses = top3.length >= 3 ? ['rank-2', 'rank-1', 'rank-3'] : ['rank-1', 'rank-2', 'rank-3'];
            const sizes = top3.length >= 3 ? ['normal', 'large', 'normal'] : ['large', 'normal', 'normal'];
 
            podium.innerHTML = display.map((user, i) => {
                const rankIdx = top3.indexOf(user);
                const avatarHtml = user.avatar && user.avatar.startsWith('http')
                    ? `<img src="${user.avatar}" alt="${user.name}">`
                    : `<i class="fa-regular fa-user" style="color:var(--primary-dark)"></i>`;
                const crownHtml = rankIdx === 0 ? `<div class="podium-crown">👑</div>` : '';
                const rankLabel = rankIdx + 1;
                return `
                    <div class="podium-item">
                        ${crownHtml}
                        <div class="podium-avatar ${user.isCurrent ? 'bg-light-green' : 'bg-light-green'}" 
                             style="${sizes[i] === 'large' ? 'width:68px;height:68px;' : ''}">${avatarHtml}</div>
                        <div class="podium-name">${user.isCurrent ? 'Bạn' : user.name.split(' ').pop()}</div>
                        <div class="podium-score">${user.points.toLocaleString('vi-VN')}</div>
                        <div class="podium-rank-badge ${rankClasses[i]}">${rankLabel}</div>
                    </div>
                `;
            }).join('');
        }
 
        const list = document.getElementById('leaderboard-list');
        if (list) {
            const rest = sorted.slice(3);
            if (rest.length === 0) { list.style.display = 'none'; }
            else {
                list.style.display = '';
                list.innerHTML = rest.map((user, i) => {
                    const rank = i + 4;
                    const avatarHtml = user.avatar && user.avatar.startsWith('http')
                        ? `<img src="${user.avatar}" alt="${user.name}">`
                        : `<i class="fa-regular fa-user"></i>`;
                    return `
                        <div class="board-item ${user.isCurrent ? 'highlight-user border-green' : ''}">
                            <div class="rank-num text-muted">${rank}</div>
                            <div class="user-avatar ${user.isCurrent ? 'bg-light-green text-green' : 'bg-light-green'}">${avatarHtml}</div>
                            <div class="user-name">${user.isCurrent ? 'Bạn' : user.name}</div>
                            <div class="user-score ${user.isCurrent ? 'text-green' : ''}">
                                ${user.points.toLocaleString('vi-VN')} <i class="fa-solid fa-leaf text-green"></i>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
 
        const banner = document.getElementById('current-rank-banner');
        const rankText = document.getElementById('current-rank-text');
        if (banner && rankText) {
            const myRank = sorted.findIndex(u => u.isCurrent) + 1 || currentRank;
            rankText.innerText = `#${myRank}`;
        }
    }
};
 
window.ecoState = StateManager;
 
document.addEventListener('DOMContentLoaded', () => StateManager.init());

// Điểm "độ thân thiện môi trường" CỐ ĐỊNH theo nhóm rác: cùng một nhóm luôn ra cùng một tỉ lệ %
// (ở cả chế độ chụp lẫn Greeny Live), không còn để AI tự đoán mỗi lần một số khác nhau.
window.ecoScore = (() => {
    const BY_TAG = { 'RÁC TÁI CHẾ': 85, 'RÁC HỮU CƠ': 70, 'RÁC NGUY HIỂM': 15, 'RÁC VÔ CƠ': 50 };
    const BY_GROUP = { tai_che: 85, huu_co: 70, nguy_hiem: 15, vo_co: 50 };
    const norm = (t) => String(t || '').toUpperCase().replace(/\s+/g, ' ').trim();
    return {
        forTag: (tag) => BY_TAG[norm(tag)] ?? 50,
        forGroup: (g) => BY_GROUP[g] ?? 50
    };
})();

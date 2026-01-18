// --- Constants & Config ---
const ROUND_STEP = 0.5;

// --- Data Models & State ---
const state = {
    currentView: 'list',
    selectedTargetId: null,
    targets: [],
    exclusionDates: [], // Array of YYYY-MM-DD strings
    weeklyHours: {
        mon: 4, tue: 4, wed: 4, thu: 4, fri: 4,
        sat: 10, sun: 11
    }
};

// --- Storage ---
const storage = {
    save: () => {
        localStorage.setItem('timemark_data', JSON.stringify({
            targets: state.targets,
            exclusionDates: state.exclusionDates,
            weeklyHours: state.weeklyHours
        }));
    },
    load: () => {
        const data = localStorage.getItem('timemark_data');
        if (data) {
            const parsed = JSON.parse(data);
            state.targets = parsed.targets || [];
            state.exclusionDates = parsed.exclusionDates || [];
            state.weeklyHours = parsed.weeklyHours || state.weeklyHours;
        }
    }
};

// --- Utils: Time Calculation ---
const timeUtils = {
    /**
     * Get start of day (00:00:00.000)
     */
    startOfDay: (date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    },

    /**
     * Calculate calendar days difference (Target day is 0)
     */
    calcCalendarDays: (baseDate, targetDate) => {
        const start = timeUtils.startOfDay(baseDate);
        const end = timeUtils.startOfDay(targetDate);
        if (!start || !end || isNaN(start) || isNaN(end)) return 0;
        const diff = end.getTime() - start.getTime();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    },

    /**
     * Check if a date is excluded
     */
    isExcluded: (date) => {
        const dateStr = date.toISOString().split('T')[0];
        return state.exclusionDates.includes(dateStr);
    },

    /**
     * Calculate working days difference
     */
    calcWorkingDays: (baseDate, targetDate) => {
        let count = 0;
        let current = timeUtils.startOfDay(baseDate);
        const end = timeUtils.startOfDay(targetDate);
        if (!current || !end || isNaN(current) || isNaN(end)) return 0;

        while (current < end) {
            if (!timeUtils.isExcluded(current)) {
                count++;
            }
            current.setDate(current.getDate() + 1);
        }
        return count;
    },

    /**
     * Calculate total available hours
     */
    calcTotalHours: (baseDate, targetDate) => {
        let total = 0;
        let current = timeUtils.startOfDay(baseDate);
        const end = timeUtils.startOfDay(targetDate);
        if (!current || !end || isNaN(current) || isNaN(end)) return 0;

        const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

        while (current < end) {
            if (!timeUtils.isExcluded(current)) {
                const dayName = dayMap[current.getDay()];
                total += state.weeklyHours[dayName];
            }
            current.setDate(current.getDate() + 1);
        }
        return total;
    },

    /**
     * Distribute hours to tasks based on weights
     */
    allocateTaskHours: (totalHours, tasks) => {
        if (tasks.length === 0) return [];

        let totalWeight = tasks.reduce((sum, t) => sum + (t.weight || 0), 0);

        // If all weights are 0, distribute equally
        const useEqual = totalWeight === 0;

        let allocated = tasks.map(t => {
            const weight = useEqual ? 1 : (t.weight || 0);
            let rawHours = (weight / (useEqual ? tasks.length : totalWeight)) * totalHours;
            // Round to 0.5 step
            return {
                ...t,
                hours: Math.round(rawHours / ROUND_STEP) * ROUND_STEP
            };
        });

        // Adjust rounding error by giving it to the task with highest weight
        let currentTotal = allocated.reduce((sum, t) => sum + t.hours, 0);
        let diff = totalHours - currentTotal;

        if (diff !== 0 && allocated.length > 0) {
            const sortedByWeight = [...allocated].sort((a, b) => b.weight - a.weight);
            sortedByWeight[0].hours = Math.max(0, sortedByWeight[0].hours + diff);
        }

        return allocated;
    }
};

// --- View Rendering ---
const views = {
    list: {
        init: () => {
            console.log('Initializing List View');
            renderList();
        },
        destroy: () => { }
    },
    detail: {
        init: (id) => {
            const target = state.targets.find(t => t.id === id);
            if (!target) {
                switchView('list');
                return;
            }
            state.selectedTargetId = id;
            console.log('Initializing Detail View for', target.name);
            renderDetail(target);
        },
        destroy: () => { }
    },
    road: {
        init: () => {
            console.log('Initializing Road View');
            renderRoad();
        },
        destroy: () => { }
    }
};

function renderDetail(target) {
    const detailContainer = document.getElementById('detail-view');
    if (!detailContainer) return;

    const baseDateStr = localStorage.getItem(`base_date_${target.id}`) || new Date().toISOString().split('T')[0];
    const baseDate = new Date(baseDateStr);
    const targetDate = new Date(target.targetDate);
    const totalHours = timeUtils.calcTotalHours(baseDate, targetDate);

    // Allocate hours to tasks
    const tasksWithHours = timeUtils.allocateTaskHours(totalHours, target.tasks);

    detailContainer.innerHTML = `
        <header class="detail-header">
            <button class="btn btn-ghost" onclick="switchView('list')" style="padding-left: 0; margin-bottom: 16px;">← 戻る</button>
            <h1 style="color: ${target.color}">${target.name}</h1>
            <div class="total-hours-hero glow-text">あと ${totalHours} 時間</div>
            <div class="base-date-selector">
                基準日: <input type="date" id="base-date-input" value="${baseDateStr}">
            </div>
        </header>

        <section class="task-section">
            <div class="task-section-header">
                <h2>タスク配分</h2>
                <button class="btn btn-ghost" id="reset-weights-btn">均等に戻す</button>
            </div>
            <div class="task-list" id="detail-task-list">
                ${tasksWithHours.map(task => `
                    <div class="task-item">
                        <div class="task-header">
                            <span class="task-title">${task.title}</span>
                            <span class="task-hours">${task.hours}h</span>
                        </div>
                        <div class="weight-control">
                            <input type="range" class="weight-slider" data-task-id="${task.id}" min="0" max="10" value="${task.weight}">
                            <span class="weight-value">${task.weight}</span>
                        </div>
                    </div>
                `).join('')}
                <div class="task-item" style="border-style: dashed; display: flex; justify-content: center; cursor: pointer;" id="add-task-item">
                    <span style="color: var(--text-sub)">+ タスクを追加</span>
                </div>
            </div>
        </section>
    `;

    // Event Listeners
    detailContainer.querySelector('#base-date-input').onchange = (e) => {
        localStorage.setItem(`base_date_${target.id}`, e.target.value);
        renderDetail(target);
    };

    detailContainer.querySelectorAll('.weight-slider').forEach(slider => {
        slider.oninput = (e) => {
            const taskId = e.target.dataset.taskId;
            const weight = parseInt(e.target.value);
            const task = target.tasks.find(t => t.id === taskId);
            if (task) {
                task.weight = weight;
                storage.save();
                renderDetail(target);
            }
        };
    });

    detailContainer.querySelector('#reset-weights-btn').onclick = () => {
        target.tasks.forEach(t => t.weight = 1);
        storage.save();
        renderDetail(target);
    };

    detailContainer.querySelector('#add-task-item').onclick = () => {
        const title = prompt('タスク名を入力してください');
        if (title) {
            target.tasks.push({
                id: crypto.randomUUID(),
                title: title,
                weight: 1
            });
            storage.save();
            renderDetail(target);
        }
    };
}

function renderList() {
    const listContainer = document.getElementById('target-list');
    if (!listContainer) return;

    if (state.targets.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>ターゲットがありません。<br>右下の「＋」から追加してください。</p>
            </div>
        `;
        return;
    }

    const today = new Date();
    listContainer.innerHTML = state.targets.map(target => {
        const targetDate = new Date(target.targetDate);
        const calDays = timeUtils.calcCalendarDays(today, targetDate);
        const workDays = timeUtils.calcWorkingDays(today, targetDate);

        return `
            <div class="card target-card" onclick="switchView('detail', '${target.id}')">
                <div class="target-info">
                    <h3 style="color: ${target.color}">${target.name}</h3>
                    <p>${target.targetDate}</p>
                </div>
                <div class="target-days">
                    <div class="days-main glow-text">あと ${calDays}日</div>
                    <div class="days-sub">稼働日: ${workDays}日</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderRoad() {
    const roadContainer = document.getElementById('road-view');
    if (!roadContainer) return;

    if (state.targets.length === 0) {
        roadContainer.innerHTML = '<h1 class="glow-text">Time Road</h1><div class="empty-state">ターゲットがありません。</div>';
        return;
    }

    const today = timeUtils.startOfDay(new Date());

    let roadHtml = '<h1 class="glow-text">Time Road</h1>';

    state.targets.forEach(target => {
        const start = timeUtils.startOfDay(new Date(target.createdAt || Date.now()));
        const end = timeUtils.startOfDay(new Date(target.targetDate));

        // 全期間の計算（今日が含まれるように範囲を調整）
        const totalRangeStart = new Date(Math.min(start, today));
        const totalRangeEnd = new Date(Math.max(end, today));
        const totalRangeDays = timeUtils.calcCalendarDays(totalRangeStart, totalRangeEnd);

        const getX = (date) => {
            const days = timeUtils.calcCalendarDays(totalRangeStart, date);
            return (days / totalRangeDays) * 100;
        };

        const todayX = getX(today);
        const startX = getX(start);
        const endX = getX(end);

        // マイルストーンの生成
        const milestones = [];
        const totalDays = timeUtils.calcCalendarDays(start, end);

        if (totalDays > 0) {
            // 比例マイルストーン (10%, 25%, 50%, 75%, 90%)
            [0.1, 0.25, 0.5, 0.75, 0.9].forEach(ratio => {
                const mDate = new Date(start);
                mDate.setDate(start.getDate() + Math.round(totalDays * ratio));
                const remaining = timeUtils.calcCalendarDays(mDate, end);
                milestones.push({
                    x: getX(mDate),
                    label: `${Math.round(ratio * 100)}%`,
                    dateLabel: `${mDate.getMonth() + 1}/${mDate.getDate()}`,
                    remaining: remaining,
                    type: 'ratio'
                });
            });

            // カウントダウンマイルストーン (残り10日、残り1週間)
            const d10 = new Date(end); d10.setDate(end.getDate() - 10);
            if (d10 > start) milestones.push({
                x: getX(d10),
                label: '残り10日',
                dateLabel: `${d10.getMonth() + 1}/${d10.getDate()}`,
                remaining: 10,
                type: 'count'
            });

            const w1 = new Date(end); w1.setDate(end.getDate() - 7);
            if (w1 > start) milestones.push({
                x: getX(w1),
                label: '残り1週',
                dateLabel: `${w1.getMonth() + 1}/${w1.getDate()}`,
                remaining: 7,
                type: 'count'
            });

            // 月替わり
            let cur = new Date(totalRangeStart);
            while (cur <= totalRangeEnd) {
                if (cur.getDate() === 1) {
                    const remaining = timeUtils.calcCalendarDays(cur, end);
                    milestones.push({
                        x: getX(cur),
                        label: `${cur.getMonth() + 1}月`,
                        dateLabel: '1日',
                        remaining: remaining > 0 ? remaining : null,
                        type: 'month'
                    });
                }
                cur.setDate(cur.getDate() + 1);
            }
        }

        roadHtml += `
            <div class="road-item-container">
                <div class="road-target-name" style="color: ${target.color}">${target.name}</div>
                <div class="proportional-road">
                    <div class="road-bar-bg"></div>
                    <div class="road-progress-fill" style="background: ${target.color}; left: ${startX}%; width: ${todayX - startX}%"></div>
                    
                    <!-- Major Points -->
                    <div class="road-point start" style="left: ${startX}%">
                        <span class="point-label">開始</span>
                        <span class="point-date">${start.getMonth() + 1}/${start.getDate()}</span>
                        <span class="point-rem">あと${totalDays}日</span>
                    </div>
                    <div class="road-point today" style="left: ${todayX}%"><div class="orb"></div></div>
                    <div class="road-point end" style="left: ${endX}%" style="border-color: ${target.color}">
                        <span class="point-label">ゴール</span>
                        <span class="point-date">${end.getMonth() + 1}/${end.getDate()}</span>
                    </div>

                    <!-- Milestones -->
                    ${milestones.map(m => `
                        <div class="road-tick ${m.type}" style="left: ${m.x}%">
                            <span class="tick-label">${m.label}</span>
                            <span class="tick-date">${m.dateLabel}</span>
                            ${m.remaining !== null ? `<span class="tick-rem">あと${m.remaining}日</span>` : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="road-stats-row">
                    <span>開始日: ${start.toLocaleDateString()}</span>
                    <span>今日: ${today.toLocaleDateString()}</span>
                    <span>目標日: ${end.toLocaleDateString()}</span>
                </div>
            </div>
        `;
    });

    roadContainer.innerHTML = roadHtml;
}

function showAddTargetModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="modal-title">新規ターゲット追加</h2>
            <div class="form-group">
                <label>ターゲット名</label>
                <input type="text" id="new-target-name" placeholder="例: 資格試験">
            </div>
            <div class="form-group">
                <label>締切日</label>
                <input type="date" id="new-target-date" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
                <label>カラー</label>
                <select id="new-target-color">
                    <option value="#ff8c00" selected>オレンジ</option>
                    <option value="#ff4b4b">レッド</option>
                    <option value="#ffeb3b">イエロー</option>
                    <option value="#00e676">グリーン</option>
                    <option value="#2196f3">ブルー</option>
                    <option value="#9c27b0">パープル</option>
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn btn-ghost" id="modal-cancel">キャンセル</button>
                <button class="btn btn-primary" id="modal-save">保存</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#modal-cancel').onclick = () => modal.remove();
    modal.querySelector('#modal-save').onclick = () => {
        const name = document.getElementById('new-target-name').value;
        const date = document.getElementById('new-target-date').value;
        const color = document.getElementById('new-target-color').value;

        if (name && date) {
            const newTarget = {
                id: crypto.randomUUID(),
                name: name,
                targetDate: date,
                color: color,
                tasks: [],
                createdAt: Date.now()
            };
            state.targets.push(newTarget);
            storage.save();
            modal.remove();
            renderList();
        }
    };
}

// --- Navigation ---
function switchView(viewName, params = null) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));

    // Show selected view
    const nextView = document.getElementById(`${viewName}-view`);
    if (nextView) {
        nextView.classList.remove('hidden');
        state.currentView = viewName;

        // Update nav
        const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
        if (navItem) navItem.classList.add('active');

        // Call init
        views[viewName].init(params);

        // Save state
        localStorage.setItem('timemark_last_view', viewName);
        if (params) localStorage.setItem('timemark_selected_id', params);
    }
}

// --- Background Effects ---
function initStars() {
    const starField = document.getElementById('star-field');
    if (!starField) return;

    const starCount = 100;
    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.width = star.style.height = `${Math.random() * 2}px`;
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.opacity = Math.random() * 0.5;
        starField.appendChild(star);
    }
}

// Global exposure
window.switchView = switchView;
window.showAddTargetModal = showAddTargetModal;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    storage.load();
    initStars();

    // Setup Navigation
    document.querySelector('.app-nav').addEventListener('click', (e) => {
        const item = e.target.closest('.nav-item');
        if (item) {
            e.preventDefault();
            switchView(item.dataset.view);
        }
    });

    // Setup FAB
    const addBtn = document.getElementById('add-target-btn');
    if (addBtn) {
        addBtn.onclick = showAddTargetModal;
    }

    // Recover previous state
    const lastView = localStorage.getItem('timemark_last_view') || 'list';
    const lastId = localStorage.getItem('timemark_selected_id');
    switchView(lastView, lastId);
});

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

    const today = new Date();
    const range = 60; // 表示期間 (+/- 50日程度に拡張)

    // マイルストーン計算用の準備
    const milestones = [];
    state.targets.forEach(target => {
        const start = new Date(target.createdAt || Date.now());
        const end = new Date(target.targetDate);
        const totalDays = timeUtils.calcCalendarDays(start, end);

        if (totalDays > 0) {
            // 25%, 50%, 75% の地点を算出
            [0.25, 0.5, 0.75].forEach(ratio => {
                const mDate = new Date(start);
                mDate.setDate(start.getDate() + Math.round(totalDays * ratio));
                milestones.push({
                    dateStr: mDate.toISOString().split('T')[0],
                    label: `${Math.round(ratio * 100)}%`,
                    targetName: target.name,
                    remaining: Math.round(totalDays * (1 - ratio)),
                    color: target.color
                });
            });
            // 登録日 (0%)
            milestones.push({
                dateStr: start.toISOString().split('T')[0],
                label: 'START',
                targetName: target.name,
                color: target.color
            });
        }
    });

    let daysHtml = '';
    let lastMonth = -1;

    for (let i = -15; i < range; i++) {
        const current = new Date(today);
        current.setDate(today.getDate() + i);
        const dateStr = current.toISOString().split('T')[0];
        const isToday = i === 0;
        const currentMonth = current.getMonth();

        // 月替わり判定
        const isMonthEdge = lastMonth !== -1 && lastMonth !== currentMonth;
        lastMonth = currentMonth;

        // 指定日のターゲットとマイルストーン抽出
        const dayTargets = state.targets.filter(t => t.targetDate === dateStr);
        const dayMilestones = milestones.filter(m => m.dateStr === dateStr);

        daysHtml += `
            <div class="road-day ${isToday ? 'is-today' : ''} ${isMonthEdge ? 'month-edge' : ''}" data-date="${dateStr}">
                ${isMonthEdge ? `<div class="month-label">${current.getMonth() + 1}月</div>` : ''}
                <div class="day-label">${current.getDate()}</div>
                <div class="road-path">
                    ${isToday ? '<div class="orb"></div>' : ''}
                    ${dayTargets.map(t => `<div class="road-target-marker" style="background: ${t.color}; color: ${t.color}" title="${t.name}"></div>`).join('')}
                    ${dayMilestones.map(m => `
                        <div class="road-milestone" style="border-color: ${m.color}">
                            <span class="ms-label">${m.label}</span>
                            ${m.remaining !== undefined ? `<span class="ms-rem">あと${m.remaining}日</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    roadContainer.innerHTML = `
        <h1 class="glow-text">Time Road</h1>
        <div class="road-scroller">
            <div class="road-track">
                ${daysHtml}
            </div>
        </div>
    `;

    // Center today's orb
    const todayElem = roadContainer.querySelector('.is-today');
    if (todayElem) {
        setTimeout(() => {
            todayElem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }, 100);
    }
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

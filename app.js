// --- Constants & Config ---
const ROUND_STEP = 0.5;

// --- Data Models & State ---
const state = {
    currentView: 'list',
    selectedTargetId: null,
    targets: [],
    exclusionDates: [], // Legacy, keeping for migration
    weeklyHours: {
        mon: 4, tue: 4, wed: 4, thu: 4, fri: 4,
        sat: 10, sun: 11, holiday: 10
    },
    customDates: {} // { "YYYY-MM-DD": hours }
};
// target structure example:
// { id, name, targetDate, color, type: 'study'|'event', tasks: [], createdAt }

// --- Storage ---
const storage = {
    save: () => {
        localStorage.setItem('timemark_data', JSON.stringify({
            targets: state.targets,
            weeklyHours: state.weeklyHours,
            customDates: state.customDates
        }));
    },
    load: () => {
        const data = localStorage.getItem('timemark_data');
        if (data) {
            const parsed = JSON.parse(data);
            state.targets = parsed.targets || [];
            state.weeklyHours = parsed.weeklyHours || state.weeklyHours;
            state.customDates = parsed.customDates || {};

            // Migration: if customDates is empty but exclusionDates exists
            if (Object.keys(state.customDates).length === 0 && parsed.exclusionDates) {
                parsed.exclusionDates.forEach(d => state.customDates[d] = 0);
            }
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
     * Get available hours for a specific date
     */
    getHoursForDate: (date) => {
        const dateStr = date.toISOString().split('T')[0];

        // 1. Check custom exceptions
        if (state.customDates[dateStr] !== undefined) {
            return state.customDates[dateStr];
        }

        // TODO: Future - Check public holidays
        // For now, treat sun/sat as non-weekday or check if it's holiday
        const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const dayName = dayMap[date.getDay()];

        return state.weeklyHours[dayName];
    },

    isExcluded: (date) => {
        return timeUtils.getHoursForDate(date) === 0;
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
            total += timeUtils.getHoursForDate(current);
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
    },
    settings: {
        init: () => {
            console.log('Initializing Settings View');
            renderSettings();
        },
        destroy: () => { }
    }
};

function renderSettings() {
    const container = document.getElementById('settings-view');
    if (!container) return;

    const dayLabels = {
        mon: '月曜日', tue: '火曜日', wed: '水曜日', thu: '木曜日', fri: '金曜日',
        sat: '土曜日', sun: '日曜日', holiday: '祝日'
    };

    container.innerHTML = `
        <h1 class="glow-text">Settings</h1>
        
        <section class="settings-section">
            <h2>基本の可処分時間</h2>
            <div class="settings-group">
                ${Object.keys(dayLabels).map(day => `
                    <div class="settings-row">
                        <label>${dayLabels[day]}</label>
                        <input type="number" class="hour-input" data-day="${day}" value="${state.weeklyHours[day]}" min="0" max="24" step="0.5">
                    </div>
                `).join('')}
            </div>
            <p style="font-size: 11px; color: var(--text-sub); margin-top: -8px;">※ 単位: 時間（0.5刻み）</p>
        </section>

        <section class="settings-section">
            <div class="task-section-header">
                <h2>例外日（個別の予定）</h2>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-ghost btn-sm" id="import-file-btn">📥 インポート</button>
                    <button class="btn btn-primary btn-sm" id="add-exception-btn">+ 追加</button>
                </div>
                <input type="file" id="settings-file-input" style="display: none;" accept=".ics,.csv">
            </div>
            <div class="exception-list" id="exception-list-container">
                ${Object.keys(state.customDates).length === 0 ? '<p class="empty-state" style="padding: 10px;">例外日が設定されていません</p>' : ''}
                ${Object.keys(state.customDates).sort().reverse().map(date => `
                    <div class="exception-item">
                        <div class="exception-info">
                            <span class="exception-date">${date}</span>
                            <span class="exception-hours">${state.customDates[date]}時間</span>
                        </div>
                        <button class="btn btn-ghost btn-mini delete-exception" data-date="${date}" style="color: var(--accent-red)">削除</button>
                    </div>
                `).join('')}
            </div>
        </section>
    `;

    // Event Listeners
    container.querySelectorAll('.hour-input').forEach(input => {
        input.onchange = (e) => {
            const day = e.target.dataset.day;
            const val = parseFloat(e.target.value) || 0;
            state.weeklyHours[day] = val;
            storage.save();
        };
    });

    container.querySelector('#import-file-btn').onclick = () => {
        container.querySelector('#settings-file-input').click();
    };

    container.querySelector('#settings-file-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            if (file.name.endsWith('.ics')) {
                parseICS(content);
            } else if (file.name.endsWith('.csv')) {
                parseCSV(content);
            }
            storage.save();
            renderSettings();
            alert('インポートが完了しました');
        };
        reader.readAsText(file);
    };

    function parseICS(content) {
        // Simple regex-based ICS parser for DTSTART;VALUE=DATE:YYYYMMDD or DTSTART:YYYYMMDDTHHMMSS
        const lines = content.split(/\r?\n/);
        let count = 0;
        lines.forEach(line => {
            if (line.startsWith('DTSTART')) {
                const match = line.match(/:(\d{8})/);
                if (match) {
                    const y = match[1].substring(0, 4);
                    const m = match[1].substring(4, 6);
                    const d = match[1].substring(6, 8);
                    const dateStr = `${y}-${m}-${d}`;
                    state.customDates[dateStr] = 0; // Default to 0 hours for holidays
                    count++;
                }
            }
        });
        console.log(`Imported ${count} dates from ICS`);
    }

    container.querySelector('#add-exception-btn').onclick = () => {
        showAddExceptionModal();
    };

    function showAddExceptionModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h2 class="modal-title">例外日の設定</h2>
                <div class="form-group">
                    <label>日付</label>
                    <input type="date" id="exc-date" value="${new Date().toISOString().split('T')[0]}">
                </div>
                <div class="form-group">
                    <label>設定内容</label>
                    <div class="type-selector">
                        <label class="type-option">
                            <input type="radio" name="exc-type" value="0" checked>
                            <span>お休み<br><small>（0時間）</small></span>
                        </label>
                        <label class="type-option">
                            <input type="radio" name="exc-type" value="custom">
                            <span>カスタム<br><small>（任意時間）</small></span>
                        </label>
                    </div>
                </div>
                <div class="form-group" id="exc-custom-group" style="display: none;">
                    <label>稼働時間 (h)</label>
                    <input type="number" id="exc-hours" value="0" min="0" max="24" step="0.5">
                </div>
                <div class="modal-actions">
                    <button class="btn btn-ghost" id="exc-cancel">キャンセル</button>
                    <button class="btn btn-primary" id="exc-save">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const typeInputs = modal.querySelectorAll('input[name="exc-type"]');
        const customGroup = modal.querySelector('#exc-custom-group');

        typeInputs.forEach(input => {
            input.onchange = () => {
                customGroup.style.display = input.value === 'custom' ? 'block' : 'none';
            };
        });

        modal.querySelector('#exc-cancel').onclick = () => modal.remove();
        modal.querySelector('#exc-save').onclick = () => {
            const date = modal.querySelector('#exc-date').value;
            const type = modal.querySelector('input[name="exc-type"]:checked').value;
            const hours = type === '0' ? 0 : parseFloat(modal.querySelector('#exc-hours').value) || 0;

            if (date) {
                state.customDates[date] = hours;
                storage.save();
                modal.remove();
                renderSettings();
            }
        };
    }

    function parseCSV(content) {
        const lines = content.split(/\r?\n/);
        let count = 0;
        lines.forEach((line, index) => {
            if (!line.trim()) return;

            // Clean quotes and split
            const parts = line.split(',').map(s => s.replace(/^["']|["']$/g, '').trim());
            let dateStr = parts[0];

            // Handle YYYY/M/D format (like syukujitsu.csv)
            if (dateStr.includes('/')) {
                const dateParts = dateStr.split('/');
                if (dateParts.length === 3) {
                    const y = dateParts[0];
                    const m = dateParts[1].padStart(2, '0');
                    const d = dateParts[2].padStart(2, '0');
                    dateStr = `${y}-${m}-${d}`;
                }
            }

            // Skip header or malformed entries
            if (index === 0 && (dateStr.toLowerCase().includes('date') || dateStr.includes('日'))) return;

            // Validate YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const hours = parts[1] && !isNaN(parts[1]) ? parseFloat(parts[1]) : 0;
                state.customDates[dateStr] = hours;
                count++;
            }
        });
        console.log(`Imported ${count} entries from CSV`);
    }

    container.querySelector('#delete-target-btn')?.onclick?.(); // Error prevention
}

function renderDetail(target) {
    const detailContainer = document.getElementById('detail-view');
    if (!detailContainer) return;

    if (target.type === 'event') {
        renderEventDetail(target, detailContainer);
    } else {
        renderStudyDetail(target, detailContainer);
    }
}

function renderEventDetail(target, container) {
    const today = new Date();
    const targetDate = new Date(target.targetDate);
    const calDays = timeUtils.calcCalendarDays(today, targetDate);

    container.innerHTML = `
        <header class="detail-header">
            <button class="btn btn-ghost" onclick="switchView('list')" style="padding-left: 0; margin-bottom: 16px;">← 戻る</button>
            <div class="badge">イベント</div>
            <h1 style="color: ${target.color}">${target.name}</h1>
            <div class="total-hours-hero glow-text">あと ${calDays} 日</div>
            <p style="color: var(--text-sub)">目標日: ${target.targetDate}</p>
        </header>
        <div class="card">
            <p>このターゲットは「イベント」として設定されています。日数のカウントダウンのみを行います。</p>
            <button class="btn btn-ghost" id="delete-target-btn" style="color: var(--accent-red); margin-top: 20px;">このターゲットを削除</button>
        </div>
    `;

    container.querySelector('#delete-target-btn').onclick = () => {
        if (confirm('このターゲットを削除しますか？')) {
            state.targets = state.targets.filter(t => t.id !== target.id);
            storage.save();
            switchView('list');
        }
    };
}

function renderStudyDetail(target, container) {
    const baseDateStr = localStorage.getItem(`base_date_${target.id}`) || new Date().toISOString().split('T')[0];
    const baseDate = new Date(baseDateStr);
    const targetDate = new Date(target.targetDate);
    const totalHours = timeUtils.calcTotalHours(baseDate, targetDate);

    // Allocate hours to tasks
    const tasksWithHours = timeUtils.allocateTaskHours(totalHours, target.tasks);

    container.innerHTML = `
        <header class="detail-header">
            <button class="btn btn-ghost" onclick="switchView('list')" style="padding-left: 0; margin-bottom: 16px;">← 戻る</button>
            <div class="badge" style="border-color: var(--accent-green); color: var(--accent-green)">勉強・仕事</div>
            <h1 style="color: ${target.color}">${target.name}</h1>
            <div class="total-hours-hero glow-text">あと ${totalHours} 時間</div>
            <div class="base-date-selector">
                基準日: <input type="date" id="base-date-input" value="${baseDateStr}">
            </div>
        </header>

        <section class="task-section">
            <div class="task-section-header">
                <h2>タスク配分（時間の折半）</h2>
                <button class="btn btn-ghost" id="reset-weights-btn">均等（折半）に戻す</button>
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
                    <span style="color: var(--text-sub)">+ 科目・タスクを追加</span>
                </div>
            </div>
            <button class="btn btn-ghost" id="delete-target-btn" style="color: var(--accent-red); margin-top: 40px; width: 100%;">このターゲットを削除</button>
        </section>
    `;

    // Event Listeners
    container.querySelector('#base-date-input').onchange = (e) => {
        localStorage.setItem(`base_date_${target.id}`, e.target.value);
        renderDetail(target);
    };

    container.querySelectorAll('.weight-slider').forEach(slider => {
        slider.oninput = (e) => {
            const taskId = e.target.dataset.taskId;
            const weight = parseInt(e.target.value);
            const task = target.tasks.find(t => t.id === taskId);
            if (task) {
                task.weight = weight;
                storage.save();
                renderStudyDetail(target, container); // Partial re-render for performance
            }
        };
    });

    container.querySelector('#reset-weights-btn').onclick = () => {
        target.tasks.forEach(t => t.weight = 1);
        storage.save();
        renderDetail(target);
    };

    container.querySelector('#add-task-item').onclick = () => {
        const title = prompt('科目・タスク名を入力してください');
        if (title) {
            target.tasks.push({ id: crypto.randomUUID(), title: title, weight: 1 });
            storage.save();
            renderDetail(target);
        }
    };

    container.querySelector('#delete-target-btn').onclick = () => {
        if (confirm('このターゲットを削除しますか？')) {
            state.targets = state.targets.filter(t => t.id !== target.id);
            storage.save();
            switchView('list');
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

    // Sort targets: Study first, then Event
    const sortedTargets = [...state.targets].sort((a, b) => {
        if (a.type === b.type) return 0;
        return a.type === 'study' ? -1 : 1;
    });

    listContainer.innerHTML = sortedTargets.map(target => {
        const targetDate = new Date(target.targetDate);
        const calDays = timeUtils.calcCalendarDays(today, targetDate);

        let mainDisplay = '';
        let subDisplay = '';

        if (target.type === 'event') {
            mainDisplay = `あと ${calDays}日`;
            subDisplay = '全日数カウント';
        } else {
            const totalHours = timeUtils.calcTotalHours(today, targetDate);
            mainDisplay = `あと ${calDays}日 / ${totalHours}h`;
            subDisplay = `暦日数計 / 総可処分時間`;
        }

        return `
            <div class="card target-card" onclick="switchView('detail', '${target.id}')">
                <div class="target-info">
                    <div class="badge-mini" style="background: ${target.type === 'event' ? 'var(--border-color)' : 'var(--primary-glow)'}">
                        ${target.type === 'event' ? 'EVENT' : 'STUDY'}
                    </div>
                    <h3 style="color: ${target.color}">${target.name}</h3>
                    <p>${target.targetDate}</p>
                </div>
                <div class="target-days">
                    <div class="days-main glow-text">${mainDisplay}</div>
                    <div class="days-sub">${subDisplay}</div>
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
                <label>種別</label>
                <div class="type-selector">
                    <label class="type-option">
                        <input type="radio" name="target-type" value="study" checked>
                        <span>勉強・仕事<br><small>（時間管理あり）</small></span>
                    </label>
                    <label class="type-option">
                        <input type="radio" name="target-type" value="event" >
                        <span>イベント<br><small>（日数のみ）</small></span>
                    </label>
                </div>
            </div>
            <div class="form-group">
                <label>ターゲット名（目的）</label>
                <input type="text" id="new-target-name" placeholder="例: 英検準1級、定期テスト">
            </div>
            <div class="form-group">
                <label>締切日（目標日）</label>
                <input type="date" id="new-target-date" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
                <label>カラー</label>
                <select id="new-target-color">
                    <option value="#ff8c00" selected>オレンジ</option>
                    <option value="#00e676">ミントグリーン</option>
                    <option value="#2196f3">ブルー</option>
                    <option value="#ff4b4b">レッド</option>
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
        const type = modal.querySelector('input[name="target-type"]:checked').value;
        const name = document.getElementById('new-target-name').value;
        const date = document.getElementById('new-target-date').value;
        const color = document.getElementById('new-target-color').value;

        if (name && date) {
            const newTarget = {
                id: crypto.randomUUID(),
                type: type,
                name: name,
                targetDate: date,
                color: color,
                tasks: [],
                createdAt: Date.now()
            };
            if (type === 'study') {
                newTarget.tasks.push({ id: crypto.randomUUID(), title: '基本学習', weight: 1 });
            }
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

import { googleNativeSync } from './native-google-sync.js';

// --- Constants & Config ---
const ROUND_STEP = 0.5;

async function confirmInApp(prompt) {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay timemark-confirm-overlay';
        modal.innerHTML = `
            <div class="modal-content timemark-confirm-dialog" role="dialog" aria-modal="true" aria-label="確認">
                <h2>確認</h2>
                <p>${escapeHTML(prompt)}</p>
                <div class="modal-actions">
                    <button class="btn btn-ghost" data-confirm="false">キャンセル</button>
                    <button class="btn btn-primary" data-confirm="true">続ける</button>
                </div>
            </div>`;
        const finish = (answer) => {
            modal.remove();
            resolve(answer);
        };
        modal.querySelectorAll('[data-confirm]').forEach(button => {
            button.onclick = () => finish(button.dataset.confirm === 'true');
        });
        document.body.appendChild(modal);
    });
}

async function notifyInApp(text) {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay timemark-confirm-overlay';
        modal.innerHTML = `
            <div class="modal-content timemark-confirm-dialog" role="dialog" aria-modal="true" aria-label="お知らせ">
                <h2>TimeMark</h2>
                <p>${escapeHTML(text)}</p>
                <div class="modal-actions"><button class="btn btn-primary">OK</button></div>
            </div>`;
        modal.querySelector('button').onclick = () => {
            modal.remove();
            resolve();
        };
        document.body.appendChild(modal);
    });
}

// --- Data Models & State ---
const state = {
    currentView: 'list',
    selectedTargetId: null,
    targets: [],
    holidays: {}, // { 'YYYY-MM-DD': 'Name' }
    exclusionDates: [], // Legacy
    weeklyHours: {
        mon: 4, tue: 4, wed: 4, thu: 4, fri: 4,
        sat: 10, sun: 11, holiday: 10
    },
    customDates: {}, // { "YYYY-MM-DD": hours }
    timePeriods: [], // [ { id, name, start, end, weeklyHours: {...} } ]
    schoolEvents: [], // SchoolEvents rows imported from the connected spreadsheet
    schoolVacationDates: [], // Dates set to 0 automatically from category=vacation
    archiveSettings: {
        autoArchiveAfterDays: 0,
        showArchived: false
    },
    overviewSettings: {
        baseDate: toLocalDateString(new Date()),
        endDate: ''
    },
    uiSettings: {
        displayScale: 1
    }
};
// target structure example:
// { id, name, startDate, targetDate, color, type: 'study'|'event', tasks: [], archived, createdAt }

function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function normalizeTarget(target) {
    const t = target || {};
    const normalized = { ...t, archived: t.archived === true, archiveOverride: t.archiveOverride === true };
    const hasStartDate = typeof t.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.startDate);
    if (hasStartDate) return normalized;

    let startDate = toLocalDateString(new Date());
    if (t.createdAt) {
        const created = new Date(t.createdAt);
        if (!isNaN(created)) {
            startDate = toLocalDateString(created);
        }
    }

    return { ...normalized, startDate };
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

// --- Storage ---
const storage = {
    save: () => {
        localStorage.setItem('timemark_data', JSON.stringify({
            targets: state.targets,
            weeklyHours: state.weeklyHours,
            customDates: state.customDates,
            timePeriods: state.timePeriods,
            schoolEvents: state.schoolEvents,
            schoolVacationDates: state.schoolVacationDates,
            archiveSettings: state.archiveSettings,
            overviewSettings: state.overviewSettings,
            uiSettings: state.uiSettings
        }));
    },
    load: () => {
        const data = localStorage.getItem('timemark_data');
        if (data) {
            const parsed = JSON.parse(data);
            state.targets = (parsed.targets || []).map(normalizeTarget);
            state.weeklyHours = parsed.weeklyHours || state.weeklyHours;
            state.customDates = parsed.customDates || {};
            state.timePeriods = parsed.timePeriods || [];
            state.schoolEvents = Array.isArray(parsed.schoolEvents) ? parsed.schoolEvents : [];
            state.schoolVacationDates = Array.isArray(parsed.schoolVacationDates) ? parsed.schoolVacationDates : [];
            state.archiveSettings = {
                autoArchiveAfterDays: [0, 1, 7, 30].includes(Number(parsed.archiveSettings?.autoArchiveAfterDays))
                    ? Number(parsed.archiveSettings.autoArchiveAfterDays) : 0,
                showArchived: parsed.archiveSettings?.showArchived === true
            };
            state.overviewSettings = {
                baseDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.overviewSettings?.baseDate || '')
                    ? parsed.overviewSettings.baseDate : toLocalDateString(new Date()),
                endDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.overviewSettings?.endDate || '')
                    ? parsed.overviewSettings.endDate : ''
            };
            state.uiSettings = {
                displayScale: [0.9, 1, 1.1, 1.2].includes(Number(parsed.uiSettings?.displayScale))
                    ? Number(parsed.uiSettings.displayScale) : 1
            };

            // Migration: if customDates is empty but exclusionDates exists
            if (Object.keys(state.customDates).length === 0 && parsed.exclusionDates) {
                parsed.exclusionDates.forEach(d => state.customDates[d] = 0);
            }
        }
    },
    loadHolidays: async () => {
        try {
            const response = await fetch('syukujitsu.csv');
            const text = await response.text();
            const lines = text.split(/\r?\n/);
            lines.forEach((line, index) => {
                if (index === 0 || !line.trim()) return;
                const [dateStr, name] = line.split(',');
                if (dateStr) {
                    const parts = dateStr.split('/');
                    if (parts.length === 3) {
                        const y = parts[0];
                        const m = parts[1].padStart(2, '0');
                        const d = parts[2].padStart(2, '0');
                        state.holidays[`${y}-${m}-${d}`] = name;
                    }
                }
            });
            console.log(`Loaded ${Object.keys(state.holidays).length} holidays`);
        } catch (e) {
            console.warn('Failed to load holidays:', e);
        }
    }
};

const backupUtils = {
    collectBaseDates: () => {
        const baseDates = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('base_date_')) continue;
            const targetId = key.slice('base_date_'.length);
            if (!targetId) continue;
            baseDates[targetId] = localStorage.getItem(key);
        }
        return baseDates;
    },

    createBackup: () => {
        const snapshot = {
            targets: state.targets,
            weeklyHours: state.weeklyHours,
            customDates: state.customDates,
            timePeriods: state.timePeriods,
            schoolEvents: state.schoolEvents,
            schoolVacationDates: state.schoolVacationDates,
            archiveSettings: state.archiveSettings,
            overviewSettings: state.overviewSettings,
            uiSettings: state.uiSettings
        };

        return {
            app: 'TimeMark',
            version: 1,
            exportedAt: new Date().toISOString(),
            data: JSON.parse(JSON.stringify(snapshot)),
            baseDates: backupUtils.collectBaseDates()
        };
    },

    downloadBackup: () => {
        const backup = backupUtils.createBackup();
        const json = JSON.stringify(backup, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const a = document.createElement('a');
        a.href = url;
        a.download = `timemark-backup-${ts}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    },

    applyBackup: (raw) => {
        if (!raw || typeof raw !== 'object') {
            throw new Error('バックアップ形式が不正です');
        }

        const payload = raw.data && typeof raw.data === 'object' ? raw.data : raw;
        if (!Array.isArray(payload.targets) || !payload.weeklyHours || typeof payload.weeklyHours !== 'object') {
            throw new Error('必要なデータが見つかりませんでした');
        }

        state.targets = payload.targets;
        state.targets = state.targets.map(normalizeTarget);
        state.weeklyHours = { ...state.weeklyHours, ...payload.weeklyHours };
        state.customDates = payload.customDates && typeof payload.customDates === 'object' ? payload.customDates : {};
        state.timePeriods = Array.isArray(payload.timePeriods) ? payload.timePeriods : [];
        state.schoolEvents = Array.isArray(payload.schoolEvents) ? payload.schoolEvents : [];
        state.schoolVacationDates = Array.isArray(payload.schoolVacationDates) ? payload.schoolVacationDates : [];
        state.archiveSettings = {
            autoArchiveAfterDays: [0, 1, 7, 30].includes(Number(payload.archiveSettings?.autoArchiveAfterDays))
                ? Number(payload.archiveSettings.autoArchiveAfterDays) : 0,
            showArchived: payload.archiveSettings?.showArchived === true
        };
        state.overviewSettings = {
            baseDate: /^\d{4}-\d{2}-\d{2}$/.test(payload.overviewSettings?.baseDate || '')
                ? payload.overviewSettings.baseDate : toLocalDateString(new Date()),
            endDate: /^\d{4}-\d{2}-\d{2}$/.test(payload.overviewSettings?.endDate || '')
                ? payload.overviewSettings.endDate : ''
        };
        state.uiSettings = {
            displayScale: [0.9, 1, 1.1, 1.2].includes(Number(payload.uiSettings?.displayScale))
                ? Number(payload.uiSettings.displayScale) : 1
        };
        applyDisplayScale();
        storage.save();

        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('base_date_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));

        if (raw.baseDates && typeof raw.baseDates === 'object') {
            Object.entries(raw.baseDates).forEach(([targetId, date]) => {
                if (typeof date === 'string' && targetId) {
                    localStorage.setItem(`base_date_${targetId}`, date);
                }
            });
        }
    }
};

// Google Sheets direct synchronization for the packaged app. Unlike the
// legacy Apps Script bridge, each person owns and authorizes their own sheet.
const googleSheetSync = {
    configKey: 'timemark_google_sheet_config',

    getConfig: () => {
        try {
            const saved = JSON.parse(localStorage.getItem(googleSheetSync.configKey) || '{}');
            return {
                spreadsheetId: saved.spreadsheetId || '',
                spreadsheetUrl: saved.spreadsheetUrl || '',
                accountEmail: saved.accountEmail || ''
            };
        } catch {
            return { spreadsheetId: '', spreadsheetUrl: '', accountEmail: '' };
        }
    },

    saveConfig: (next) => {
        localStorage.setItem(googleSheetSync.configKey, JSON.stringify({ ...googleSheetSync.getConfig(), ...next }));
    },

    extractSpreadsheetId: (value) => {
        const text = String(value || '').trim();
        const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        return match?.[1] || (/^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : '');
    },

    signIn: async () => {
        const identity = await googleNativeSync.signIn();
        googleSheetSync.saveConfig({ accountEmail: identity.email || '' });
        return identity;
    },

    createSheet: async () => {
        const created = await googleNativeSync.createSpreadsheet();
        const identity = googleNativeSync.getSession() || {};
        googleSheetSync.saveConfig({
            spreadsheetId: created.spreadsheetId,
            spreadsheetUrl: created.spreadsheetUrl,
            accountEmail: identity.email || ''
        });
        await googleNativeSync.saveBackup(created.spreadsheetId, JSON.stringify(backupUtils.createBackup()));
        return created;
    },

    connectExisting: async (value) => {
        const spreadsheetId = googleSheetSync.extractSpreadsheetId(value);
        if (!spreadsheetId) throw new Error('GoogleスプレッドシートのURLまたはIDを入力してください');
        // A legacy SchoolEvents-only sheet is a valid read-only schedule source.
        // Reading this optional range verifies access without requiring or
        // modifying TimeMarkData in the user's existing spreadsheet.
        await googleNativeSync.loadSchoolEvents(spreadsheetId);
        const identity = googleNativeSync.getSession() || {};
        googleSheetSync.saveConfig({
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
            accountEmail: identity.email || ''
        });
    },

    requireSheetId: () => {
        const { spreadsheetId } = googleSheetSync.getConfig();
        if (!spreadsheetId) throw new Error('先にGoogleスプレッドシートを作成または接続してください');
        return spreadsheetId;
    },

    save: async () => {
        const spreadsheetId = googleSheetSync.requireSheetId();
        await googleNativeSync.saveBackup(spreadsheetId, JSON.stringify(backupUtils.createBackup()));
    },

    load: async () => {
        const spreadsheetId = googleSheetSync.requireSheetId();
        const backup = await googleNativeSync.loadBackup(spreadsheetId);
        if (!backup) throw new Error('このシートにはTimeMarkの保存データがありません');
        backupUtils.applyBackup(JSON.parse(backup));
    },

    loadSchedule: async () => googleNativeSync.loadSchedule(googleSheetSync.requireSheetId()),

    loadSchoolEvents: async () => googleNativeSync.loadSchoolEvents(googleSheetSync.requireSheetId()),

    disconnect: () => {
        googleNativeSync.disconnect();
        localStorage.removeItem(googleSheetSync.configKey);
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

        // 1. 最優先: 個別例外日
        if (state.customDates[dateStr] !== undefined) {
            return state.customDates[dateStr];
        }

        // 1.5 祝日判定 (syukujitsu.csv から読み込んだデータ)
        const isHoliday = !!state.holidays[dateStr];

        // 2. 次点: 期間指定の設定 (長期休暇など)
        const period = state.timePeriods.find(p => dateStr >= p.start && dateStr <= p.end);

        const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        let dayName = dayMap[date.getDay()];

        // 祝日の場合は曜日を 'holiday' とみなす (期間設定内でも祝日設定があればそれを優先するか、後続の weeklyHours で holiday を使う)
        if (isHoliday) {
            dayName = 'holiday';
        }

        if (period) {
            // 期間設定内の週設定に 'holiday' がない場合は日曜日の設定を流用する (以前のロジック踏襲)
            return period.weeklyHours[dayName] !== undefined ? period.weeklyHours[dayName] : period.weeklyHours['sun'];
        }

        // 3. デフォルト: 通常の曜日設定
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

function applySchoolEvents(events) {
    const normalizedEvents = Array.isArray(events) ? events.filter(event =>
        event && /^\d{4}-\d{2}-\d{2}$/.test(event.date) && typeof event.title === 'string' && event.title.trim()
    ) : [];
    const previousVacationDates = new Set(state.schoolVacationDates || []);
    const vacationDates = new Set(normalizedEvents
        .filter(event => String(event.category || '').toLowerCase() === 'vacation')
        .map(event => event.date));

    // Only remove a prior automatic 0-hour rule. A manually set non-zero
    // exception always remains the user's decision.
    previousVacationDates.forEach(date => {
        if (!vacationDates.has(date) && state.customDates[date] === 0) delete state.customDates[date];
    });
    vacationDates.forEach(date => {
        if (state.customDates[date] === undefined) state.customDates[date] = 0;
    });

    state.schoolEvents = normalizedEvents.sort((a, b) => a.date.localeCompare(b.date));
    state.schoolVacationDates = [...vacationDates].sort();
    storage.save();
}

function isTargetArchived(target, now = new Date()) {
    if (target.archived === true) return true;
    if (target.archiveOverride === true) return false;
    const delay = Number(state.archiveSettings.autoArchiveAfterDays) || 0;
    if (!delay || !/^\d{4}-\d{2}-\d{2}$/.test(target.targetDate || '')) return false;
    const completedOn = new Date(`${target.targetDate}T00:00:00`);
    completedOn.setDate(completedOn.getDate() + delay);
    return timeUtils.startOfDay(now) > completedOn;
}

function archiveActionLabel(target) {
    return isTargetArchived(target) ? 'アーカイブを解除' : 'アーカイブする';
}

function getDisplayedTargets() {
    return state.targets.filter(target => !isTargetArchived(target));
}

function getArchivedTargets() {
    return state.targets.filter(target => isTargetArchived(target));
}

function applyDisplayScale() {
    document.documentElement.style.setProperty('--ui-scale', String(state.uiSettings.displayScale));
}

function changeDisplayScale(delta) {
    const options = [0.9, 1, 1.1, 1.2];
    const currentIndex = options.indexOf(state.uiSettings.displayScale);
    const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) return;
    state.uiSettings.displayScale = options[nextIndex];
    applyDisplayScale();
    storage.save();
    switchView(state.currentView);
}

function renderLearningOverview() {
    const baseDate = new Date(`${state.overviewSettings.baseDate}T00:00:00`);
    const studyTargets = getDisplayedTargets().filter(target => target.type === 'study');
    const latestTarget = studyTargets.reduce((latest, target) =>
        !latest || target.targetDate > latest.targetDate ? target : latest, null);
    const effectiveEndDate = state.overviewSettings.endDate || latestTarget?.targetDate || '';
    const totalHours = effectiveEndDate ? timeUtils.calcTotalHours(baseDate, new Date(`${effectiveEndDate}T00:00:00`)) : 0;

    return `
        <section class="learning-overview card" aria-label="全体の学習時間">
            <div class="learning-overview-header">
                <div>
                    <h2>全体の学習時間</h2>
                    <p>基準日から${effectiveEndDate ? ` ${effectiveEndDate} まで` : ' 集計終了日未設定'}</p>
                </div>
                <div class="display-size-controls" aria-label="表示サイズ">
                    <button class="display-size-button" id="display-size-down" aria-label="表示を小さくする" ${state.uiSettings.displayScale === 0.9 ? 'disabled' : ''}>−</button>
                    <button class="display-size-button" id="display-size-up" aria-label="表示を大きくする" ${state.uiSettings.displayScale === 1.2 ? 'disabled' : ''}>＋</button>
                </div>
            </div>
            <div class="learning-overview-controls">
                <label>基準日
                    <input type="date" id="overview-base-date" value="${state.overviewSettings.baseDate}">
                </label>
                <label>いつまで
                    <input type="date" id="overview-end-date" value="${state.overviewSettings.endDate}">
                </label>
            </div>
            <div class="learning-overview-values">
                <div><span>可処分時間</span><strong>${totalHours}h</strong></div>
                <div><span>学習ターゲット</span><strong>${studyTargets.length}件</strong></div>
            </div>
        </section>
    `;
}

function bindLearningOverview(container) {
    const baseDateInput = container.querySelector('#overview-base-date');
    if (baseDateInput) {
        baseDateInput.onchange = () => {
            state.overviewSettings.baseDate = baseDateInput.value || toLocalDateString(new Date());
            storage.save();
            renderList();
        };
    }
    const endDateInput = container.querySelector('#overview-end-date');
    if (endDateInput) {
        endDateInput.onchange = () => {
            state.overviewSettings.endDate = endDateInput.value || '';
            storage.save();
            renderList();
        };
    }
    container.querySelector('#display-size-down')?.addEventListener('click', () => changeDisplayScale(-1));
    container.querySelector('#display-size-up')?.addEventListener('click', () => changeDisplayScale(1));
}

function reorderDisplayedTargets(reorderedTargets) {
    const reorderedIds = new Set(reorderedTargets.map(target => target.id));
    let index = 0;
    state.targets = state.targets.map(target => reorderedIds.has(target.id) ? reorderedTargets[index++] : target);
    storage.save();
}

function renderSchoolEventsTable() {
    if (state.schoolEvents.length === 0) {
        return '<p class="empty-state" style="padding: 10px;">まだ学校予定を読み込んでいません</p>';
    }
    return `<div class="school-events-table-wrap"><table class="school-events-table">
        <thead><tr><th>日付</th><th>学年</th><th>分類</th><th>予定</th><th>出典</th></tr></thead>
        <tbody>${state.schoolEvents.map(event => `<tr>
            <td>${escapeHTML(event.date)}</td>
            <td>${escapeHTML(event.grade)}</td>
            <td><span class="school-event-category">${escapeHTML(event.category)}</span></td>
            <td>${escapeHTML(event.title)}</td>
            <td>${escapeHTML(event.source)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function renderSettings() {
    const container = document.getElementById('settings-view');
    if (!container) return;
    const googleSyncConfig = googleSheetSync.getConfig();
    const nativeGoogleSyncAvailable = googleNativeSync.isAvailable();

    const dayLabels = {
        mon: '月曜日', tue: '火曜日', wed: '水曜日', thu: '木曜日', fri: '金曜日',
        sat: '土曜日', sun: '日曜日', holiday: '祝日'
    };
    const archiveCount = state.targets.filter(target => isTargetArchived(target)).length;

    container.innerHTML = `
        <h1 class="glow-text">設定</h1>

        <p class="settings-intro">自分の予定と学校予定は、別々に管理・読み込みできます。</p>

        <section class="settings-section">
            <h2>自分の設定</h2>
            <div class="task-section-header">
                <h2>アーカイブ</h2>
                <span class="sync-status">${archiveCount}件</span>
            </div>
            <label class="archive-setting-row">
                <span>目標日を過ぎたターゲットを非表示にする時期</span>
                <select id="auto-archive-after-select">
                    <option value="0" ${state.archiveSettings.autoArchiveAfterDays === 0 ? 'selected' : ''}>自動では非表示にしない</option>
                    <option value="1" ${state.archiveSettings.autoArchiveAfterDays === 1 ? 'selected' : ''}>完了後1日</option>
                    <option value="7" ${state.archiveSettings.autoArchiveAfterDays === 7 ? 'selected' : ''}>完了後1週間</option>
                    <option value="30" ${state.archiveSettings.autoArchiveAfterDays === 30 ? 'selected' : ''}>完了後1か月</option>
                </select>
            </label>
            <p class="sync-help">個別アーカイブは、LISTのターゲットを右クリック（Mac）または長押し（iPhone）して開く「ターゲット編集」から切り替えられます。アーカイブ済みはLISTとTime Roadの最下部にある「アーカイブ」から確認・復元できます。データは削除されません。</p>
        </section>
        
        <section class="settings-section">
            <h2>週間稼働時間（デフォルト）</h2>
            <div class="bulk-apply-row" style="display: flex; gap: 8px; margin-bottom: 12px;">
                <div style="flex: 1; display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 8px;">
                    <span style="font-size: 11px; color: var(--text-sub)">平日:</span>
                    <input type="number" id="weekday-bulk-input" value="4" min="0" max="24" step="0.5" style="width: 45px; text-align: center; background: transparent; border: 1px solid var(--border-color); color: white; border-radius: 4px;">
                    <button class="btn btn-ghost btn-mini" id="weekday-apply-btn" style="padding: 2px 8px;">適用</button>
                </div>
                <div style="flex: 1; display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 8px;">
                    <span style="font-size: 11px; color: var(--text-sub)">休日:</span>
                    <input type="number" id="weekend-bulk-input" value="10" min="0" max="24" step="0.5" style="width: 45px; text-align: center; background: transparent; border: 1px solid var(--border-color); color: white; border-radius: 4px;">
                    <button class="btn btn-primary btn-mini" id="weekend-apply-btn" style="padding: 2px 8px;">適用</button>
                </div>
            </div>
            <div class="weekly-hours-compact" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                ${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'].map(day => `
                    <div style="display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,0.03); padding: 6px; border-radius: 6px; border: 1px solid var(--border-color);">
                        <label style="font-size: 11px; margin-bottom: 4px; color: var(--text-sub)">${dayLabels[day].charAt(0)}</label>
                        <input type="number" class="hour-input" data-day="${day}" value="${state.weeklyHours[day]}" min="0" max="24" step="0.5" 
                               style="width: 100%; padding: 4px 0; text-align: center; font-size: 13px; background: transparent; border: none; color: white; outline: none;">
                    </div>
                `).join('')}
            </div>
        </section>

        <section class="settings-section">
            <div class="task-section-header">
                <h2>自分の予定：期間指定</h2>
                <button class="btn btn-primary btn-sm" id="add-period-btn">+ 期間を追加</button>
            </div>
            <div class="exception-list" id="period-list-container">
                ${state.timePeriods.length === 0 ? '<p class="empty-state" style="padding: 10px;">期間設定がありません</p>' : ''}
                ${state.timePeriods.map(p => `
                    <div class="exception-item">
                        <div class="exception-info" style="display: flex; flex-direction: column;">
                            <span style="font-weight: bold; font-size: 14px;">${p.name}</span>
                            <span style="font-size: 11px; color: var(--text-sub)">${p.start} 〜 ${p.end}</span>
                        </div>
                        <button class="btn btn-ghost btn-mini delete-period" data-id="${p.id}" style="color: var(--accent-red)">削除</button>
                    </div>
                `).join('')}
            </div>
        </section>

        <section class="settings-section">
            <div class="task-section-header">
                <h2>自分のTimeMarkデータ</h2>
                <span class="sync-status" id="google-sync-status">${googleSyncConfig.spreadsheetId ? `接続先: ${escapeHTML(googleSyncConfig.accountEmail || 'TimeMarkシート')}` : '未接続'}</span>
            </div>
            <div class="sync-actions">
                <button class="btn btn-primary btn-sm" id="google-save-btn" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>自分のデータを保存</button>
                <button class="btn btn-ghost btn-sm" id="google-load-btn" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>自分のデータを読み込む</button>
            </div>
            <p class="sync-help">ターゲット・自分の設定・例外日などを <code>TimeMarkData</code> に保存／読み込みします。</p>
        </section>

        <section class="settings-section">
            <div class="task-section-header">
                <h2>自分の予定</h2>
                <span class="sync-status">例外日 ${Object.keys(state.customDates).length}件</span>
            </div>
            <div class="sync-actions">
                <button class="btn btn-ghost btn-sm" id="google-load-schedule-btn" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>予定表を読み込む</button>
                <button class="btn btn-ghost btn-sm" id="export-csv-btn">📤 CSV</button>
                <button class="btn btn-ghost btn-sm" id="export-ics-btn">📤 ICS</button>
                <button class="btn btn-ghost btn-sm" id="import-file-btn">📥 インポート</button>
                <button class="btn btn-primary btn-sm" id="add-exception-btn">+ 追加</button>
            </div>
            <p class="sync-help"><code>TimeMarkSchedule</code> の <code>date</code>・<code>hours</code>・<code>note</code> を、個別の予定として読み込みます。読み込むと同じ日付の例外日設定は上書きされます。</p>
            <input type="file" id="settings-file-input" style="display: none;" accept=".ics,.csv">
            <div class="exception-list" id="exception-list-container">
                ${Object.keys(state.customDates).length === 0 ? '<p class="empty-state" style="padding: 10px;">例外日が設定されていません</p>' : ''}
                ${Object.keys(state.customDates).sort().map(date => `
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

        <section class="settings-section">
            <div class="task-section-header">
                <h2>学校予定（SchoolEvents）</h2>
                <span class="sync-status">${state.schoolEvents.length}件</span>
            </div>
            <div class="sync-actions">
                <button class="btn btn-primary btn-sm" id="google-load-school-events-btn" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>学校予定を読み込む</button>
            </div>
            <p class="sync-help">学校側の <code>SchoolEvents</code> を読み込むだけで、アプリから学校予定を書き換えることはありません。</p>
            <details class="settings-details" ${state.schoolEvents.length > 0 ? 'open' : ''}>
                <summary>学校予定を見る・シートの書き方を見る</summary>
                ${renderSchoolEventsTable()}
                <p class="sync-help">入力例は <code>SchoolEventsExample</code> シートにあります。実データは <code>SchoolEvents</code> へ、1行目の見出しを変えずに入力してください。</p>
            </details>
        </section>

        <section class="settings-section">
            <div class="task-section-header">
                <h2>Googleスプレッドシート接続</h2>
                <span class="sync-status">${googleSyncConfig.spreadsheetId ? '設定済み' : '未設定'}</span>
            </div>
            <div class="sync-actions"><button class="btn btn-primary btn-sm" id="google-sign-in-btn" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>Googleに接続</button></div>
            <p class="sync-help">GASの設定は不要です。Googleに接続してから、自分用のシートを作成するか、既存のシートを接続します。</p>
            <details class="settings-details" ${googleSyncConfig.spreadsheetId ? '' : 'open'}>
                <summary>シートを作成・接続・管理</summary>
                <div class="sync-grid">
                    <label class="sync-field sync-field-wide">
                        <span>TimeMark／SchoolEventsシートURL</span>
                        <input type="url" id="google-sheet-url-input" value="${escapeHTML(googleSyncConfig.spreadsheetUrl)}" placeholder="新しく作成すると自動で設定されます" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>
                    </label>
                </div>
                <div class="sync-actions">
                    <button class="btn btn-primary btn-sm" id="google-create-sheet-btn" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>新しいTimeMarkシートを作成</button>
                    <button class="btn btn-ghost btn-sm" id="google-connect-sheet-btn" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>作成済みシートを接続</button>
                    <button class="btn btn-ghost btn-sm" id="google-open-sheet-btn" ${nativeGoogleSyncAvailable && googleSyncConfig.spreadsheetUrl ? '' : 'disabled'}>シートを開く</button>
                    <button class="btn btn-ghost btn-sm" id="google-disconnect-btn" ${nativeGoogleSyncAvailable ? '' : 'disabled'}>接続を解除</button>
                </div>
            </details>
            ${nativeGoogleSyncAvailable ? '' : '<p class="sync-help">この画面を利用するには、TimeMarkアプリ版を開いてください。</p>'}
        </section>

        <section class="settings-section">
            <details class="settings-details">
                <summary>端末データを移行する</summary>
                <div class="sync-actions">
                    <button class="btn btn-ghost btn-sm" id="export-backup-btn">📤 エクスポート</button>
                    <button class="btn btn-primary btn-sm" id="import-backup-btn">📥 インポート</button>
                </div>
                <input type="file" id="backup-file-input" style="display: none;" accept=".json,application/json">
                <p class="sync-help">すべてのターゲット設定・例外日・期間設定・基準日を JSON で移行できます。</p>
            </details>
        </section>
    `;

    // Event listeners for weekly hours
    container.querySelectorAll('.hour-input').forEach(input => {
        input.onchange = (e) => {
            const day = e.target.dataset.day;
            state.weeklyHours[day] = parseFloat(e.target.value) || 0;
            storage.save();
        };
    });

    container.querySelector('#weekday-apply-btn').onclick = () => {
        const val = parseFloat(container.querySelector('#weekday-bulk-input').value) || 0;
        ['mon', 'tue', 'wed', 'thu', 'fri'].forEach(day => {
            state.weeklyHours[day] = val;
            const input = container.querySelector(`.hour-input[data-day="${day}"]`);
            if (input) input.value = val;
        });
        storage.save();
    };

    container.querySelector('#weekend-apply-btn').onclick = () => {
        const val = parseFloat(container.querySelector('#weekend-bulk-input').value) || 0;
        ['sat', 'sun', 'holiday'].forEach(day => {
            state.weeklyHours[day] = val;
            const input = container.querySelector(`.hour-input[data-day="${day}"]`);
            if (input) input.value = val;
        });
        storage.save();
    };

    container.querySelector('#auto-archive-after-select').onchange = (event) => {
        state.archiveSettings.autoArchiveAfterDays = Number(event.target.value);
        storage.save();
        renderSettings();
    };

    const googleSyncStatus = container.querySelector('#google-sync-status');
    const googleSheetUrlInput = container.querySelector('#google-sheet-url-input');

    function setGoogleSyncStatus(message) {
        googleSyncStatus.textContent = message;
    }

    function describeGoogleSyncError(error) {
        if (typeof error === 'string' && error) return error;
        if (error && typeof error.message === 'string' && error.message) return error.message;
        if (error && typeof error.error === 'string' && error.error) return error.error;
        try {
            const detail = JSON.stringify(error);
            if (detail && detail !== '{}') return detail;
        } catch {
            // Fall through to the generic message below.
        }
        return '詳細を取得できないエラーが発生しました';
    }

    async function connectGoogle() {
        setGoogleSyncStatus('Googleに接続中...');
        const identity = await googleSheetSync.signIn();
        setGoogleSyncStatus(`Googleに接続しました${identity.email ? `: ${identity.email}` : ''}`);
        return identity;
    }

    async function ensureGoogleConnection() {
        const existingSession = googleNativeSync.getSession();
        if (existingSession) return existingSession;
        return connectGoogle();
    }

    if (nativeGoogleSyncAvailable) {
        container.querySelector('#google-sign-in-btn').onclick = async () => {
            try {
                await connectGoogle();
            } catch (err) {
                setGoogleSyncStatus(`接続失敗: ${describeGoogleSyncError(err)}`);
            }
        };

        container.querySelector('#google-create-sheet-btn').onclick = async () => {
            try {
                await ensureGoogleConnection();
                setGoogleSyncStatus('新しいTimeMarkシートを作成・保存中...');
                const created = await googleSheetSync.createSheet();
                googleSheetUrlInput.value = created.spreadsheetUrl;
                container.querySelector('#google-open-sheet-btn').disabled = false;
                setGoogleSyncStatus('新しいTimeMarkシートを作成して保存しました');
            } catch (err) {
                setGoogleSyncStatus(`作成失敗: ${describeGoogleSyncError(err)}`);
            }
        };

        container.querySelector('#google-connect-sheet-btn').onclick = async () => {
            try {
                const sheetUrl = googleSheetUrlInput.value.trim();
                if (!sheetUrl) throw new Error('TimeMarkシートURLを入力してください');
                await ensureGoogleConnection();
                setGoogleSyncStatus('接続を確認中...');
                await googleSheetSync.connectExisting(sheetUrl);
                container.querySelector('#google-open-sheet-btn').disabled = false;
                setGoogleSyncStatus('作成済みのTimeMarkシートを接続しました');
            } catch (err) {
                setGoogleSyncStatus(`接続失敗: ${describeGoogleSyncError(err)}`);
            }
        };

        container.querySelector('#google-open-sheet-btn').onclick = async () => {
            try {
                const { spreadsheetUrl } = googleSheetSync.getConfig();
                if (!spreadsheetUrl) throw new Error('先にTimeMarkシートを作成または接続してください');
                await googleNativeSync.openSheet(spreadsheetUrl);
                setGoogleSyncStatus('スプレッドシートを外部アプリで起動しています…');
            } catch (err) {
                setGoogleSyncStatus(`シートを開けませんでした: ${describeGoogleSyncError(err)}`);
            }
        };

        container.querySelector('#google-save-btn').onclick = async () => {
            try {
                await ensureGoogleConnection();
                setGoogleSyncStatus('シートへ保存中...');
                await googleSheetSync.save();
                setGoogleSyncStatus('シートへ保存しました');
            } catch (err) {
                setGoogleSyncStatus(`保存失敗: ${describeGoogleSyncError(err)}`);
            }
        };

        container.querySelector('#google-load-btn').onclick = async () => {
            try {
                if (!await confirmInApp('現在の端末内データを、TimeMarkシート上のバックアップで置き換えますか？')) return;
                await ensureGoogleConnection();
                setGoogleSyncStatus('シートから読み込み中...');
                await googleSheetSync.load();
                await notifyInApp('シートから読み込みました');
                switchView('list');
            } catch (err) {
                setGoogleSyncStatus(`読込失敗: ${describeGoogleSyncError(err)}`);
            }
        };

        container.querySelector('#google-load-schedule-btn').onclick = async () => {
            try {
                if (!await confirmInApp('予定表を読み込み、同じ日付の例外日設定を上書きしますか？')) return;
                await ensureGoogleConnection();
                setGoogleSyncStatus('予定表を読み込み中...');
                const entries = await googleSheetSync.loadSchedule();
                entries.forEach(({ date, hours }) => { state.customDates[date] = hours; });
                storage.save();
                setGoogleSyncStatus(`${entries.length}日分の予定表を読み込みました`);
                await notifyInApp(`${entries.length}日分の予定表を読み込みました`);
            } catch (err) {
                setGoogleSyncStatus(`予定表の読込失敗: ${describeGoogleSyncError(err)}`);
            }
        };

        container.querySelector('#google-load-school-events-btn').onclick = async () => {
            try {
                await ensureGoogleConnection();
                setGoogleSyncStatus('学校予定を読み込み中...');
                const events = await googleSheetSync.loadSchoolEvents();
                applySchoolEvents(events);
                setGoogleSyncStatus(`${events.length}件の学校予定を読み込みました`);
                renderSettings();
            } catch (err) {
                setGoogleSyncStatus(`学校予定の読込失敗: ${describeGoogleSyncError(err)}`);
            }
        };

        container.querySelector('#google-disconnect-btn').onclick = async () => {
            if (!await confirmInApp('この端末とTimeMarkシートの接続設定を解除しますか？ シート上のデータは削除されません。')) return;
            googleSheetSync.disconnect();
            renderSettings();
            await notifyInApp('この端末の接続設定を解除しました。シート上のデータは残っています。');
        };
    }

    container.querySelector('#export-backup-btn').onclick = () => {
        backupUtils.downloadBackup();
    };

    container.querySelector('#import-backup-btn').onclick = () => {
        container.querySelector('#backup-file-input').click();
    };

    container.querySelector('#backup-file-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target.result);
                backupUtils.applyBackup(parsed);
                switchView('list');
                renderSettings();
                alert('バックアップのインポートが完了しました');
            } catch (err) {
                alert(`インポートに失敗しました: ${err.message}`);
            } finally {
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    container.querySelector('#import-file-btn').onclick = () => {
        container.querySelector('#settings-file-input').click();
    };

    container.querySelector('#export-csv-btn').onclick = () => {
        exportCSV();
    };

    container.querySelector('#export-ics-btn').onclick = () => {
        exportICS();
    };

    container.querySelector('#settings-file-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            const lowerName = file.name.toLowerCase();
            if (lowerName.endsWith('.ics')) {
                parseICS(content);
            } else if (lowerName.endsWith('.csv')) {
                parseCSV(content);
            } else {
                alert('対応している形式は .ics / .csv です');
                return;
            }
            storage.save();
            renderSettings();
            alert('インポートが完了しました');
            e.target.value = '';
        };
        reader.readAsText(file);
    };

    container.querySelector('#add-period-btn').onclick = () => {
        showAddPeriodModal();
    };

    container.querySelectorAll('.delete-period').forEach(btn => {
        btn.onclick = (e) => {
            const id = e.target.dataset.id;
            state.timePeriods = state.timePeriods.filter(p => p.id !== id);
            storage.save();
            renderSettings();
        };
    });

    function showAddPeriodModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        const dayMap = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 450px;">
                <h2 class="modal-title">期間の追加設定</h2>
                <div class="form-group">
                    <label>名前</label>
                    <input type="text" id="per-name" placeholder="例: 夏休み">
                </div>
                <div style="display: flex; gap: 8px;">
                    <div class="form-group" style="flex: 1;">
                        <label>開始日</label>
                        <input type="date" id="per-start" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>終了日</label>
                        <input type="date" id="per-end" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                </div>
                <h3>期間中の曜日別時間</h3>
                <div style="margin-bottom: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 8px;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 11px;">平日:</span>
                        <input type="number" id="per-weekday-bulk" value="4" min="0" max="24" step="0.5" style="width: 45px; text-align: center;">
                        <button class="btn btn-ghost btn-mini" id="per-weekday-apply">適用</button>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 11px;">休日:</span>
                        <input type="number" id="per-weekend-bulk" value="10" min="0" max="24" step="0.5" style="width: 45px; text-align: center;">
                        <button class="btn btn-ghost btn-mini" id="per-weekend-apply">適用</button>
                    </div>
                </div>
                <div class="settings-group" style="display: flex; gap: 4px; padding: 10px 4px;">
                    ${Object.keys(dayMap).map(day => `
                        <div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
                            <label style="font-size: 11px; margin-bottom: 4px;">${dayMap[day]}</label>
                            <input type="number" class="per-hour-input" data-day="${day}" value="8" min="0" max="24" step="0.5" 
                                   style="width: 100%; text-align: center; padding: 4px 2px; font-size: 13px; min-height: 32px;">
                        </div>
                    `).join('')}
                </div>
                <div class="modal-actions" style="margin-top: 20px;">
                    <button class="btn btn-ghost" id="per-cancel">キャンセル</button>
                    <button class="btn btn-primary" id="per-save">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#per-weekday-apply').onclick = () => {
            const val = parseFloat(modal.querySelector('#per-weekday-bulk').value) || 0;
            ['mon', 'tue', 'wed', 'thu', 'fri'].forEach(day => {
                const input = modal.querySelector(`.per-hour-input[data-day="${day}"]`);
                if (input) input.value = val;
            });
        };

        modal.querySelector('#per-weekend-apply').onclick = () => {
            const val = parseFloat(modal.querySelector('#per-weekend-bulk').value) || 0;
            ['sat', 'sun'].forEach(day => {
                const input = modal.querySelector(`.per-hour-input[data-day="${day}"]`);
                if (input) input.value = val;
            });
        };

        modal.querySelector('#per-cancel').onclick = () => modal.remove();
        modal.querySelector('#per-save').onclick = () => {
            const name = modal.querySelector('#per-name').value;
            const start = modal.querySelector('#per-start').value;
            const end = modal.querySelector('#per-end').value;
            const weeklyHours = {};
            modal.querySelectorAll('.per-hour-input').forEach(input => {
                weeklyHours[input.dataset.day] = parseFloat(input.value) || 0;
            });
            weeklyHours.holiday = weeklyHours.sun;

            if (name && start && end) {
                // Use robust ID generation
                const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
                state.timePeriods.push({ id, name, start, end, weeklyHours });
                storage.save();
                modal.remove();
                renderSettings();
            } else {
                alert('名前と期間を入力してください');
            }
        };
    }
    function parseICS(content) {
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
                    state.customDates[dateStr] = 0;
                    count++;
                }
            }
        });
        console.log(`Imported ${count} dates from ICS`);
    }

    function parseCSV(content) {
        const lines = content.split(/\r?\n/);
        let count = 0;
        lines.forEach((line, index) => {
            if (!line.trim()) return;
            const parts = line.split(',').map(s => s.replace(/^["']|["']$/g, '').trim());
            let dateStr = parts[0];
            if (dateStr.includes('/')) {
                const dateParts = dateStr.split('/');
                if (dateParts.length === 3) {
                    const y = dateParts[0];
                    const m = dateParts[1].padStart(2, '0');
                    const d = dateParts[2].padStart(2, '0');
                    dateStr = `${y}-${m}-${d}`;
                }
            }
            if (index === 0 && (dateStr.toLowerCase().includes('date') || dateStr.includes('日'))) return;
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const hours = parts[1] && !isNaN(parts[1]) ? parseFloat(parts[1]) : 0;
                state.customDates[dateStr] = hours;
                count++;
            }
        });
        console.log(`Imported ${count} entries from CSV`);
    }

    function downloadTextFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function exportCSV() {
        const dates = Object.keys(state.customDates).sort();
        if (dates.length === 0) {
            alert('エクスポートする例外日がありません');
            return;
        }

        const lines = ['date,hours'];
        dates.forEach(date => {
            lines.push(`${date},${state.customDates[date]}`);
        });

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        downloadTextFile(`timemark-exceptions-${ts}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
    }

    function exportICS() {
        const dates = Object.keys(state.customDates).sort();
        if (dates.length === 0) {
            alert('エクスポートする例外日がありません');
            return;
        }

        const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//TimeMark//ExceptionDates//JA',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH'
        ];

        dates.forEach((date, idx) => {
            const dt = date.replace(/-/g, '');
            const next = new Date(`${date}T00:00:00`);
            next.setDate(next.getDate() + 1);
            const nextStr = next.toISOString().split('T')[0].replace(/-/g, '');
            const hours = state.customDates[date];
            lines.push('BEGIN:VEVENT');
            lines.push(`UID:timemark-${dt}-${idx}@local`);
            lines.push(`DTSTAMP:${now}`);
            lines.push(`DTSTART;VALUE=DATE:${dt}`);
            lines.push(`DTEND;VALUE=DATE:${nextStr}`);
            lines.push(`SUMMARY:TimeMark例外日 (${hours}時間)`);
            lines.push('END:VEVENT');
        });

        lines.push('END:VCALENDAR');

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        downloadTextFile(`timemark-exceptions-${ts}.ics`, lines.join('\r\n'), 'text/calendar;charset=utf-8');
    }

    container.querySelector('#add-exception-btn').onclick = () => {
        showAddExceptionModal();
    };

    container.querySelectorAll('.delete-exception').forEach(btn => {
        btn.onclick = (e) => {
            const date = e.target.dataset.date;
            delete state.customDates[date];
            storage.save();
            renderSettings();
        };
    });
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
    const startDateStr = target.startDate || toLocalDateString(new Date(target.createdAt || Date.now()));

    container.innerHTML = `
        <header class="detail-header">
            <button class="btn btn-ghost" onclick="switchView('list')" style="padding-left: 0; margin-bottom: 16px;">← 戻る</button>
            <div class="badge">イベント</div>
            <h1 style="color: ${target.color}">${target.name}</h1>
            <div class="total-hours-hero glow-text">あと ${calDays} 日</div>
            <div class="base-date-selector">
                開始日: <input type="date" id="start-date-input" value="${startDateStr}">
            </div>
            <p style="color: var(--text-sub)">目標日: ${target.targetDate}</p>
        </header>
        <div class="card">
            <p>このターゲットは「イベント」として設定されています。日数のカウントダウンのみを行います。</p>
            <button class="btn btn-ghost" id="archive-target-btn" style="margin-top: 20px;">${archiveActionLabel(target)}</button>
            <button class="btn btn-ghost" id="delete-target-btn" style="color: var(--accent-red); margin-top: 20px;">このターゲットを削除</button>
        </div>
    `;

    container.querySelector('#start-date-input').onchange = (e) => {
        target.startDate = e.target.value;
        storage.save();
    };

    container.querySelector('#delete-target-btn').onclick = () => {
        if (confirm('このターゲットを削除しますか？')) {
            state.targets = state.targets.filter(t => t.id !== target.id);
            storage.save();
            switchView('list');
        }
    };
    bindArchiveTargetButton(container, target);
}

function renderStudyDetail(target, container) {
    const baseDateStr = localStorage.getItem(`base_date_${target.id}`) || new Date().toISOString().split('T')[0];
    const startDateStr = target.startDate || toLocalDateString(new Date(target.createdAt || Date.now()));
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
                開始日: <input type="date" id="start-date-input" value="${startDateStr}">
            </div>
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
                <button class="btn btn-ghost" id="archive-target-btn" style="margin-top: 20px; width: 100%;">${archiveActionLabel(target)}</button>
            </div>
            <button class="btn btn-ghost" id="delete-target-btn" style="color: var(--accent-red); margin-top: 40px; width: 100%;">このターゲットを削除</button>
        </section>
    `;

    // Event Listeners
    container.querySelector('#start-date-input').onchange = (e) => {
        target.startDate = e.target.value;
        storage.save();
    };

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
    bindArchiveTargetButton(container, target);
}

function bindArchiveTargetButton(container, target) {
    const button = container.querySelector('#archive-target-btn');
    if (!button) return;
    button.onclick = async () => {
        const nextArchived = !isTargetArchived(target);
        const prompt = nextArchived
            ? 'このターゲットをアーカイブしますか？ データは削除されません。'
            : 'このターゲットを通常表示へ戻しますか？';
        if (!await confirmInApp(prompt)) return;
        target.archived = nextArchived;
        target.archiveOverride = !nextArchived;
        storage.save();
        switchView('list');
    };
}

function renderList() {
    const listContainer = document.getElementById('target-list');
    if (!listContainer) return;
    const displayedTargets = getDisplayedTargets();
    const archivedTargets = getArchivedTargets();

    if (displayedTargets.length === 0 && archivedTargets.length === 0) {
        listContainer.innerHTML = `${renderLearningOverview()}
            <div class="empty-state">
                <p>ターゲットがありません。<br>右下の「＋」から追加してください。</p>
            </div>`;
        bindLearningOverview(listContainer);
        return;
    }

    const today = new Date();

    const activeTargetsHtml = displayedTargets.map((target, index) => {
        const targetDate = new Date(target.targetDate);
        const calDays = timeUtils.calcCalendarDays(today, targetDate);

        let mainDisplay = '';
        let subDisplay = '';
        let hoursDisplay = '';

        if (target.type === 'event') {
            mainDisplay = `<small>あと</small> ${calDays} <small>日</small>`;
            subDisplay = '全日数カウント';
        } else {
            const totalHours = timeUtils.calcTotalHours(today, targetDate);
            mainDisplay = `<small>あと</small> ${calDays} <small>日</small>`;
            hoursDisplay = `${totalHours}h`;
            subDisplay = `暦日数計 / 総可処分時間`;
        }

        return `
            <div class="target-item" data-id="${target.id}" draggable="true">
                <div style="display: flex; align-items: center;">
                    <div class="drag-handle">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="4" y1="8" x2="20" y2="8"></line>
                            <line x1="4" y1="16" x2="20" y2="16"></line>
                        </svg>
                    </div>
                    <div class="target-order-controls" aria-label="順序を変更">
                        <button class="order-step-btn" data-move-target="up" data-target-id="${target.id}" ${index === 0 ? 'disabled' : ''} aria-label="上へ">▲</button>
                        <button class="order-step-btn" data-move-target="down" data-target-id="${target.id}" ${index === displayedTargets.length - 1 ? 'disabled' : ''} aria-label="下へ">▼</button>
                    </div>
                    <div class="target-info">
                        <div class="target-type-badge">${target.type.toUpperCase()}</div>
                        <div class="target-name" style="color: ${target.color}">${target.name}</div>
                        <div class="target-sub">${subDisplay}</div>
                    </div>
                </div>
                <div class="target-status">
                    <div class="target-countdown">
                        <div class="countdown-days glow-text" style="color: ${target.color}">${mainDisplay}</div>
                        ${hoursDisplay ? `<div class="countdown-hours">${hoursDisplay}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const archivedTargetsHtml = archivedTargets.length === 0 ? '' : `
        <details class="archive-panel">
            <summary>アーカイブ　${archivedTargets.length}件</summary>
            <div class="archive-list">
                ${archivedTargets.map(target => {
                    const targetDate = new Date(target.targetDate);
                    const remainingDays = timeUtils.calcCalendarDays(today, targetDate);
                    const availableHours = target.type === 'study' ? timeUtils.calcTotalHours(today, targetDate) : null;
                    return `
                        <div class="target-item archived-list-item" data-id="${target.id}">
                            <div class="target-info">
                                <div class="target-type-badge">${target.type.toUpperCase()}</div>
                                <div class="target-archive-badge">ARCHIVED</div>
                                <div class="target-name" style="color: ${target.color}">${target.name}</div>
                                <div class="target-sub">${target.type === 'study' ? '暦日数計 / 総可処分時間' : '全日数カウント'}</div>
                            </div>
                            <div class="archive-target-actions">
                                <div class="target-countdown">
                                    <div class="countdown-days glow-text" style="color: ${target.color}"><small>あと</small> ${remainingDays} <small>日</small></div>
                                    ${availableHours !== null ? `<div class="countdown-hours">${availableHours}h</div>` : ''}
                                </div>
                                <button class="btn btn-ghost btn-sm" data-restore-target="${target.id}">復元</button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </details>
    `;

    listContainer.innerHTML = `${renderLearningOverview()}${displayedTargets.length === 0 ? '<div class="empty-state"><p>通常表示のターゲットはありません。</p></div>' : activeTargetsHtml}${archivedTargetsHtml}`;

    // Setup Drag and Drop
    setupDragging(listContainer);
    bindOrderStepButtons(listContainer, renderList);
    bindLearningOverview(listContainer);
    bindArchiveRestoreButtons(listContainer, renderList);
}

function bindArchiveRestoreButtons(container, renderCurrentView) {
    container.querySelectorAll('[data-restore-target]').forEach(button => {
        button.onclick = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = state.targets.find(item => item.id === button.dataset.restoreTarget);
            if (!target || !await confirmInApp('このターゲットを通常表示へ戻しますか？')) return;
            target.archived = false;
            target.archiveOverride = true;
            storage.save();
            renderCurrentView();
        };
    });
}

function moveTargetByStep(targetId, direction) {
    const displayedTargets = getDisplayedTargets();
    const from = displayedTargets.findIndex(target => target.id === targetId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= displayedTargets.length) return false;
    [displayedTargets[from], displayedTargets[to]] = [displayedTargets[to], displayedTargets[from]];
    reorderDisplayedTargets(displayedTargets);
    return true;
}

function bindOrderStepButtons(container, renderCurrentView) {
    container.querySelectorAll('[data-move-target]').forEach(button => {
        button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const direction = button.dataset.moveTarget === 'up' ? -1 : 1;
            if (moveTargetByStep(button.dataset.targetId, direction)) renderCurrentView();
        };
    });
}

function createDragAutoScroller(onPositionChange) {
    const scrollContainer = document.getElementById('app-content');
    const EDGE_ZONE_PX = 92;
    const MAX_SPEED_PX = 18;
    let pointerY = null;
    let frame = null;

    const tick = () => {
        frame = null;
        if (pointerY === null || !scrollContainer) return;
        const bounds = scrollContainer.getBoundingClientRect();
        let amount = 0;
        if (pointerY < bounds.top + EDGE_ZONE_PX) {
            amount = -MAX_SPEED_PX * (1 - Math.max(0, pointerY - bounds.top) / EDGE_ZONE_PX);
        } else if (pointerY > bounds.bottom - EDGE_ZONE_PX) {
            amount = MAX_SPEED_PX * (1 - Math.max(0, bounds.bottom - pointerY) / EDGE_ZONE_PX);
        }
        if (amount === 0) return;
        const before = scrollContainer.scrollTop;
        scrollContainer.scrollTop += amount;
        if (scrollContainer.scrollTop !== before) {
            onPositionChange(pointerY);
            frame = requestAnimationFrame(tick);
        }
    };

    return {
        update: (clientY) => {
            pointerY = clientY;
            if (!frame) frame = requestAnimationFrame(tick);
        },
        stop: () => {
            pointerY = null;
            if (frame) cancelAnimationFrame(frame);
            frame = null;
        }
    };
}

function bindMouseHandleDrag(handle, item, moveItem, finishDrag, autoScroller) {
    // WKWebView on macOS reliably supplies the classic mouse events here;
    // use them instead of HTML5 drag or PointerEvent capture.
    handle.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        item.classList.add('dragging');
        event.preventDefault();
        event.stopPropagation();

        const moveMouseDrag = (moveEvent) => {
            moveEvent.preventDefault();
            moveItem(moveEvent.clientY);
            autoScroller.update(moveEvent.clientY);
        };
        const finishMouseDrag = (upEvent) => {
            document.removeEventListener('mousemove', moveMouseDrag);
            document.removeEventListener('mouseup', finishMouseDrag);
            finishDrag();
            upEvent.preventDefault();
        };
        document.addEventListener('mousemove', moveMouseDrag);
        document.addEventListener('mouseup', finishMouseDrag);
    });
}

function setupDragging(container) {
    let draggingItem = null;
    const LONG_PRESS_MS = 850;
    const moveItem = (clientY) => {
        if (!draggingItem) return;
        const afterElement = getDragAfterElement(container, clientY);
        if (afterElement) container.insertBefore(draggingItem, afterElement);
        else {
            const archivePanel = container.querySelector('.archive-panel');
            if (archivePanel) container.insertBefore(draggingItem, archivePanel);
            else container.appendChild(draggingItem);
        }
    };
    const autoScroller = createDragAutoScroller(moveItem);

    container.querySelectorAll('.target-item:not(.archived-list-item)').forEach(item => {
        let longPressTimer = null;
        let longPressTriggered = false;
        let touchStartX = 0;
        let touchStartY = 0;

        const clearLongPressTimer = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };

        item.addEventListener('dragstart', (e) => {
            clearLongPressTimer();
            draggingItem = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggingItem = null;
            autoScroller.stop();

            saveTargetOrder(container, '.target-item:not(.archived-list-item)');
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            moveItem(e.clientY);
        });

        item.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.drag-handle')) return;
            e.preventDefault();
            showEditTargetModal(item.dataset.id);
        });

        item.addEventListener('touchstart', (e) => {
            if (e.target.closest('.drag-handle')) return;
            if (!e.touches || e.touches.length !== 1) return;
            longPressTriggered = false;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            clearLongPressTimer();
            longPressTimer = setTimeout(() => {
                longPressTriggered = true;
                showEditTargetModal(item.dataset.id);
            }, LONG_PRESS_MS);
        }, { passive: true });

        item.addEventListener('touchmove', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > 8 || dy > 8) {
                clearLongPressTimer();
            }
        }, { passive: true });

        item.addEventListener('touchend', clearLongPressTimer, { passive: true });
        item.addEventListener('touchcancel', clearLongPressTimer, { passive: true });

        // iOS does not support HTML5 drag and drop for ordinary page elements.
        // Reorder from the existing handle so a long press on the rest of the
        // card can remain the edit gesture.
        const dragHandle = item.querySelector('.drag-handle');
        if (dragHandle) {
            let handleDragging = false;
            const finishHandleDrag = () => {
                item.classList.remove('dragging');
                draggingItem = null;
                handleDragging = false;
                autoScroller.stop();
                saveTargetOrder(container, '.target-item:not(.archived-list-item)');
            };
            dragHandle.addEventListener('touchstart', (event) => {
                if (event.touches.length !== 1) return;
                clearLongPressTimer();
                handleDragging = true;
                draggingItem = item;
                item.classList.add('dragging');
                event.preventDefault();
                event.stopPropagation();
            }, { passive: false });
            dragHandle.addEventListener('touchmove', (event) => {
                if (!handleDragging || event.touches.length !== 1) return;
                event.preventDefault();
                event.stopPropagation();
                const clientY = event.touches[0].clientY;
                moveItem(clientY);
                autoScroller.update(clientY);
            }, { passive: false });
            const finishTouchHandleDrag = (event) => {
                if (!handleDragging) return;
                event.preventDefault();
                event.stopPropagation();
                finishHandleDrag();
            };
            dragHandle.addEventListener('touchend', finishTouchHandleDrag, { passive: false });
            dragHandle.addEventListener('touchcancel', finishTouchHandleDrag, { passive: false });
            bindMouseHandleDrag(dragHandle, item, (clientY) => {
                draggingItem = item;
                moveItem(clientY);
            }, finishHandleDrag, autoScroller);
        }

        // Handle item click (only if not dragging)
        item.addEventListener('click', (e) => {
            if (longPressTriggered) {
                longPressTriggered = false;
                e.preventDefault();
                return;
            }
            if (item.classList.contains('dragging')) return;
            // If clicked on drag handle, don't trigger detail view? 
            // Actually, for better UX, clicking anywhere BUT the handle can still work, 
            // but usually we just handle the whole item. Let's ensure it's not a drag.
            if (e.target.closest('.drag-handle')) return;

            state.selectedTargetId = item.dataset.id;
            switchView('detail');
        });
    });
}

function showEditTargetModal(targetId) {
    const target = state.targets.find(t => t.id === targetId);
    if (!target) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="modal-title">ターゲット編集</h2>
            <div class="form-group">
                <label>種別</label>
                <div class="type-selector">
                    <label class="type-option">
                        <input type="radio" name="edit-target-type" value="study" ${target.type === 'study' ? 'checked' : ''}>
                        <span>勉強・仕事<br><small>（時間管理あり）</small></span>
                    </label>
                    <label class="type-option">
                        <input type="radio" name="edit-target-type" value="event" ${target.type === 'event' ? 'checked' : ''}>
                        <span>イベント<br><small>（日数のみ）</small></span>
                    </label>
                </div>
            </div>
            <div class="form-group">
                <label>ターゲット名（目的）</label>
                <input type="text" id="edit-target-name" placeholder="例: 英検準1級、定期テスト">
            </div>
            <div class="form-group">
                <label>開始日</label>
                <input type="date" id="edit-target-start-date">
            </div>
            <div class="form-group">
                <label>締切日（目標日）</label>
                <input type="date" id="edit-target-date">
            </div>
            <div class="form-group">
                <label>カラー</label>
                <select id="edit-target-color">
                    <option value="#ff8c00">オレンジ</option>
                    <option value="#00e676">ミントグリーン</option>
                    <option value="#2196f3">ブルー</option>
                    <option value="#ff4b4b">レッド</option>
                    <option value="#9c27b0">パープル</option>
                    <option value="#fdd835">イエロー</option>
                    <option value="#8bc34a">ライム</option>
                    <option value="#00bfa5">ティール</option>
                    <option value="#00bcd4">シアン</option>
                    <option value="#3f51b5">インディゴ</option>
                    <option value="#ec407a">ピンク</option>
                    <option value="#795548">ブラウン</option>
                    <option value="#90a4ae">グレー</option>
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn btn-ghost" id="edit-archive-target-btn">${archiveActionLabel(target)}</button>
                <button class="btn btn-ghost" id="edit-modal-cancel">キャンセル</button>
                <button class="btn btn-primary" id="edit-modal-save">更新</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const startDate = target.startDate || toLocalDateString(new Date(target.createdAt || Date.now()));
    modal.querySelector('#edit-target-name').value = target.name || '';
    modal.querySelector('#edit-target-start-date').value = startDate;
    modal.querySelector('#edit-target-date').value = target.targetDate || startDate;
    modal.querySelector('#edit-target-color').value = target.color || '#ff8c00';

    modal.querySelector('#edit-modal-cancel').onclick = () => modal.remove();
    modal.querySelector('#edit-archive-target-btn').onclick = async () => {
        const nextArchived = !isTargetArchived(target);
        const prompt = nextArchived
            ? 'このターゲットをアーカイブしますか？ データは削除されません。'
            : 'このターゲットを通常表示へ戻しますか？';
        if (!await confirmInApp(prompt)) return;
        target.archived = nextArchived;
        target.archiveOverride = !nextArchived;
        storage.save();
        modal.remove();
        switchView('list');
    };
    modal.querySelector('#edit-modal-save').onclick = () => {
        const nextType = modal.querySelector('input[name="edit-target-type"]:checked').value;
        const name = modal.querySelector('#edit-target-name').value.trim();
        const startDateVal = modal.querySelector('#edit-target-start-date').value;
        const targetDateVal = modal.querySelector('#edit-target-date').value;
        const color = modal.querySelector('#edit-target-color').value;

        if (!name || !startDateVal || !targetDateVal) {
            alert('名前・開始日・締切日を入力してください');
            return;
        }

        if (startDateVal > targetDateVal) {
            alert('開始日は締切日以前にしてください');
            return;
        }

        target.type = nextType;
        target.name = name;
        target.startDate = startDateVal;
        target.targetDate = targetDateVal;
        target.color = color;

        if (nextType === 'study' && (!Array.isArray(target.tasks) || target.tasks.length === 0)) {
            target.tasks = [{ id: crypto.randomUUID(), title: '基本学習', weight: 1 }];
        }

        storage.save();
        modal.remove();
        renderList();
    };
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.target-item:not(.archived-list-item):not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function saveTargetOrder(container, itemSelector) {
    const targetsById = new Map(state.targets.map(target => [target.id, target]));
    const orderedIds = Array.from(container.querySelectorAll(itemSelector)).map(item => item.dataset.id);
    const reordered = orderedIds.map(id => targetsById.get(id)).filter(Boolean);

    if (reordered.length !== getDisplayedTargets().length) return;
    reorderDisplayedTargets(reordered);
}

function getRoadDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.road-item-container:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function setupRoadDragging(container) {
    let draggingItem = null;
    const moveItem = (clientY) => {
        if (!draggingItem) return;
        const afterElement = getRoadDragAfterElement(container, clientY);
        if (afterElement) container.insertBefore(draggingItem, afterElement);
        else container.appendChild(draggingItem);
    };
    const autoScroller = createDragAutoScroller(moveItem);

    container.querySelectorAll('.road-item-container').forEach(item => {
        item.addEventListener('dragstart', (event) => {
            draggingItem = item;
            item.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggingItem = null;
            autoScroller.stop();
            saveTargetOrder(container, '.road-item-container');
        });
        item.addEventListener('dragover', (event) => {
            event.preventDefault();
            moveItem(event.clientY);
        });

        // On touch devices only this visible grip moves a Road card. This avoids
        // competing with ordinary scrolls and the List screen's long-press edit.
        const roadDragHandle = item.querySelector('[data-road-drag-handle]');
        if (roadDragHandle) {
            let handleDragging = false;
            let startX = 0;
            let startY = 0;
            roadDragHandle.addEventListener('touchstart', (event) => {
                if (event.touches.length !== 1) return;
                startX = event.touches[0].clientX;
                startY = event.touches[0].clientY;
                event.stopPropagation();
            }, { passive: true });
            roadDragHandle.addEventListener('touchmove', (event) => {
                if (event.touches.length !== 1) return;
                const touch = event.touches[0];
                if (!handleDragging) {
                    if (Math.abs(touch.clientX - startX) < 6 && Math.abs(touch.clientY - startY) < 6) return;
                    handleDragging = true;
                    draggingItem = item;
                    item.classList.add('dragging');
                }
                event.preventDefault();
                event.stopPropagation();
                moveItem(touch.clientY);
                autoScroller.update(touch.clientY);
            }, { passive: false });
            const finishRoadHandleDrag = () => {
                item.classList.remove('dragging');
                draggingItem = null;
                handleDragging = false;
                autoScroller.stop();
                saveTargetOrder(container, '.road-item-container');
            };
            const finishTouchRoadHandleDrag = (event) => {
                if (!handleDragging) return;
                event.preventDefault();
                event.stopPropagation();
                finishRoadHandleDrag();
            };
            roadDragHandle.addEventListener('touchend', finishTouchRoadHandleDrag, { passive: false });
            roadDragHandle.addEventListener('touchcancel', finishTouchRoadHandleDrag, { passive: false });
            bindMouseHandleDrag(roadDragHandle, item, (clientY) => {
                draggingItem = item;
                moveItem(clientY);
            }, finishRoadHandleDrag, autoScroller);
        }
    });
}

function renderRoad() {
    const roadContainer = document.getElementById('road-view');
    if (!roadContainer) return;
    const displayedTargets = getDisplayedTargets();
    const archivedTargets = getArchivedTargets();

    if (displayedTargets.length === 0 && archivedTargets.length === 0) {
        roadContainer.innerHTML = '<h1 class="glow-text">Time Road</h1><div class="empty-state">ターゲットがありません。</div>';
        return;
    }

    const today = timeUtils.startOfDay(new Date());
    let roadHtml = '<h1 class="glow-text">Time Road</h1>';

    displayedTargets.forEach((target, index) => {
        const start = timeUtils.startOfDay(new Date(target.startDate || target.createdAt || Date.now()));
        const end = timeUtils.startOfDay(new Date(target.targetDate));

        const totalDays = timeUtils.calcCalendarDays(start, end);
        const elapsed = timeUtils.calcCalendarDays(start, today);
        const remaining = totalDays - elapsed;

        // 比率計算関数 (0% to 100%)
        const getPos = (date) => {
            if (totalDays <= 0) return 50; // 当日のみの場合は中央
            const d = timeUtils.calcCalendarDays(start, date);
            return Math.min(100, Math.max(0, (d / totalDays) * 100));
        };

        const todayPos = getPos(today);

        // 目盛り（Tick）の生成ロジック
        const ticks = [25, 50, 75]; // 0%と100%はマーカーと被るので除外
        const ticksHtml = ticks.map(percent => {
            const date = new Date(start);
            date.setDate(start.getDate() + Math.round((totalDays * percent) / 100));
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            const remDays = Math.max(0, totalDays - Math.round((totalDays * percent) / 100) - elapsed);
            const relativeRem = Math.max(0, Math.round((totalDays * (100 - percent)) / 100));

            return `
                <div class="road-tick" style="left: ${percent}%;">
                    <div class="tick-line"></div>
                    <div class="tick-label">
                        <div class="tick-percent">${percent}%</div>
                        <div class="tick-date">${dateStr}</div>
                        <div class="marker-remaining">あと${relativeRem}日</div>
                    </div>
                </div>
            `;

        }).join('');

        const stickmanHtml = `
            <div class="stickman">
                <div class="stickman-head"></div>
                <div class="stickman-body"></div>
                <div class="stickman-arm arm-left"></div>
                <div class="stickman-arm arm-right"></div>
                <div class="stickman-leg leg-left"></div>
                <div class="stickman-leg leg-right"></div>
            </div>
        `;

        roadHtml += `
            <div class="road-item-container" data-id="${target.id}" draggable="true">
                <div data-road-drag-handle style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; min-width: 0;">
                        <span class="road-drag-grip" aria-label="並び替え">☰</span>
                        <div class="road-target-name" style="color: ${target.color}">${target.name}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div class="road-countdown-badge">
                            <span>あと</span>
                            <span style="color: ${target.color}; font-size: 1.1rem; margin: 0 4px;">${remaining}</span>
                            <span>日</span>
                        </div>
                        <div class="target-order-controls road-order-controls" aria-label="順序を変更">
                            <button class="order-step-btn" data-move-target="up" data-target-id="${target.id}" ${index === 0 ? 'disabled' : ''} aria-label="上へ">▲</button>
                        <button class="order-step-btn" data-move-target="down" data-target-id="${target.id}" ${index === displayedTargets.length - 1 ? 'disabled' : ''} aria-label="下へ">▼</button>
                        </div>
                    </div>
                </div>
                
                <div class="road-scroller">
                    <div class="road-container">
                        <div class="road-bar"></div>
                        
                        <!-- 目盛り -->
                        ${ticksHtml}

                        <!-- 開始点 -->
                        <div class="road-marker" style="left: 0%;">
                            <div class="marker-label">START</div>
                            <div class="marker-dot"></div>
                            <div class="marker-date">${start.getMonth() + 1}/${start.getDate()}</div>
                        </div>

                        <!-- 今日 -->
                        <div class="road-marker marker-today" style="left: ${todayPos}%;">
                            ${stickmanHtml}
                            <div class="marker-label">TODAY</div>
                            <div class="marker-remaining">あと${remaining}日</div>
                        </div>

                        <!-- 目標日 -->
                        <div class="road-marker" style="left: 100%;">
                            <div class="marker-label">GOAL</div>
                            <div class="marker-dot"></div>
                            <div class="marker-date">${end.getMonth() + 1}/${end.getDate()}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;



    });

    if (displayedTargets.length === 0) {
        roadHtml += '<div class="empty-state">通常表示のターゲットはありません。</div>';
    }

    if (archivedTargets.length > 0) {
        roadHtml += `
            <details class="archive-panel road-archive-panel">
                <summary>アーカイブ　${archivedTargets.length}件</summary>
                <div class="archive-list">
                    ${archivedTargets.map(target => {
                        const start = timeUtils.startOfDay(new Date(target.startDate || target.createdAt || Date.now()));
                        const end = timeUtils.startOfDay(new Date(target.targetDate));
                        const totalDays = timeUtils.calcCalendarDays(start, end);
                        const elapsed = timeUtils.calcCalendarDays(start, today);
                        const remaining = totalDays - elapsed;
                        const todayPos = totalDays <= 0 ? 100 : Math.min(100, Math.max(0, (elapsed / totalDays) * 100));
                        return `
                            <div class="archive-road-item" data-id="${target.id}">
                                <div class="archive-road-header">
                                    <div>
                                        <span class="target-archive-badge">ARCHIVED</span>
                                        <div class="road-target-name" style="color: ${target.color}">${target.name}</div>
                                    </div>
                                    <div class="archive-target-actions">
                                        <div class="road-countdown-badge"><span>あと</span><span style="color: ${target.color}; font-size: 1.1rem; margin: 0 4px;">${remaining}</span><span>日</span></div>
                                        <button class="btn btn-ghost btn-sm" data-restore-target="${target.id}">復元</button>
                                    </div>
                                </div>
                                <div class="road-scroller">
                                    <div class="road-container">
                                        <div class="road-bar"></div>
                                        <div class="road-marker" style="left: 0%;"><div class="marker-label">START</div><div class="marker-dot"></div><div class="marker-date">${start.getMonth() + 1}/${start.getDate()}</div></div>
                                        <div class="road-marker marker-today" style="left: ${todayPos}%;"><div class="marker-label">TODAY</div><div class="marker-remaining">あと${remaining}日</div></div>
                                        <div class="road-marker" style="left: 100%;"><div class="marker-label">GOAL</div><div class="marker-dot"></div><div class="marker-date">${end.getMonth() + 1}/${end.getDate()}</div></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </details>
        `;
    }

    roadContainer.innerHTML = roadHtml;
    setupRoadDragging(roadContainer);
    bindOrderStepButtons(roadContainer, renderRoad);
    bindArchiveRestoreButtons(roadContainer, renderRoad);
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
                <label>開始日</label>
                <input type="date" id="new-target-start-date" value="${new Date().toISOString().split('T')[0]}">
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
                    <option value="#fdd835">イエロー</option>
                    <option value="#8bc34a">ライム</option>
                    <option value="#00bfa5">ティール</option>
                    <option value="#00bcd4">シアン</option>
                    <option value="#3f51b5">インディゴ</option>
                    <option value="#ec407a">ピンク</option>
                    <option value="#795548">ブラウン</option>
                    <option value="#90a4ae">グレー</option>
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
        const startDate = document.getElementById('new-target-start-date').value;
        const date = document.getElementById('new-target-date').value;
        const color = document.getElementById('new-target-color').value;

        if (name && startDate && date) {
            const newTarget = {
                id: crypto.randomUUID(),
                type: type,
                name: name,
                startDate: startDate,
                targetDate: date,
                color: color,
                tasks: [],
                archived: false,
                archiveOverride: false,
                createdAt: Date.now()
            };
            if (type === 'study') {
                newTarget.tasks.push({ id: crypto.randomUUID(), title: '基本学習', weight: 1 });
            }
            // Keep every existing target in its current relative order. Only
            // the new target is inserted before the first later deadline.
            const insertAt = state.targets.findIndex(target => target.targetDate > newTarget.targetDate);
            if (insertAt === -1) state.targets.push(newTarget);
            else state.targets.splice(insertAt, 0, newTarget);
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
document.addEventListener('DOMContentLoaded', async () => {
    storage.load();
    applyDisplayScale();
    await storage.loadHolidays();
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

// The packaged app ships its files inside the installed bundle. Service Worker is
// only needed by the separately maintained browser/PWA fallback.
const isPackagedApp = '__TAURI_INTERNALS__' in window;
if (!isPackagedApp && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}

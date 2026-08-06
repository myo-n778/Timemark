// --- Constants & Config ---
const ROUND_STEP = 0.5;
const DEFAULT_SYNC_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzU_sk43O2X6vqOxuMs48Cm7-sQfIxD1ysxdVkQCKNFkznjSAOpJmQTb4qwkuFjEcB0fg/exec';
const LEGACY_SYNC_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzwVWyj8-LVBgjMNPKqDLkJtX8YZyUhYzyeMTcO5KlVH9W2Yac0lTPjuACBrLRot6Je/exec';

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
    timePeriods: [] // [ { id, name, start, end, weeklyHours: {...} } ]
};
// target structure example:
// { id, name, startDate, targetDate, color, type: 'study'|'event', tasks: [], createdAt }

function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function normalizeTarget(target) {
    const t = target || {};
    const hasStartDate = typeof t.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.startDate);
    if (hasStartDate) return t;

    let startDate = toLocalDateString(new Date());
    if (t.createdAt) {
        const created = new Date(t.createdAt);
        if (!isNaN(created)) {
            startDate = toLocalDateString(created);
        }
    }

    return { ...t, startDate };
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
            timePeriods: state.timePeriods
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
            timePeriods: state.timePeriods
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

const syncUtils = {
    configKey: 'timemark_sync_config',

    getConfig: () => {
        try {
            const saved = JSON.parse(localStorage.getItem(syncUtils.configKey) || '{}');
            return {
                endpoint: saved.endpoint === LEGACY_SYNC_ENDPOINT ? DEFAULT_SYNC_ENDPOINT : (saved.endpoint || DEFAULT_SYNC_ENDPOINT),
                token: saved.token || '',
                userId: saved.userId || '',
                userName: saved.userName || '',
                scheduleSheet: saved.scheduleSheet || 'TimeMarkSchedule'
            };
        } catch (e) {
            return { endpoint: '', token: '', userId: '', userName: '', scheduleSheet: 'TimeMarkSchedule' };
        }
    },

    saveConfig: (config) => {
        const current = syncUtils.getConfig();
        localStorage.setItem(syncUtils.configKey, JSON.stringify({ ...current, ...config }));
    },

    request: async (action, payload = {}) => {
        const config = syncUtils.getConfig();
        if (!config.endpoint) throw new Error('Apps Script URLを入力してください');

        const response = await fetch(config.endpoint, {
            method: 'POST',
            body: JSON.stringify({
                action,
                token: config.token,
                ...payload
            })
        });
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text || '{}');
        } catch (e) {
            throw new Error('Apps ScriptからJSON以外の応答が返りました。デプロイURLを確認してください');
        }

        if (!response.ok || !result.ok) {
            throw new Error(result.error || 'スプレッドシートとの通信に失敗しました');
        }
        return result;
    },

    listUsers: async () => {
        const result = await syncUtils.request('listUsers');
        return Array.isArray(result.users) ? result.users : [];
    },

    saveCurrentUser: async (userName) => {
        const name = (userName || '').trim();
        if (!name) throw new Error('ユーザー名を入力してください');

        const config = syncUtils.getConfig();
        const result = await syncUtils.request('saveUser', {
            userId: config.userId,
            userName: name,
            backup: backupUtils.createBackup()
        });

        syncUtils.saveConfig({
            userId: result.user?.userId || config.userId,
            userName: result.user?.userName || name
        });
        return result.user;
    },

    loadUser: async (userId) => {
        if (!userId) throw new Error('ユーザーを選択してください');

        const result = await syncUtils.request('loadUser', { userId });
        backupUtils.applyBackup(result.backup);
        syncUtils.saveConfig({
            userId: result.user?.userId || userId,
            userName: result.user?.userName || ''
        });
        return result.user;
    },

    loadSchedule: async (sheetName) => {
        const result = await syncUtils.request('loadSchedule', { sheetName });
        return Array.isArray(result.entries) ? result.entries : [];
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

function renderSettings() {
    const container = document.getElementById('settings-view');
    if (!container) return;
    const syncConfig = syncUtils.getConfig();

    const dayLabels = {
        mon: '月曜日', tue: '火曜日', wed: '水曜日', thu: '木曜日', fri: '金曜日',
        sat: '土曜日', sun: '日曜日', holiday: '祝日'
    };

    container.innerHTML = `
        <h1 class="glow-text">Settings</h1>
        
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
                <h2>期間指定（長期休暇など）</h2>
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
                <h2>スプレッドシート同期</h2>
                <span class="sync-status" id="sync-status">${syncConfig.userName ? `選択中: ${escapeHTML(syncConfig.userName)}` : '未選択'}</span>
            </div>
            <div class="sync-grid">
                <label class="sync-field sync-field-wide">
                    <span>Apps Script URL</span>
                    <input type="url" id="sync-url-input" value="${escapeHTML(syncConfig.endpoint)}" placeholder="https://script.google.com/macros/s/.../exec">
                </label>
                <label class="sync-field">
                    <span>共有トークン</span>
                    <input type="password" id="sync-token-input" value="${escapeHTML(syncConfig.token)}" placeholder="任意">
                </label>
                <label class="sync-field">
                    <span>ユーザー名</span>
                    <input type="text" id="sync-user-name-input" value="${escapeHTML(syncConfig.userName)}" placeholder="例: やましぃ先生">
                </label>
                <label class="sync-field">
                    <span>保存済みユーザー</span>
                    <select id="sync-user-select">
                        <option value="${escapeHTML(syncConfig.userId)}" data-user-name="${escapeHTML(syncConfig.userName)}">${syncConfig.userName ? escapeHTML(syncConfig.userName) : 'ユーザー一覧を取得してください'}</option>
                    </select>
                </label>
                <label class="sync-field sync-field-wide">
                    <span>予定表シート名（date・hours列）</span>
                    <input type="text" id="schedule-sheet-input" value="${escapeHTML(syncConfig.scheduleSheet)}" placeholder="TimeMarkSchedule">
                </label>
            </div>
            <div class="sync-actions">
                <button class="btn btn-ghost btn-sm" id="sync-save-config-btn">設定保存</button>
                <button class="btn btn-ghost btn-sm" id="sync-list-users-btn">ユーザー一覧取得</button>
                <button class="btn btn-primary btn-sm" id="sync-save-user-btn">このユーザーに保存</button>
                <button class="btn btn-ghost btn-sm" id="sync-load-user-btn">選択ユーザーを読み込み</button>
                <button class="btn btn-ghost btn-sm" id="sync-load-schedule-btn">予定表を読み込み</button>
            </div>
            <p class="sync-help">予定表シートの <code>date</code> と <code>hours</code> を、例外日の稼働時間として取り込みます。同じ日付の設定は上書きされます。</p>
        </section>

        <section class="settings-section">
            <div class="task-section-header">
                <h2>データ移行（端末間）</h2>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-ghost btn-sm" id="export-backup-btn">📤 エクスポート</button>
                    <button class="btn btn-primary btn-sm" id="import-backup-btn">📥 インポート</button>
                </div>
                <input type="file" id="backup-file-input" style="display: none;" accept=".json,application/json">
            </div>
            <p style="margin: 8px 0 0; color: var(--text-sub); font-size: 12px;">
                すべてのターゲット設定・例外日・期間設定・基準日を JSON で移行できます。
            </p>
        </section>

        <section class="settings-section">
            <div class="task-section-header">
                <h2>例外日（個別の予定）</h2>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-ghost btn-sm" id="export-csv-btn">📤 CSV</button>
                    <button class="btn btn-ghost btn-sm" id="export-ics-btn">📤 ICS</button>
                    <button class="btn btn-ghost btn-sm" id="import-file-btn">📥 インポート</button>
                    <button class="btn btn-primary btn-sm" id="add-exception-btn">+ 追加</button>
                </div>
                <input type="file" id="settings-file-input" style="display: none;" accept=".ics,.csv">
            </div>
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

    const syncStatus = container.querySelector('#sync-status');
    const syncUrlInput = container.querySelector('#sync-url-input');
    const syncTokenInput = container.querySelector('#sync-token-input');
    const syncUserNameInput = container.querySelector('#sync-user-name-input');
    const syncUserSelect = container.querySelector('#sync-user-select');
    const scheduleSheetInput = container.querySelector('#schedule-sheet-input');

    function saveSyncInputs() {
        const selectedOption = syncUserSelect.options[syncUserSelect.selectedIndex];
        const selectedName = selectedOption?.dataset.userName || '';
        const typedName = syncUserNameInput.value.trim();
        syncUtils.saveConfig({
            endpoint: syncUrlInput.value.trim(),
            token: syncTokenInput.value.trim(),
            userId: typedName && typedName !== selectedName ? '' : (syncUserSelect.value || syncUtils.getConfig().userId),
            userName: typedName || selectedName,
            scheduleSheet: scheduleSheetInput.value.trim() || 'TimeMarkSchedule'
        });
    }

    function setSyncStatus(message) {
        syncStatus.textContent = message;
    }

    function populateSyncUsers(users) {
        const config = syncUtils.getConfig();
        if (users.length === 0) {
            syncUserSelect.innerHTML = '<option value="">保存済みユーザーはありません</option>';
            return;
        }

        syncUserSelect.innerHTML = users.map(user => `
            <option value="${escapeHTML(user.userId)}" data-user-name="${escapeHTML(user.userName)}" ${user.userId === config.userId ? 'selected' : ''}>
                ${escapeHTML(user.userName)}
            </option>
        `).join('');
    }

    container.querySelector('#sync-save-config-btn').onclick = () => {
        saveSyncInputs();
        setSyncStatus('設定を保存しました');
    };

    container.querySelector('#sync-list-users-btn').onclick = async () => {
        try {
            saveSyncInputs();
            setSyncStatus('取得中...');
            const users = await syncUtils.listUsers();
            populateSyncUsers(users);
            setSyncStatus(`${users.length}件のユーザーを取得しました`);
        } catch (err) {
            setSyncStatus(`取得失敗: ${err.message}`);
        }
    };

    syncUserSelect.onchange = () => {
        const selectedOption = syncUserSelect.options[syncUserSelect.selectedIndex];
        if (selectedOption?.dataset.userName) {
            syncUserNameInput.value = selectedOption.dataset.userName;
        }
        saveSyncInputs();
        setSyncStatus(syncUserNameInput.value ? `選択中: ${syncUserNameInput.value}` : '未選択');
    };

    container.querySelector('#sync-save-user-btn').onclick = async () => {
        try {
            saveSyncInputs();
            setSyncStatus('保存中...');
            const user = await syncUtils.saveCurrentUser(syncUserNameInput.value);
            syncUserSelect.innerHTML = `<option value="${escapeHTML(user.userId)}" data-user-name="${escapeHTML(user.userName)}">${escapeHTML(user.userName)}</option>`;
            syncUserSelect.value = user.userId;
            setSyncStatus(`保存しました: ${user.userName}`);
        } catch (err) {
            setSyncStatus(`保存失敗: ${err.message}`);
        }
    };

    container.querySelector('#sync-load-user-btn').onclick = async () => {
        try {
            saveSyncInputs();
            if (!confirm('現在の端末内データを、選択したユーザーのスプレッドシート上のデータで置き換えますか？')) return;
            setSyncStatus('読み込み中...');
            const user = await syncUtils.loadUser(syncUserSelect.value);
            switchView('list');
            setSyncStatus(`読み込みました: ${user.userName}`);
        } catch (err) {
            setSyncStatus(`読込失敗: ${err.message}`);
        }
    };

    container.querySelector('#sync-load-schedule-btn').onclick = async () => {
        try {
            saveSyncInputs();
            const sheetName = scheduleSheetInput.value.trim() || 'TimeMarkSchedule';
            if (!confirm(`「${sheetName}」の予定表を読み込み、同じ日付の例外日設定を上書きしますか？`)) return;
            setSyncStatus('予定表を読み込み中...');
            const entries = await syncUtils.loadSchedule(sheetName);
            entries.forEach(({ date, hours }) => {
                state.customDates[date] = hours;
            });
            storage.save();
            setSyncStatus(`${entries.length}日分の予定表を読み込みました`);
        } catch (err) {
            setSyncStatus(`予定表の読込失敗: ${err.message}`);
        }
    };

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

    // Setup Drag and Drop
    setupDragging(listContainer);
}

function setupDragging(container) {
    let draggingItem = null;
    const LONG_PRESS_MS = 550;

    container.querySelectorAll('.target-item').forEach(item => {
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

            saveTargetOrder(container, '.target-item');
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(container, e.clientY);
            if (afterElement == null) {
                container.appendChild(draggingItem);
            } else {
                container.insertBefore(draggingItem, afterElement);
            }
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
                </select>
            </div>
            <div class="modal-actions">
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
    const draggableElements = [...container.querySelectorAll('.target-item:not(.dragging)')];
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

    if (reordered.length !== state.targets.length) return;
    state.targets = reordered;
    storage.save();
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

    container.querySelectorAll('.road-item-container').forEach(item => {
        let touchTimer = null;
        let touchDragging = false;
        let startX = 0;
        let startY = 0;

        item.addEventListener('dragstart', (event) => {
            draggingItem = item;
            item.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggingItem = null;
            saveTargetOrder(container, '.road-item-container');
        });
        item.addEventListener('dragover', (event) => {
            event.preventDefault();
            moveItem(event.clientY);
        });

        item.addEventListener('touchstart', (event) => {
            if (event.touches.length !== 1) return;
            startX = event.touches[0].clientX;
            startY = event.touches[0].clientY;
            touchTimer = setTimeout(() => {
                touchDragging = true;
                draggingItem = item;
                item.classList.add('dragging');
            }, 400);
        }, { passive: true });
        item.addEventListener('touchmove', (event) => {
            if (event.touches.length !== 1) return;
            const touch = event.touches[0];
            if (!touchDragging) {
                if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
                    clearTimeout(touchTimer);
                    touchTimer = null;
                }
                return;
            }
            event.preventDefault();
            moveItem(touch.clientY);
        }, { passive: false });
        const finishTouchDrag = () => {
            clearTimeout(touchTimer);
            if (!touchDragging) return;
            item.classList.remove('dragging');
            touchDragging = false;
            draggingItem = null;
            saveTargetOrder(container, '.road-item-container');
        };
        item.addEventListener('touchend', finishTouchDrag, { passive: true });
        item.addEventListener('touchcancel', finishTouchDrag, { passive: true });
    });
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
        const start = timeUtils.startOfDay(new Date(target.startDate || target.createdAt || Date.now()));
        const end = timeUtils.startOfDay(new Date(target.targetDate));

        const totalDays = timeUtils.calcCalendarDays(start, end);
        const elapsed = timeUtils.calcCalendarDays(start, today);
        const remaining = Math.max(0, totalDays - elapsed);

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
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <div class="road-target-name" style="color: ${target.color}">${target.name}</div>
                    <div class="road-countdown-badge">
                        <span>あと</span>
                        <span style="color: ${target.color}; font-size: 1.1rem; margin: 0 4px;">${remaining}</span>
                        <span>日</span>
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

    roadContainer.innerHTML = roadHtml;
    setupRoadDragging(roadContainer);
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
document.addEventListener('DOMContentLoaded', async () => {
    storage.load();
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

// PWA: cache the app shell for reliable launch on iPhone, iPad, Mac, Android, and Windows.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}

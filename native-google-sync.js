// Native-only Google OAuth + Sheets bridge. Access tokens intentionally live
// only in memory; the spreadsheet ID is the only Google-related value kept in
// the app's normal local storage.

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';

// OAuth client IDs are public application identifiers, not secrets.
const CLIENTS = {
    ios: '281403148439-oejntdlhvf9f0ihq2bg5k9oeb0dm70g2.apps.googleusercontent.com',
    macos: '281403148439-vkuco809vt36jf0aleu6v2r08us6q0pb.apps.googleusercontent.com'
};

let session = null;

function isNativeApp() {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function invoke(command, args) {
    const nativeInvoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof nativeInvoke !== 'function') {
        throw new Error('Google同期はTimeMarkアプリ版で利用できます');
    }
    return nativeInvoke(command, args);
}

function bytesToBase64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomUrlSafeValue() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
}

async function sha256UrlSafe(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return bytesToBase64Url(hash);
}

function decodeIdToken(idToken) {
    try {
        const payload = idToken.split('.')[1];
        if (!payload) return {};
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4);
        return JSON.parse(atob(padded));
    } catch {
        return {};
    }
}

function platformConfig() {
    const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const clientId = isAppleMobile ? CLIENTS.ios : CLIENTS.macos;
    const scheme = `com.googleusercontent.apps.${clientId.split('.apps.')[0]}`;
    return { clientId, scheme, redirectUri: `${scheme}:/oauth2redirect` };
}

async function signIn() {
    if (!isNativeApp()) throw new Error('Google同期はTimeMarkアプリ版で利用できます');

    const { clientId, scheme, redirectUri } = platformConfig();
    const state = randomUrlSafeValue();
    const codeVerifier = randomUrlSafeValue();
    const authorizationUrl = new URL(GOOGLE_AUTHORIZE_URL);
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', GOOGLE_SCOPE);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', await sha256UrlSafe(codeVerifier));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('include_granted_scopes', 'true');

    const callbackUrl = await invoke('plugin:auth-session|start', {
        authUrl: authorizationUrl.toString(),
        callbackUrlScheme: scheme,
        ephemeral: false
    });
    const callback = new URL(callbackUrl);
    if (callback.searchParams.get('state') !== state) throw new Error('Googleログインの確認値が一致しません');
    const error = callback.searchParams.get('error');
    if (error) throw new Error(`Googleログインが完了しませんでした: ${error}`);
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('Googleから認可コードを受け取れませんでした');

    const tokens = await invoke('exchange_google_code', {
        code,
        codeVerifier,
        clientId,
        redirectUri
    });
    const identity = decodeIdToken(tokens.idToken || '');
    session = {
        accessToken: tokens.accessToken,
        expiresAt: Date.now() + Math.max(0, Number(tokens.expiresIn || 0) - 60) * 1000,
        email: typeof identity.email === 'string' ? identity.email : ''
    };
    return { email: session.email };
}

function requireAccessToken() {
    if (!session?.accessToken || session.expiresAt <= Date.now()) {
        session = null;
        throw new Error('Googleログインの有効期限が切れました。もう一度接続してください');
    }
    return session.accessToken;
}

export const googleNativeSync = {
    isAvailable: isNativeApp,
    signIn,
    getSession: () => session ? { email: session.email, expiresAt: session.expiresAt } : null,
    createSpreadsheet: () => invoke('create_timemark_sheet', { accessToken: requireAccessToken() }),
    saveBackup: (spreadsheetId, backupJson) => invoke('save_timemark_backup', {
        accessToken: requireAccessToken(), spreadsheetId, backupJson
    }),
    loadBackup: (spreadsheetId) => invoke('load_timemark_backup', {
        accessToken: requireAccessToken(), spreadsheetId
    }),
    loadSchedule: (spreadsheetId) => invoke('load_timemark_schedule', {
        accessToken: requireAccessToken(), spreadsheetId
    }),
    disconnect: () => { session = null; }
};

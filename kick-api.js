// ── kick-api.js ── Kick OAuth2 + API client
const KickAPI = (() => {
  const BASE = 'https://api.kick.com/public/v1';
  const AUTH_URL = 'https://id.kick.com/oauth/authorize';
  const TOKEN_URL = 'https://id.kick.com/oauth/token';

  // ── PKCE helpers ──────────────────────────────────
  function randomBase64(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }

  async function sha256Base64(plain) {
    const enc = new TextEncoder().encode(plain);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }

  // ── Auth flow ─────────────────────────────────────
  async function startOAuth() {
    const clientId = await KickDB.getConfig('clientId');
    if (!clientId) { showAlert('Primero guarda tu Client ID en Configurar Kick.'); return; }

    const verifier = randomBase64(32);
    const challenge = await sha256Base64(verifier);
    const state = randomBase64(8);

    await KickDB.setConfig('pkce_verifier', verifier);
    await KickDB.setConfig('oauth_state', state);

    const redirectUri = getRedirectUri();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'channel:read user:read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state
    });

    window.location.href = `${AUTH_URL}?${params}`;
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code) return false;

    const savedState = await KickDB.getConfig('oauth_state');
    if (state !== savedState) { console.error('State mismatch'); return false; }

    const verifier = await KickDB.getConfig('pkce_verifier');
    const clientId = await KickDB.getConfig('clientId');
    const clientSecret = await KickDB.getConfig('clientSecret');
    const redirectUri = getRedirectUri();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret || '',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    });

    try {
      const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const data = await r.json();
      if (data.access_token) {
        await KickDB.setConfig('access_token', data.access_token);
        await KickDB.setConfig('refresh_token', data.refresh_token || '');
        await KickDB.setConfig('token_expires', Date.now() + (data.expires_in || 3600) * 1000);
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
        return true;
      }
    } catch(e) { console.error('Token exchange error', e); }
    return false;
  }

  async function refreshToken() {
    const rt = await KickDB.getConfig('refresh_token');
    const clientId = await KickDB.getConfig('clientId');
    const clientSecret = await KickDB.getConfig('clientSecret');
    if (!rt) return false;
    try {
      const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret || '', refresh_token: rt });
      const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const data = await r.json();
      if (data.access_token) {
        await KickDB.setConfig('access_token', data.access_token);
        await KickDB.setConfig('token_expires', Date.now() + (data.expires_in || 3600) * 1000);
        return true;
      }
    } catch(e) {}
    return false;
  }

  async function getToken() {
    const exp = await KickDB.getConfig('token_expires');
    if (exp && Date.now() > exp - 60000) await refreshToken();
    return KickDB.getConfig('access_token');
  }

  function getRedirectUri() {
    return window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/') + 'index.html';
  }

  // ── API requests ──────────────────────────────────
  async function apiFetch(path, params = {}) {
    const token = await getToken();
    const url = new URL(BASE + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`API ${r.status}: ${r.statusText}`);
    return r.json();
  }

  // Public (no auth needed) via proxy
  async function publicFetch(path) {
    const PROXY = 'https://api.allorigins.win/raw?url=';
    const url = `https://kick.com/api/v1${path}`;
    const r = await fetch(PROXY + encodeURIComponent(url));
    if (!r.ok) throw new Error(`Proxy ${r.status}`);
    return r.json();
  }

  // ── Channel data ──────────────────────────────────
  async function getChannelInfo(username) {
    const slug = username.toLowerCase();
    // Public v1 first — works without auth and is most reliable
    try {
      const data = await publicFetch(`/channels/${slug}`);
      if (data?.slug) return normalizeChannelV1(data);
    } catch(e) { console.warn('Channel public fetch failed:', e); }
    // OAuth API as fallback
    try {
      const token = await getToken();
      if (token) {
        const data = await apiFetch('/channels', { broadcaster_user_login: slug });
        if (data?.data?.[0]) return normalizeChannel(data.data[0]);
      }
    } catch(e) { console.warn('Channel OAuth fetch failed:', e); }
    return null;
  }

  function normalizeChannel(d) {
    return {
      id: d.broadcaster_user_id,
      slug: d.broadcaster_user_login,
      name: d.broadcaster_user_name,
      followers: d.followers_count ?? 0,
      isLive: d.stream_is_live ?? false,
      livestream: d.stream_is_live ? {
        id: d.stream_id,
        title: d.stream_session_title || d.stream_title || '',
        viewers: d.stream_viewer_count ?? 0,
        category: d.stream_category_name || '',
        startedAt: d.stream_start_time || new Date().toISOString(),
      } : null
    };
  }

  function normalizeChannelV1(d) {
    const ls = d.livestream;
    return {
      id: d.user?.id || d.id,
      slug: d.slug,
      name: d.user?.username || d.slug,
      followers: d.followersCount ?? d.followers_count ?? 0,
      isLive: !!ls,
      livestream: ls ? {
        id: ls.id,
        title: ls.session_title || ls.title || '',
        viewers: ls.viewer_count ?? ls.viewers ?? 0,
        category: ls.categories?.[0]?.name || '',
        startedAt: ls.created_at || ls.start_time || new Date().toISOString(),
      } : null
    };
  }

  async function getVideos(username, page = 1) {
    // NOTE: The official API /public/v1/videos endpoint returns 404 for this lookup.
    // Always use the public v2 proxy endpoint which reliably returns VODs.
    const slug = username.toLowerCase();
    // Try v2 first
    try {
      const data = await publicFetch(`/channels/${slug}/videos?page=${page}&limit=20`);
      const arr = data?.data || (Array.isArray(data) ? data : []);
      if (arr.length) return arr.map(normalizeVideoV1);
    } catch(e) { console.warn('getVideos v2 failed:', e); }
    // Try v1 as fallback
    try {
      const PROXY2 = 'https://api.allorigins.win/raw?url=';
      const url = `https://kick.com/api/v2/channels/${slug}/videos?page=${page}&limit=20`;
      const r = await fetch(PROXY2 + encodeURIComponent(url));
      const data = await r.json();
      const arr = data?.data || (Array.isArray(data) ? data : []);
      return arr.map(normalizeVideoV1);
    } catch(e) { console.warn('getVideos v2 alt failed:', e); }
    return [];
  }

  function normalizeVideo(v) {
    return {
      kickId: String(v.video_id || v.id),
      title: v.session_title || v.title || 'Sin título',
      category: v.categories?.[0]?.name || '',
      startedAt: v.start_time || v.created_at,
      duration: v.duration || 0,
      views: v.views ?? 0,
      thumbnail: v.thumbnail || '',
      source: 'api'
    };
  }

  function normalizeVideoV1(v) {
    return {
      kickId: String(v.id || v.video_id),
      title: v.session_title || v.title || 'Sin título',
      category: v.categories?.[0]?.name || '',
      startedAt: v.start_time || v.created_at,
      duration: v.duration || 0,
      views: v.views ?? 0,
      thumbnail: v.thumbnail || '',
      source: 'v1'
    };
  }

  return { startOAuth, handleCallback, getToken, getChannelInfo, getVideos, getRedirectUri };
})();

window.KickAPI = KickAPI;

// ── Global helpers ────────────────────────────────────────
function showAlert(msg, type = 'warn') {
  const el = document.getElementById('alertBanner');
  const msgEl = document.getElementById('alertMsg');
  if (!el || !msgEl) return;
  msgEl.textContent = msg;
  el.style.display = 'flex';
  if (type === 'error') el.style.borderColor = '#ff4444';
  else el.style.borderColor = '#FFD700';
}

function fmtDur(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('es-ES');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

function getPeriodStart(days) {
  if (days === 'all') return new Date(0);
  const d = new Date();
  d.setDate(d.getDate() - Number(days));
  return d;
}

window.fmtDur = fmtDur;
window.fmtNum = fmtNum;
window.fmtDate = fmtDate;
window.fmtDateTime = fmtDateTime;
window.todayStr = todayStr;
window.getPeriodStart = getPeriodStart;
window.showAlert = showAlert;

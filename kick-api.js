// ── kick-api.js ── Multi-source Kick data collector
// Sources: kick.com public API (v1/v2), allorigins proxy, corsproxy.io, direct fetch
// NEVER calls api.kick.com/public/v1/videos — that endpoint doesn't exist.

const KickAPI = (() => {
  const AUTH_URL  = 'https://id.kick.com/oauth/authorize';
  const TOKEN_URL = 'https://id.kick.com/oauth/token';
  const OAUTH_BASE = 'https://api.kick.com/public/v1';

  // ── Proxy pool (tried in order until one works) ───────────
  const PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url => url
  ];

  async function proxyFetch(url, timeoutMs = 7000) {
    for (const proxy of PROXIES) {
      const proxyUrl = proxy(url);
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), timeoutMs);
        const r = await fetch(proxyUrl, { signal: ctrl.signal });
        clearTimeout(tid);
        if (!r.ok) continue;
        const text = await r.text();
        if (!text || text.trim().startsWith('<')) continue;
        return JSON.parse(text);
      } catch (e) { /* try next */ }
    }
    throw new Error(`All proxies failed for: ${url}`);
  }

  // ── PKCE helpers ──────────────────────────────────────────
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

  // ── OAuth ─────────────────────────────────────────────────
  async function startOAuth() {
    const clientId = await KickDB.getConfig('clientId');
    if (!clientId) { showAlert('Primero guarda tu Client ID.'); return; }
    const verifier = randomBase64(32);
    const challenge = await sha256Base64(verifier);
    const state = randomBase64(8);
    await KickDB.setConfig('pkce_verifier', verifier);
    await KickDB.setConfig('oauth_state', state);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: getRedirectUri(),
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
    if (state !== savedState) return false;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: await KickDB.getConfig('clientId'),
      client_secret: (await KickDB.getConfig('clientSecret')) || '',
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: await KickDB.getConfig('pkce_verifier')
    });
    try {
      const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const data = await r.json();
      if (data.access_token) {
        await KickDB.setConfig('access_token', data.access_token);
        await KickDB.setConfig('refresh_token', data.refresh_token || '');
        await KickDB.setConfig('token_expires', Date.now() + (data.expires_in || 3600) * 1000);
        window.history.replaceState({}, '', window.location.pathname);
        return true;
      }
    } catch(e) { console.error('Token exchange error', e); }
    return false;
  }

  async function getToken() {
    const exp = await KickDB.getConfig('token_expires');
    if (exp && Date.now() > exp - 60000) {
      try {
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: await KickDB.getConfig('clientId'),
          client_secret: (await KickDB.getConfig('clientSecret')) || '',
          refresh_token: await KickDB.getConfig('refresh_token')
        });
        const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const data = await r.json();
        if (data.access_token) {
          await KickDB.setConfig('access_token', data.access_token);
          await KickDB.setConfig('token_expires', Date.now() + (data.expires_in || 3600) * 1000);
        }
      } catch(e) {}
    }
    return KickDB.getConfig('access_token');
  }

  function getRedirectUri() {
    return window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/') + 'index.html';
  }

  async function oauthFetch(path, params = {}) {
    const token = await getToken();
    if (!token) throw new Error('No token');
    const url = new URL(OAUTH_BASE + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!r.ok) throw new Error(`OAuth ${r.status}`);
    return r.json();
  }

  // ── CHANNEL INFO — tries 3 sources ────────────────────────
  async function getChannelInfo(username) {
    const slug = username.toLowerCase();

    // Source 1: kick.com/api/v1/channels/{slug} — richest data, no auth needed
    try {
      const d = await proxyFetch(`https://kick.com/api/v1/channels/${slug}`);
      if (d?.slug) { console.log('[KickAPI] Channel ← v1 proxy ✓'); return normalizeV1(d); }
    } catch(e) { console.warn('[KickAPI] v1 channel:', e.message); }

    // Source 2: kick.com/api/v2/channels/{slug}
    try {
      const d = await proxyFetch(`https://kick.com/api/v2/channels/${slug}`);
      if (d?.slug || d?.channel) { console.log('[KickAPI] Channel ← v2 proxy ✓'); return normalizeV1(d?.channel || d); }
    } catch(e) { console.warn('[KickAPI] v2 channel:', e.message); }

    // Source 3: OAuth /channels (if token available)
    try {
      const d = await oauthFetch('/channels', { broadcaster_user_login: slug });
      if (d?.data?.[0]) { console.log('[KickAPI] Channel ← OAuth ✓'); return normalizeOAuthChannel(d.data[0]); }
    } catch(e) { console.warn('[KickAPI] OAuth channel:', e.message); }

    return null;
  }

  // ── VIDEOS — tries multiple sources, deduplicates ─────────
  async function getVideos(username, page = 1) {
    const slug = username.toLowerCase();

    // Source 1: v1 videos (most reliable)
    try {
      const d = await proxyFetch(`https://kick.com/api/v1/channels/${slug}/videos?page=${page}&limit=20`);
      const arr = d?.data || (Array.isArray(d) ? d : []);
      if (arr.length) { console.log(`[KickAPI] Videos ← v1 (${arr.length}) ✓`); return arr.map(normalizeVideoV1); }
    } catch(e) { console.warn('[KickAPI] v1 videos:', e.message); }

    // Source 2: v2 videos
    try {
      const d = await proxyFetch(`https://kick.com/api/v2/channels/${slug}/videos?page=${page}&limit=20`);
      const arr = d?.data || (Array.isArray(d) ? d : []);
      if (arr.length) { console.log(`[KickAPI] Videos ← v2 (${arr.length}) ✓`); return arr.map(normalizeVideoV1); }
    } catch(e) { console.warn('[KickAPI] v2 videos:', e.message); }

    // Source 3: OAuth /videos (this endpoint MAY exist in some regions)
    try {
      const d = await oauthFetch('/videos', { broadcaster_user_login: slug, page, per_page: 20 });
      const arr = d?.data || [];
      if (arr.length) { console.log(`[KickAPI] Videos ← OAuth (${arr.length}) ✓`); return arr.map(normalizeVideoOAuth); }
    } catch(e) { console.warn('[KickAPI] OAuth videos (expected if endpoint missing):', e.message); }

    return [];
  }

  // Fetch all pages until empty
  async function getAllVideos(username, maxPages = 15) {
    const slug = username.toLowerCase();
    const all = [];
    const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
      const batch = await getVideos(slug, page);
      if (!batch.length) break;
      let added = 0;
      for (const v of batch) {
        if (!seen.has(v.kickId)) { seen.add(v.kickId); all.push(v); added++; }
      }
      if (added === 0 || batch.length < 20) break;
      await new Promise(r => setTimeout(r, 400));
    }
    return all;
  }

  // ── Normalizers ───────────────────────────────────────────
  function normalizeV1(d) {
    const ls = d.livestream;
    return {
      id: String(d.user?.id || d.id || ''),
      slug: d.slug || '',
      name: d.user?.username || d.slug || '',
      followers: d.followersCount ?? d.followers_count ?? 0,
      isLive: !!ls,
      livestream: ls ? {
        id: String(ls.id || ''),
        title: ls.session_title || ls.title || '',
        viewers: ls.viewer_count ?? ls.viewers ?? 0,
        category: ls.categories?.[0]?.name || ls.category?.name || '',
        startedAt: ls.created_at || ls.start_time || new Date().toISOString(),
      } : null
    };
  }

  function normalizeOAuthChannel(d) {
    return {
      id: String(d.broadcaster_user_id || ''),
      slug: d.broadcaster_user_login || '',
      name: d.broadcaster_user_name || '',
      followers: d.followers_count ?? 0,
      isLive: d.stream_is_live ?? false,
      livestream: d.stream_is_live ? {
        id: String(d.stream_id || ''),
        title: d.stream_session_title || '',
        viewers: d.stream_viewer_count ?? 0,
        category: d.stream_category_name || '',
        startedAt: d.stream_start_time || new Date().toISOString(),
      } : null
    };
  }

  function normalizeVideoV1(v) {
    return {
      kickId: String(v.id || v.video_id || v.stream_id || Math.random()),
      title: v.session_title || v.title || 'Sin título',
      category: v.categories?.[0]?.name || v.category?.name || '',
      startedAt: v.start_time || v.created_at || v.published_at || null,
      duration: v.duration != null ? Number(v.duration) : 0,
      peakViewers: v.viewer_count || v.peak_viewer_count || 0,
      avgViewers: v.avg_viewer_count || 0,
      views: v.views || v.view_count || 0,
      thumbnail: v.thumbnail || v.thumbnail_url || '',
      source: 'proxy'
    };
  }

  function normalizeVideoOAuth(v) {
    return {
      kickId: String(v.video_id || v.id || Math.random()),
      title: v.session_title || v.title || 'Sin título',
      category: v.categories?.[0]?.name || '',
      startedAt: v.start_time || v.created_at || null,
      duration: v.duration || 0,
      peakViewers: v.viewer_count || 0,
      avgViewers: 0,
      views: v.views || 0,
      thumbnail: v.thumbnail || '',
      source: 'oauth'
    };
  }

  return { startOAuth, handleCallback, getToken, getRedirectUri, getChannelInfo, getVideos, getAllVideos };
})();

window.KickAPI = KickAPI;

// ── Global helpers ─────────────────────────────────────────────
function showAlert(msg, type = 'warn') {
  const el = document.getElementById('alertBanner');
  const msgEl = document.getElementById('alertMsg');
  if (!el || !msgEl) return;
  msgEl.textContent = msg;
  el.style.display = 'flex';
  el.style.borderColor = type === 'error' ? '#ff4444' : '#FFD700';
}
function fmtDur(s) {
  if (!s) return '—';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function fmtNum(n) { if (n == null) return '—'; return Number(n).toLocaleString('es-ES'); }
function fmtDate(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' }); }
function fmtDateTime(iso) { if (!iso) return '—'; return new Date(iso).toLocaleString('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function getPeriodStart(days) { if (days==='all') return new Date(0); const d=new Date(); d.setDate(d.getDate()-Number(days)); return d; }
window.fmtDur=fmtDur; window.fmtNum=fmtNum; window.fmtDate=fmtDate; window.fmtDateTime=fmtDateTime;
window.todayStr=todayStr; window.getPeriodStart=getPeriodStart; window.showAlert=showAlert;

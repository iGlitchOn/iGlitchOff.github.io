// ── kick-api.js ── Multi-source Kick data collector
// !! NEVER calls api.kick.com/public/v1/videos — that endpoint returns 404 !!
// Uses kick.com public endpoints via CORS proxies only.

const KickAPI = (() => {
  const AUTH_URL   = 'https://id.kick.com/oauth/authorize';
  const TOKEN_URL  = 'https://id.kick.com/oauth/token';
  const OAUTH_BASE = 'https://api.kick.com/public/v1';

  // Proxies tried in order. corsproxy.io is primary — works from GitHub Pages.
  const PROXY_FNS = [
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    u => `https://thingproxy.freeboard.io/fetch/${u}`,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ];

  async function proxyFetch(url, ms = 8000) {
    for (const fn of PROXY_FNS) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        const r = await fetch(fn(url), { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) { console.warn(`[proxy] ${r.status} via ${fn(url).split('?')[0]}`); continue; }
        const txt = await r.text();
        if (!txt || txt.trim()[0] === '<') continue; // HTML error page
        return JSON.parse(txt);
      } catch (e) { console.warn(`[proxy] failed: ${e.message}`); }
    }
    throw new Error(`All proxies failed: ${url}`);
  }

  // ── PKCE helpers ──────────────────────────────────────────
  const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); };
  async function s256(v) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)); return btoa(String.fromCharCode(...new Uint8Array(h))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }

  // ── OAuth ─────────────────────────────────────────────────
  async function startOAuth() {
    const clientId = await KickDB.getConfig('clientId');
    if (!clientId) { showAlert('Guarda tu Client ID primero.'); return; }
    const verifier = rnd(32), state = rnd(8);
    await KickDB.setConfig('pkce_verifier', verifier);
    await KickDB.setConfig('oauth_state', state);
    window.location.href = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId, redirect_uri: getRedirectUri(),
      response_type: 'code', scope: 'channel:read user:read',
      code_challenge: await s256(verifier), code_challenge_method: 'S256', state
    })}`;
  }

  async function handleCallback() {
    const p = new URLSearchParams(window.location.search);
    const code = p.get('code'), state = p.get('state');
    if (!code) return false;
    if (state !== await KickDB.getConfig('oauth_state')) return false;
    try {
      const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: await KickDB.getConfig('clientId'),
          client_secret: (await KickDB.getConfig('clientSecret')) || '',
          code, redirect_uri: getRedirectUri(),
          code_verifier: await KickDB.getConfig('pkce_verifier')
        })
      });
      const d = await r.json();
      if (d.access_token) {
        await KickDB.setConfig('access_token', d.access_token);
        await KickDB.setConfig('refresh_token', d.refresh_token || '');
        await KickDB.setConfig('token_expires', Date.now() + (d.expires_in || 3600) * 1000);
        window.history.replaceState({}, '', window.location.pathname);
        return true;
      }
    } catch(e) { console.error('Token error', e); }
    return false;
  }

  async function getToken() {
    const exp = await KickDB.getConfig('token_expires');
    if (exp && Date.now() > exp - 60000) {
      try {
        const r = await fetch(TOKEN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: await KickDB.getConfig('clientId'), client_secret: (await KickDB.getConfig('clientSecret'))||'', refresh_token: await KickDB.getConfig('refresh_token') })
        });
        const d = await r.json();
        if (d.access_token) { await KickDB.setConfig('access_token', d.access_token); await KickDB.setConfig('token_expires', Date.now()+(d.expires_in||3600)*1000); }
      } catch(e) {}
    }
    return KickDB.getConfig('access_token');
  }

  function getRedirectUri() {
    return window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/') + 'index.html';
  }

  // OAuth fetch — ONLY for endpoints confirmed to exist (channel info, NOT videos)
  async function oauthFetch(path, params = {}) {
    const token = await getToken();
    if (!token) throw new Error('no token');
    const url = new URL(OAUTH_BASE + path);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`OAuth ${r.status}`);
    return r.json();
  }

  // ── CHANNEL INFO ──────────────────────────────────────────
  // Source order: v1 proxy → v2 proxy → OAuth /channels
  async function getChannelInfo(username) {
    const slug = username.toLowerCase();

    try {
      const d = await proxyFetch(`https://kick.com/api/v1/channels/${slug}`);
      if (d?.slug) { console.log('[KickAPI] channel ← v1 ✓'); return normalizeV1Channel(d); }
    } catch(e) {}

    try {
      const d = await proxyFetch(`https://kick.com/api/v2/channels/${slug}`);
      const ch = d?.channel || d;
      if (ch?.slug) { console.log('[KickAPI] channel ← v2 ✓'); return normalizeV1Channel(ch); }
    } catch(e) {}

    try {
      const d = await oauthFetch('/channels', { broadcaster_user_login: slug });
      if (d?.data?.[0]) { console.log('[KickAPI] channel ← OAuth ✓'); return normalizeOAuthChannel(d.data[0]); }
    } catch(e) {}

    console.error('[KickAPI] all channel sources failed');
    return null;
  }

  // ── VIDEOS ────────────────────────────────────────────────
  // Source order: v1 proxy → v2 proxy → OAuth /videos (may not exist, last resort)
  // NEVER calls api.kick.com/public/v1/videos directly (404).
  async function getVideos(username, page = 1) {
    const slug = username.toLowerCase();

    // v1 public endpoint
    try {
      const d = await proxyFetch(`https://kick.com/api/v1/channels/${slug}/videos?page=${page}&limit=20`);
      const arr = d?.data || (Array.isArray(d) ? d : []);
      if (arr.length) { console.log(`[KickAPI] videos ← v1 (${arr.length}) ✓`); return arr.map(normalizeVideo); }
    } catch(e) { console.warn('[KickAPI] v1 videos:', e.message); }

    // v2 public endpoint
    try {
      const d = await proxyFetch(`https://kick.com/api/v2/channels/${slug}/videos?page=${page}&limit=20`);
      const arr = d?.data || (Array.isArray(d) ? d : []);
      if (arr.length) { console.log(`[KickAPI] videos ← v2 (${arr.length}) ✓`); return arr.map(normalizeVideo); }
    } catch(e) { console.warn('[KickAPI] v2 videos:', e.message); }

    // OAuth /videos — only tried if proxy sources fail, silently ignored if 404
    try {
      const d = await oauthFetch('/videos', { broadcaster_user_login: slug, page, per_page: 20 });
      const arr = d?.data || [];
      if (arr.length) { console.log(`[KickAPI] videos ← OAuth (${arr.length}) ✓`); return arr.map(normalizeVideo); }
    } catch(e) { /* 404 expected — ignored */ }

    console.warn('[KickAPI] all video sources failed for page', page);
    return [];
  }

  async function getAllVideos(username, maxPages = 15) {
    const slug = username.toLowerCase();
    const all = [], seen = new Set();
    for (let p = 1; p <= maxPages; p++) {
      const batch = await getVideos(slug, p);
      if (!batch.length) break;
      let added = 0;
      for (const v of batch) { if (!seen.has(v.kickId)) { seen.add(v.kickId); all.push(v); added++; } }
      if (!added || batch.length < 20) break;
      await new Promise(r => setTimeout(r, 400));
    }
    return all;
  }

  // ── Normalizers ───────────────────────────────────────────
  function normalizeV1Channel(d) {
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

  function normalizeVideo(v) {
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

  return { startOAuth, handleCallback, getToken, getRedirectUri, getChannelInfo, getVideos, getAllVideos };
})();

window.KickAPI = KickAPI;

// ── Helpers ───────────────────────────────────────────────────
function showAlert(msg, type = 'warn') {
  const el = document.getElementById('alertBanner'), m = document.getElementById('alertMsg');
  if (!el || !m) return;
  m.textContent = msg; el.style.display = 'flex';
  el.style.borderColor = type === 'error' ? '#ff4444' : '#FFD700';
}
function fmtDur(s) {
  if (!s) return '—';
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return h>0 ? `${h}h ${m}m` : m>0 ? `${m}m ${sec}s` : `${sec}s`;
}
function fmtNum(n) { return n==null ? '—' : Number(n).toLocaleString('es-ES'); }
function fmtDate(iso) { return !iso ? '—' : new Date(iso).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtDateTime(iso) { return !iso ? '—' : new Date(iso).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function getPeriodStart(days) { if(days==='all') return new Date(0); const d=new Date(); d.setDate(d.getDate()-Number(days)); return d; }
window.fmtDur=fmtDur; window.fmtNum=fmtNum; window.fmtDate=fmtDate; window.fmtDateTime=fmtDateTime;
window.todayStr=todayStr; window.getPeriodStart=getPeriodStart; window.showAlert=showAlert;

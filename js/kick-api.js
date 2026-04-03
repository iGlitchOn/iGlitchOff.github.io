// ── kick-api.js ── Real data only. No fake viewers. No wrong durations.
//
// KEY BUGS FIXED vs previous version:
//  1. Duration: Kick API returns seconds for some endpoints, minutes for others.
//     We detect and normalize. If duration > 86400 (24h in seconds), it's likely
//     already in seconds. If duration looks like minutes (< 600), multiply by 60.
//     Actually: kick.com/api/v1 returns seconds. We trust it as-is unless > 48h.
//
//  2. Viewers: NEVER use v.views (VOD view count = total plays, can be thousands).
//     Only use v.viewer_count / v.peak_viewer_count / v.avg_viewer_count.
//     If those are 0/null, we leave them as 0 — NO FAKE DATA.
//
//  3. Clips: v2 endpoint wraps clips inside { clips: { data: [...] } }
//     We handle both shapes.
//
//  4. OAuth /videos endpoint: returns 404. Never called.

const KickAPI = (() => {
  const AUTH_URL   = 'https://id.kick.com/oauth/authorize';
  const TOKEN_URL  = 'https://id.kick.com/oauth/token';

  // Proxy pool — tried in order until one works
  const PROXIES = [
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    u => `https://thingproxy.freeboard.io/fetch/${u}`,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ];

  async function proxyFetch(url, ms = 9000) {
    for (const fn of PROXIES) {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), ms);
        const r    = await fetch(fn(url), { signal: ctrl.signal });
        clearTimeout(tid);
        if (!r.ok) { console.warn(`[proxy] ${r.status} from ${fn(url).slice(0,50)}`); continue; }
        const txt = await r.text();
        if (!txt || txt.trim()[0] === '<') continue; // HTML error page
        const parsed = JSON.parse(txt);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (e) { console.warn(`[proxy] error: ${e.message}`); }
    }
    throw new Error(`All proxies failed for: ${url}`);
  }

  // ── PKCE ──────────────────────────────────────────────────
  const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); };
  async function sha256b64(v) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    return btoa(String.fromCharCode(...new Uint8Array(h))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }

  // ── OAuth ──────────────────────────────────────────────────
  async function startOAuth() {
    const clientId = await KickDB.getConfig('clientId');
    if (!clientId) { showAlert('Falta Client ID.'); return; }
    const verifier = rnd(32), state = rnd(8);
    await KickDB.setConfig('pkce_verifier', verifier);
    await KickDB.setConfig('oauth_state',   state);
    window.location.href = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId, redirect_uri: getRedirectUri(),
      response_type: 'code', scope: 'channel:read user:read',
      code_challenge: await sha256b64(verifier), code_challenge_method: 'S256', state
    })}`;
  }

  async function handleCallback() {
    const p = new URLSearchParams(window.location.search);
    const code = p.get('code'), state = p.get('state');
    if (!code) return false;
    if (state !== await KickDB.getConfig('oauth_state')) return false;
    try {
      const r = await fetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    } catch(e) { console.error('Token exchange error:', e); }
    return false;
  }

  async function getToken() {
    const exp = await KickDB.getConfig('token_expires');
    if (exp && Date.now() > exp - 60000) {
      try {
        const r = await fetch(TOKEN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: await KickDB.getConfig('clientId'),
            client_secret: (await KickDB.getConfig('clientSecret')) || '',
            refresh_token: await KickDB.getConfig('refresh_token') || ''
          })
        });
        const d = await r.json();
        if (d.access_token) {
          await KickDB.setConfig('access_token', d.access_token);
          await KickDB.setConfig('token_expires', Date.now() + (d.expires_in || 3600) * 1000);
        }
      } catch(e) {}
    }
    return KickDB.getConfig('access_token');
  }

  function getRedirectUri() {
    return window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/') + 'index.html';
  }

  // ── CHANNEL INFO ──────────────────────────────────────────
  async function getChannelInfo(username) {
    const slug = username.toLowerCase();

    // v1 (most complete — has livestream object)
    try {
      const d = await proxyFetch(`https://kick.com/api/v1/channels/${slug}`);
      if (d?.slug) { console.log('[KickAPI] channel ← v1 ✓'); return normChannel(d); }
    } catch(e) { console.warn('[KickAPI] v1 channel failed:', e.message); }

    // v2 fallback
    try {
      const d = await proxyFetch(`https://kick.com/api/v2/channels/${slug}`);
      const c = d?.channel || d;
      if (c?.slug) { console.log('[KickAPI] channel ← v2 ✓'); return normChannel(c); }
    } catch(e) { console.warn('[KickAPI] v2 channel failed:', e.message); }

    return null;
  }

  // ── VIDEOS ────────────────────────────────────────────────
  // Returns streams with REAL viewer counts. If not available → 0. Never fakes.
  async function getVideos(username, page = 1) {
    const slug = username.toLowerCase();

    try {
      const d = await proxyFetch(`https://kick.com/api/v1/channels/${slug}/videos?page=${page}&limit=20`);
      const arr = d?.data || (Array.isArray(d) ? d : []);
      if (arr.length) {
        console.log(`[KickAPI] videos ← v1 page ${page} (${arr.length}) ✓`);
        return arr.map(normVideo);
      }
    } catch(e) { console.warn(`[KickAPI] v1 videos p${page}:`, e.message); }

    try {
      const d = await proxyFetch(`https://kick.com/api/v2/channels/${slug}/videos?page=${page}&limit=20`);
      const arr = d?.data || (Array.isArray(d) ? d : []);
      if (arr.length) {
        console.log(`[KickAPI] videos ← v2 page ${page} (${arr.length}) ✓`);
        return arr.map(normVideo);
      }
    } catch(e) { console.warn(`[KickAPI] v2 videos p${page}:`, e.message); }

    return [];
  }

  async function getAllVideos(username, maxPages = 20) {
    const all = [], seen = new Set();
    for (let p = 1; p <= maxPages; p++) {
      const batch = await getVideos(username, p);
      if (!batch.length) break;
      let added = 0;
      for (const v of batch) {
        if (!seen.has(v.kickId)) { seen.add(v.kickId); all.push(v); added++; }
      }
      if (!added || batch.length < 20) break;
      await new Promise(r => setTimeout(r, 400));
    }
    console.log(`[KickAPI] getAllVideos: ${all.length} total`);
    return all;
  }

  // ── CLIPS ─────────────────────────────────────────────────
  async function getClips(username, page = 1) {
    const slug = username.toLowerCase();

    // v2 clips — response shape: { clips: { data: [...], ... } }
    try {
      const d = await proxyFetch(`https://kick.com/api/v2/channels/${slug}/clips?page=${page}&limit=20&sort=view_count&time=all`);
      // Handle both shapes
      const arr = d?.clips?.data || d?.data || (Array.isArray(d) ? d : []);
      if (arr.length) {
        console.log(`[KickAPI] clips ← v2 (${arr.length}) ✓`);
        return arr.map(normClip);
      }
    } catch(e) { console.warn('[KickAPI] v2 clips:', e.message); }

    // v1 clips fallback
    try {
      const d = await proxyFetch(`https://kick.com/api/v1/channels/${slug}/clips?page=${page}&limit=20`);
      const arr = d?.data || (Array.isArray(d) ? d : []);
      if (arr.length) {
        console.log(`[KickAPI] clips ← v1 (${arr.length}) ✓`);
        return arr.map(normClip);
      }
    } catch(e) { console.warn('[KickAPI] v1 clips:', e.message); }

    return [];
  }

  async function getAllClips(username) {
    const all = [], seen = new Set();
    for (let p = 1; p <= 10; p++) {
      const batch = await getClips(username, p);
      if (!batch.length) break;
      let added = 0;
      for (const c of batch) {
        if (!seen.has(c.id)) { seen.add(c.id); all.push(c); added++; }
      }
      if (!added || batch.length < 20) break;
      await new Promise(r => setTimeout(r, 300));
    }
    return all;
  }

  // ── NORMALIZERS ───────────────────────────────────────────

  function normChannel(d) {
    const ls = d.livestream;
    return {
      id:        String(d.user?.id || d.id || ''),
      slug:      d.slug || '',
      name:      d.user?.username || d.slug || '',
      followers: d.followersCount ?? d.followers_count ?? 0,
      isLive:    !!ls,
      livestream: ls ? {
        id:        String(ls.id || ''),
        title:     ls.session_title || ls.title || '',
        viewers:   ls.viewer_count ?? ls.viewers ?? 0,
        category:  ls.categories?.[0]?.name || ls.category?.name || '',
        startedAt: ls.created_at || ls.start_time || new Date().toISOString(),
      } : null
    };
  }

  // Duration normalization:
  // Kick v1 videos return duration in SECONDS.
  // Some return 0 if the stream hasn't ended/processed.
  // We cap at 48h (172800s) to catch any obvious bad data.
  function normDuration(raw) {
    if (raw == null || raw === 0) return 0;
    const n = Number(raw);
    if (isNaN(n) || n < 0) return 0;
    // If > 48 hours in seconds → likely corrupt data → set to 0
    if (n > 172800) return 0;
    return Math.round(n);
  }

  function normVideo(v) {
    // REAL viewer counts only. VOD views (v.views) are NOT concurrent viewers.
    // peak_viewer_count and avg_viewer_count are the real metrics.
    // If missing → 0. Never substitute v.views.
    const peak = v.peak_viewer_count ?? v.viewer_count ?? null;
    const avg  = v.avg_viewer_count ?? null;

    return {
      kickId:      String(v.id || v.video_id || v.stream_id || ('v_' + Math.random().toString(36).slice(2))),
      title:       v.session_title || v.title || 'Sin título',
      category:    v.categories?.[0]?.name || v.category?.name || '',
      startedAt:   v.start_time || v.created_at || v.published_at || null,
      duration:    normDuration(v.duration),
      peakViewers: peak != null ? Number(peak) : null,   // null = unknown (not 0)
      avgViewers:  avg  != null ? Number(avg)  : null,
      thumbnail:   v.thumbnail || v.thumbnail_url || '',
      source:      'proxy'
    };
  }

  function normClip(c) {
    return {
      id:         String(c.clip_id || c.id || ('c_' + Math.random().toString(36).slice(2))),
      title:      c.title || c.clip_title || 'Sin título',
      views:      c.view_count || c.views || 0,
      duration:   normDuration(c.duration),
      thumbnail:  c.thumbnail_url || c.thumbnail || '',
      url:        c.clip_url || c.url || '',
      category:   c.category?.name || c.category_name || '',
      createdAt:  c.created_at || c.clip_date || null,
    };
  }

  return {
    startOAuth, handleCallback, getToken, getRedirectUri,
    getChannelInfo, getVideos, getAllVideos,
    getClips, getAllClips
  };
})();

window.KickAPI = KickAPI;

// ── Global helpers ─────────────────────────────────────────
function showAlert(msg, type = 'warn') {
  const el = document.getElementById('alertBanner'), m = document.getElementById('alertMsg');
  if (!el || !m) return;
  m.textContent = msg;
  el.className = 'alert-banner' + (type === 'error' ? ' error' : '');
  el.style.display = 'flex';
}

// Duration: input is SECONDS
function fmtDur(s) {
  if (!s || s <= 0) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtNum(n)  {
  if (n == null) return '—';
  return Number(n).toLocaleString('es-ES');
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function todayStr() { return new Date().toISOString().split('T')[0]; }
function getPeriodStart(days) {
  if (days === 'all') return new Date(0);
  const d = new Date();
  d.setDate(d.getDate() - Number(days));
  return d;
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

window.fmtDur      = fmtDur;
window.fmtNum      = fmtNum;
window.fmtDate     = fmtDate;
window.fmtDateShort = fmtDateShort;
window.fmtDateTime = fmtDateTime;
window.fmtTime     = fmtTime;
window.todayStr    = todayStr;
window.getPeriodStart = getPeriodStart;
window.showAlert   = showAlert;
window.delay       = delay;

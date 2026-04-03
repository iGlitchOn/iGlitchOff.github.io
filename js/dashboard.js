// ── dashboard.js ── Main dashboard logic
// CLIENT_ID: public, safe to commit. SECRET: never stored here, only in browser IndexedDB.

const CHANNEL   = 'iglitchoff';
const CLIENT_ID = '01KK9JKQQ6V1MM0MFV6EFCFEDE';
const POLL_MS   = 30000; // 30s polling

let _pollTimer     = null;
let _liveTimer     = null;
let _liveStart     = null;
let _follMode      = 'daily';
let _viewerMetric  = 'peak';
let _allStreams     = [];
let _follHistory   = [];

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
async function init() {
  await KickDB.open();
  await KickDB.setConfig('clientId', CLIENT_ID);
  await KickDB.setConfig('username', CHANNEL);

  // OAuth callback
  if (window.location.search.includes('code=')) {
    const modal = $('callbackModal');
    if (modal) modal.style.display = 'flex';
    const ok = await KickAPI.handleCallback();
    setText('callbackMsg', ok ? '✅ Conectado. Cargando datos...' : '❌ Error de autenticación.');
    await delay(1500);
    if (modal) modal.style.display = 'none';
  }

  // Check secret → show setup if missing
  const secret = await KickDB.getConfig('clientSecret');
  if (!secret) { showSetup(); return; }

  // Update connect button
  const token = await KickDB.getConfig('access_token');
  const btn = $('btnConnect');
  if (token && btn) {
    btn.textContent = '✅ Conectado';
    btn.style.background = '#1a2a1a';
    btn.style.color = 'var(--green)';
  }

  const rdEl = $('redirectUrlDisplay');
  if (rdEl) rdEl.textContent = KickAPI.getRedirectUri();

  // Load cached data immediately
  _allStreams   = await KickDB.getAllStreams();
  _follHistory  = await KickDB.getFollowerHistory();

  if (_allStreams.length || _follHistory.length) {
    renderDashboard();
  }

  // Then sync fresh data
  await syncNow(false);

  startPolling();
}

// ══════════════════════════════════════════════════
// SETUP SCREEN
// ══════════════════════════════════════════════════
function showSetup() {
  const setup = $('setupScreen');
  const main  = document.querySelectorAll('.stats-grid,.charts-row,.tbl-card');
  if (setup) setup.style.display = 'block';
  main.forEach(el => el.style.display = 'none');
}

async function doSaveSecret() {
  const inp = $('setupSecretInput'), err = $('setupErr');
  const val = inp?.value.trim();
  if (!val) { if(err){err.textContent='Ingresa el Client Secret.';err.style.display='block';} return; }
  await KickDB.setConfig('clientSecret', val);
  window.location.reload();
}
window.doSaveSecret = doSaveSecret;

// ══════════════════════════════════════════════════
// SYNC — always fetches fresh from API
// ══════════════════════════════════════════════════
async function syncNow(showFeedback = true) {
  const username = await KickDB.getConfig('username') || CHANNEL;

  try {
    // Channel info
    const channel = await KickAPI.getChannelInfo(username);
    if (!channel) {
      if (showFeedback) showAlert('No se pudo conectar con Kick API.', 'error');
      return;
    }

    window._channelCache = channel;

    // Save follower snapshot
    await KickDB.saveFollowerSnapshot(todayStr(), channel.followers);

    // Handle live stream
    handleLive(channel);

    // Fetch ALL videos (paginated) — this is the main data source
    const videos = await KickAPI.getAllVideos(username);

    for (const v of videos) {
      await KickDB.saveStream({
        kickId:      v.kickId,
        title:       v.title,
        category:    v.category,
        startedAt:   v.startedAt,
        duration:    v.duration,     // already normalized in normVideo()
        peakViewers: v.peakViewers,  // null if unknown — not 0
        avgViewers:  v.avgViewers,
        thumbnail:   v.thumbnail,
        source:      v.source
      });
    }

    // Reload from DB
    _allStreams  = await KickDB.getAllStreams();
    _follHistory = await KickDB.getFollowerHistory();

    renderDashboard();

    setText('lastSync', 'Sync: ' + new Date().toLocaleTimeString('es-ES'));

  } catch(e) {
    console.error('Sync error:', e);
    if (showFeedback) showAlert('Error al sincronizar: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════════════
// RENDER DASHBOARD
// ══════════════════════════════════════════════════
function renderDashboard() {
  const period = $('periodSelect')?.value || '30';
  const start  = getPeriodStart(period);
  const streams = _allStreams.filter(s => s.startedAt && new Date(s.startedAt) >= start);
  const channel  = window._channelCache;

  updateStatCards(streams, _follHistory, channel);
  updateRecentTable(streams.slice(0, 10));
  buildDashCharts(streams, _follHistory);
}

// ══════════════════════════════════════════════════
// STAT CARDS
// ══════════════════════════════════════════════════
function updateStatCards(streams, fh, channel) {
  const followers = channel?.followers ?? (fh.length ? fh[fh.length-1].count : 0);
  const prev7 = fh.length > 1 ? (fh.find(f => new Date(f.date) <= new Date(Date.now()-7*86400000)) || fh[0]) : null;

  // Only count streams with real viewer data
  const withPeak = streams.filter(s => s.peakViewers != null);
  const withAvg  = streams.filter(s => s.avgViewers  != null);
  const peak  = withPeak.length ? Math.max(...withPeak.map(s=>s.peakViewers)) : null;
  const avg   = withAvg.length  ? Math.round(withAvg.reduce((a,s)=>a+s.avgViewers,0)/withAvg.length) : null;
  const withDur = streams.filter(s=>s.duration>0);
  const totalH  = withDur.reduce((a,s)=>a+s.duration,0)/3600;
  const goalPct = Math.min(100,Math.round((followers/1000)*100));
  const remaining = Math.max(0, 1000-followers);

  // ETA calculation
  let eta = '—';
  if (fh.length > 2) {
    const days = Math.max(1,(new Date(fh[fh.length-1].date)-new Date(fh[0].date))/86400000);
    const gain = followers - fh[0].count;
    const avgDay = gain/days;
    if (avgDay > 0) eta = Math.ceil(remaining/avgDay)+'d';
  }

  setText('valFollowers', fmtNum(followers));
  setText('valPeak',   peak != null ? fmtNum(peak) : 'Sin datos');
  setText('valAvg',    avg  != null ? fmtNum(avg)  : 'Sin datos');
  setText('valHours',  totalH > 0 ? totalH.toFixed(1)+'h' : '—');
  setText('valStreams', fmtNum(streams.length));
  setText('valGoal',   goalPct+'%');
  setText('goalEta',   remaining>0?`Faltan ${fmtNum(remaining)} · ETA: ${eta}`:'🎉 ¡Meta alcanzada!');
  setBar('goalBar', goalPct);

  if (prev7) {
    const gain = followers - prev7.count;
    const el = $('deltaFollowers');
    if (el) {
      el.textContent = (gain>=0?'+':'')+fmtNum(gain)+' últimos 7d';
      el.className = 'sc-delta ' + (gain>0?'pos':gain<0?'neg':'neu');
    }
  }

  // Note about viewers if no data
  const noteEl = $('viewersNote');
  if (noteEl) {
    if (!withPeak.length) noteEl.style.display='inline-flex';
    else noteEl.style.display='none';
  }
}

// ══════════════════════════════════════════════════
// RECENT STREAMS TABLE
// ══════════════════════════════════════════════════
function updateRecentTable(streams) {
  const tbody = $('recentTbody');
  if (!tbody) return;
  if (!streams.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-td">Sin streams. Empieza a streamear para ver datos.</td></tr>';
    return;
  }
  tbody.innerHTML = streams.map(s => {
    const peak = s.peakViewers != null ? fmtNum(s.peakViewers) : '<span style="color:var(--muted)">N/D</span>';
    const avg  = s.avgViewers  != null ? fmtNum(s.avgViewers)  : '<span style="color:var(--muted)">N/D</span>';
    return `<tr>
      <td style="color:var(--muted);font-size:11px">${fmtDateTime(s.startedAt)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.title||''}">${s.title||'—'}</td>
      <td><span class="badge bg">${s.category||'—'}</span></td>
      <td style="color:var(--green);font-weight:700">${fmtDur(s.duration)}</td>
      <td style="font-family:var(--mono)">${peak}</td>
      <td style="font-family:var(--mono)">${avg}</td>
      <td><a class="btn-sm" href="pages/stream-detail.html?id=${s.id||s.kickId}">Ver →</a></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════
// DASHBOARD CHARTS
// ══════════════════════════════════════════════════
function buildDashCharts(streams, fh) {
  const sorted = [...streams].reverse();
  const recent30 = sorted.slice(-30);

  KickCharts.buildViewerChart('chartViewers', recent30, _viewerMetric);
  KickCharts.buildCategoryChart('chartCats', streams);
  KickCharts.buildFollowerChart('chartFollowers', fh, _follMode);
  KickCharts.buildDurationChart('chartDuration', recent30);
  KickCharts.buildDowChart('chartDow', streams);
}

function switchViewerMetric(m, btn) {
  _viewerMetric = m;
  document.querySelectorAll('#viewerTabs .ctab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const period = $('periodSelect')?.value || '30';
  const streams = _allStreams.filter(s=>new Date(s.startedAt)>=getPeriodStart(period));
  KickCharts.buildViewerChart('chartViewers', [...streams].reverse().slice(-30), m);
}

function switchFollMode(m, btn) {
  _follMode = m;
  document.querySelectorAll('#follTabs .ctab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  KickCharts.buildFollowerChart('chartFollowers', _follHistory, m);
}

// ══════════════════════════════════════════════════
// LIVE HANDLING
// ══════════════════════════════════════════════════
function handleLive(channel) {
  const liveCard  = $('liveStreamCard');
  const liveSb    = $('liveIndicator');
  const liveTimer = $('liveTimerBadge');
  const avatar    = $('sidebarAvatar');

  if (channel?.isLive && channel.livestream) {
    const ls = channel.livestream;
    if (liveCard) liveCard.style.display = 'block';
    if (liveSb)   liveSb.style.display   = 'flex';
    if (liveTimer) liveTimer.style.display = 'inline-flex';
    if (avatar) avatar.classList.add('live');

    setText('liveTitle', ls.title||'Sin título');
    setText('liveCat',   ls.category||'Sin categoría');
    setText('liveViewers', fmtNum(ls.viewers));

    if (!_liveStart) {
      _liveStart = new Date(ls.startedAt);
      startLiveTimer();
      KickDB.saveLiveSession({ k:'current', kickId:String(ls.id||''), startedAt:ls.startedAt, title:ls.title, category:ls.category, peakViewers:ls.viewers });
    }
    if (ls.id) KickDB.saveViewerSnapshot(String(ls.id), ls.viewers, Date.now());

    // Update peak
    KickDB.getLiveSession().then(sess => {
      if (sess && ls.viewers > (sess.peakViewers||0)) {
        KickDB.saveLiveSession({...sess, peakViewers:ls.viewers});
        setText('livePeak', fmtNum(ls.viewers));
      }
    });

  } else {
    if (_liveStart) {
      // Stream ended — save to DB
      KickDB.getLiveSession().then(async sess => {
        if (sess) {
          const dur = (Date.now() - new Date(sess.startedAt)) / 1000;
          await KickDB.saveStream({
            kickId: sess.kickId || ('live_'+Date.now()),
            title: sess.title, category: sess.category,
            startedAt: sess.startedAt, endedAt: new Date().toISOString(),
            duration: Math.round(dur),
            peakViewers: sess.peakViewers || null, avgViewers: null, source:'live'
          });
          await KickDB.clearLiveSession();
        }
      });
    }
    _liveStart = null;
    stopLiveTimer();
    if (liveCard) liveCard.style.display = 'none';
    if (liveSb)   liveSb.style.display   = 'none';
    if (liveTimer) liveTimer.style.display = 'none';
    if (avatar) avatar.classList.remove('live');
  }
}

function startLiveTimer() {
  if (_liveTimer) clearInterval(_liveTimer);
  _liveTimer = setInterval(() => {
    if (!_liveStart) return;
    const e = Math.floor((Date.now()-_liveStart)/1000);
    const h=Math.floor(e/3600), m=Math.floor((e%3600)/60), s=e%60;
    const str=`${pad(h)}:${pad(m)}:${pad(s)}`;
    setText('liveTimerVal', str);
    setText('liveDurVal',   str);
  }, 1000);
}
function stopLiveTimer() { if(_liveTimer){clearInterval(_liveTimer);_liveTimer=null;} }
function pad(n) { return String(n).padStart(2,'0'); }

// ══════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════
function openAuthModal() {
  $('authModal').style.display='flex';
  const rdEl=$('redirectUrlDisplay'); if(rdEl) rdEl.textContent=KickAPI.getRedirectUri();
}
function closeAuthModal() { $('authModal').style.display='none'; }

async function saveCredentials() {
  const secret = $('inputClientSecret')?.value.trim();
  if (secret) await KickDB.setConfig('clientSecret', secret);
  closeAuthModal();
  showAlert('Secret guardado. Redirigiendo a Kick...','warn');
  setTimeout(()=>KickAPI.startOAuth(), 1200);
}

async function resetSecret() { await KickDB.setConfig('clientSecret',''); window.location.reload(); }

// ══════════════════════════════════════════════════
// POLLING
// ══════════════════════════════════════════════════
function startPolling() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(async () => {
    await syncNow(false);
  }, POLL_MS);
}

// ══════════════════════════════════════════════════
// EXPORT / IMPORT
// ══════════════════════════════════════════════════
async function exportData() {
  const json = await KickDB.exportAll();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json],{type:'application/json'}));
  a.download = `kickstats_${todayStr()}.json`;
  a.click();
}
async function importData(file) {
  await KickDB.importAll(await file.text());
  showAlert('Datos importados.','warn');
  window.location.reload();
}

// ══════════════════════════════════════════════════
// DOM HELPERS
// ══════════════════════════════════════════════════
function $(id)      { return document.getElementById(id); }
function setText(id,v) { const el=$(id); if(el) el.textContent=v; }
function setHTML(id,v) { const el=$(id); if(el) el.innerHTML=v; }
function setBar(id,pct){ const el=$(id); if(el) el.style.width=pct+'%'; }

// ══════════════════════════════════════════════════
// EXPOSE TO WINDOW
// ══════════════════════════════════════════════════
window.openAuthModal    = openAuthModal;
window.closeAuthModal   = closeAuthModal;
window.saveCredentials  = saveCredentials;
window.syncNow          = syncNow;
window.loadDashboard    = () => renderDashboard();
window.switchViewerMetric = switchViewerMetric;
window.switchFollMode   = switchFollMode;
window.exportData       = exportData;
window.resetSecret      = resetSecret;

document.addEventListener('DOMContentLoaded', init);

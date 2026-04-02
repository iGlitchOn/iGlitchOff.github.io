// ── dashboard.js ── Main logic for index.html
// CLIENT_ID is public (safe to commit). Secret lives only in browser IndexedDB.

const CHANNEL   = 'iglitchoff';
const CLIENT_ID = '01KK9JKQQ6V1MM0MFV6EFCFEDE';
const POLL_MS   = 30000;

let pollInterval=null, liveTimerInterval=null, liveStartTime=null;
let followerChartMode='daily', viewerMode='peak';

// ── Init ──────────────────────────────────────────────────
async function init() {
  await KickDB.open();
  await KickDB.setConfig('clientId', CLIENT_ID);
  await KickDB.setConfig('username', CHANNEL);

  // OAuth callback
  if (window.location.search.includes('code=')) {
    const modal = document.getElementById('callbackModal');
    if (modal) modal.style.display = 'flex';
    const ok = await KickAPI.handleCallback();
    const msg = document.getElementById('callbackMsg');
    if (msg) msg.textContent = ok ? '✅ Conectado. Cargando datos...' : '❌ Error de autenticación.';
    await new Promise(r => setTimeout(r, 1500));
    if (modal) modal.style.display = 'none';
  }

  // Check secret — show setup if missing
  const secret = await KickDB.getConfig('clientSecret');
  if (!secret) {
    document.getElementById('setupScreen').style.display = 'block';
    document.getElementById('statsGrid').style.display = 'none';
    document.querySelectorAll('.charts-row, .table-card').forEach(el => el.style.display = 'none');
    return;
  }

  // Update connect button
  const token = await KickDB.getConfig('access_token');
  const btn = document.getElementById('btnConnect');
  if (token && btn) { btn.textContent = '✅ Conectado'; btn.style.background = '#1a2a1a'; btn.style.color = 'var(--green)'; }

  const rdEl = document.getElementById('redirectUrlDisplay');
  if (rdEl) rdEl.textContent = KickAPI.getRedirectUri();

  await loadDashboard();
  startPolling();
}

// ── Setup screen ──────────────────────────────────────────
async function doSaveSecret() {
  const inp = document.getElementById('setupSecretInput');
  const err = document.getElementById('setupErr');
  const val = inp?.value.trim();
  if (!val) { if(err){err.textContent='Ingresa el Client Secret.';err.style.display='block';} return; }
  await KickDB.setConfig('clientSecret', val);
  window.location.reload();
}
window.doSaveSecret = doSaveSecret;

// ── Dashboard load ────────────────────────────────────────
async function loadDashboard() {
  const period = document.getElementById('periodSelect')?.value || '30';
  await syncNow(false);
  const [streams, followerHistory] = await Promise.all([
    KickDB.getStreamsInRange(getPeriodStart(period), new Date()),
    KickDB.getFollowerHistory()
  ]);
  updateStatCards(streams, followerHistory, window._channelCache);
  updateRecentStreamsTable(streams.slice(0, 10));
  buildCharts(streams, followerHistory);
}

// ── Sync ──────────────────────────────────────────────────
async function syncNow(showFeedback = true) {
  const username = await KickDB.getConfig('username') || CHANNEL;
  try {
    const channel = await KickAPI.getChannelInfo(username);
    if (!channel) { if(showFeedback) showAlert('No se pudo conectar con Kick API.','error'); return; }
    window._channelCache = channel;
    await KickDB.saveFollowerSnapshot(todayStr(), channel.followers);
    updateLiveStatus(channel);
    const videos = await KickAPI.getAllVideos(username);
    for (const v of videos) {
      await KickDB.saveStream({ kickId:v.kickId, title:v.title, category:v.category, startedAt:v.startedAt, duration:v.duration, peakViewers:v.peakViewers||v.views||0, avgViewers:v.avgViewers||0, views:v.views||0, thumbnail:v.thumbnail, source:v.source });
    }
    const syncEl = document.getElementById('lastSync');
    if (syncEl) syncEl.textContent = 'Sync: ' + new Date().toLocaleTimeString('es-ES');
  } catch(e) {
    console.error('Sync error:', e);
    if (showFeedback) showAlert('Error al sincronizar: ' + e.message, 'error');
  }
}

// ── Live status ───────────────────────────────────────────
function updateLiveStatus(channel) {
  const liveCard=document.getElementById('liveStreamCard'), liveInd=document.getElementById('liveIndicator');
  const liveBadge=document.getElementById('liveTimerBadge'), avatar=document.getElementById('sidebarAvatar');

  if (channel?.isLive && channel.livestream) {
    const ls = channel.livestream;
    if(liveCard) liveCard.style.display='block';
    if(liveInd)  liveInd.style.display='flex';
    if(liveBadge) liveBadge.style.display='inline-flex';
    if(avatar) avatar.style.boxShadow='0 0 0 2px var(--green)';

    setText('liveStreamTitle', ls.title||'Sin título');
    setText('liveStreamCategory', ls.category||'Sin categoría');
    setText('liveViewers', fmtNum(ls.viewers));

    if (!liveStartTime) {
      liveStartTime = new Date(ls.startedAt);
      startLiveTimer();
      KickDB.saveLiveSession({ k:'current', kickId:String(ls.id||''), startedAt:ls.startedAt, title:ls.title, category:ls.category, peakViewers:ls.viewers });
    }
    if (ls.id) KickDB.saveViewerSnapshot(String(ls.id), ls.viewers, Date.now());
    KickDB.getLiveSession().then(sess => {
      if (sess && ls.viewers > (sess.peakViewers||0)) {
        KickDB.saveLiveSession({...sess, peakViewers:ls.viewers});
        setText('livePeak', fmtNum(ls.viewers));
      }
    });
  } else {
    if (liveStartTime) {
      KickDB.getLiveSession().then(async sess => {
        if (sess) {
          const dur = (Date.now()-new Date(sess.startedAt))/1000;
          await KickDB.saveStream({ kickId:sess.kickId||('live_'+Date.now()), title:sess.title, category:sess.category, startedAt:sess.startedAt, endedAt:new Date().toISOString(), duration:Math.round(dur), peakViewers:sess.peakViewers||0, avgViewers:0, source:'live' });
          await KickDB.clearLiveSession();
        }
      });
    }
    liveStartTime = null;
    stopLiveTimer();
    if(liveCard) liveCard.style.display='none';
    if(liveInd)  liveInd.style.display='none';
    if(liveBadge) liveBadge.style.display='none';
    if(avatar) avatar.style.boxShadow='none';
  }
}

function startLiveTimer() {
  if (liveTimerInterval) clearInterval(liveTimerInterval);
  liveTimerInterval = setInterval(() => {
    if (!liveStartTime) return;
    const e=Math.floor((Date.now()-liveStartTime)/1000);
    const h=Math.floor(e/3600),m=Math.floor((e%3600)/60),s=e%60;
    const str=`${pad(h)}:${pad(m)}:${pad(s)}`;
    setText('liveTimerVal', str);
    setText('liveDuration', str);
  }, 1000);
}
function stopLiveTimer() { if(liveTimerInterval){clearInterval(liveTimerInterval);liveTimerInterval=null;} }
function pad(n) { return String(n).padStart(2,'0'); }

// ── Stat Cards ────────────────────────────────────────────
function updateStatCards(streams, followerHistory, channel) {
  const fl = channel?.followers ?? (followerHistory.length ? followerHistory[followerHistory.length-1].count : 0);
  const prev = followerHistory.length>1 ? followerHistory[Math.max(0,followerHistory.length-8)].count : null;
  const peak = streams.length ? Math.max(...streams.map(s=>s.peakViewers||0)) : 0;
  const avg  = streams.length ? Math.round(streams.reduce((a,s)=>a+(s.avgViewers||s.peakViewers||0),0)/streams.length) : 0;
  const hrs  = streams.reduce((a,s)=>a+(s.duration||0),0)/3600;
  const goalPct = Math.min(100, Math.round((fl/1000)*100));
  const remaining = Math.max(0, 1000-fl);

  // Calculate ETA
  let eta = '—';
  if (followerHistory.length > 2) {
    const days = Math.max(1,(new Date(followerHistory[followerHistory.length-1].date)-new Date(followerHistory[0].date))/86400000);
    const gain = fl - followerHistory[0].count;
    const avgDay = gain/days;
    if (avgDay > 0) eta = Math.ceil(remaining/avgDay) + 'd';
  }

  setText('valFollowers', fmtNum(fl));
  setText('valPeak', fmtNum(peak));
  setText('valAvg', fmtNum(avg));
  setText('valHours', hrs.toFixed(1)+'h');
  setText('valStreams', fmtNum(streams.length));
  setText('valGoal', goalPct+'%');
  setText('goalEta', remaining>0 ? `Faltan ${fmtNum(remaining)} · ETA: ${eta}` : '✅ Meta alcanzada!');
  setBar('goalBar', goalPct);

  if (prev !== null) {
    const gain = fl-prev, el=document.getElementById('deltaFollowers');
    if (el) { el.textContent=(gain>=0?'+':'')+fmtNum(gain)+' últimos días'; el.className='sc-delta '+(gain>0?'pos':gain<0?'neg':'neu'); }
  }
}

// ── Recent Streams Table ──────────────────────────────────
function updateRecentStreamsTable(streams) {
  const tbody = document.getElementById('recentStreamsTbody');
  if (!tbody) return;
  if (!streams.length) { tbody.innerHTML='<tr><td colspan="7" class="empty-row">Sin streams aún. Empieza a streamear para ver datos.</td></tr>'; return; }
  tbody.innerHTML = streams.map(s => `
    <tr>
      <td style="color:var(--muted)">${fmtDateTime(s.startedAt)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.title||''}">${s.title||'Sin título'}</td>
      <td><span class="badge badge-green">${s.category||'—'}</span></td>
      <td style="color:var(--green);font-weight:700">${fmtDur(s.duration)}</td>
      <td style="font-weight:800;font-family:var(--mono)">${fmtNum(s.peakViewers||0)}</td>
      <td>${fmtNum(s.avgViewers||0)}</td>
      <td><a class="btn-detail" href="pages/stream-detail.html?id=${s.id||s.kickId}">Ver →</a></td>
    </tr>`).join('');
}

// ── Charts ────────────────────────────────────────────────
function buildCharts(streams, followerHistory) {
  const sorted = streams.slice(0,20).reverse();
  KickCharts.buildViewerChart('chartViewers', sorted, viewerMode);
  KickCharts.buildCategoriesChart('chartCategories', streams);
  KickCharts.buildFollowerChart('chartFollowers', followerHistory, followerChartMode);
  KickCharts.buildDurationChart('chartDuration', sorted);
  KickCharts.buildDayOfWeekChart('chartDayOfWeek', streams);
}

function switchViewerMode(mode, btn) {
  viewerMode = mode;
  document.querySelectorAll('#viewerTabs .ct-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  KickDB.getStreamsInRange(getPeriodStart(document.getElementById('periodSelect')?.value||'30'), new Date())
    .then(streams => KickCharts.buildViewerChart('chartViewers', streams.slice(0,20).reverse(), mode));
}

function switchFollowerChart(mode, btn) {
  followerChartMode = mode;
  document.querySelectorAll('#followerTabs .ct-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  KickDB.getFollowerHistory().then(fh => KickCharts.buildFollowerChart('chartFollowers', fh, mode));
}

// ── Modal ─────────────────────────────────────────────────
function openAuthModal() { document.getElementById('authModal').style.display='flex'; const rdEl=document.getElementById('redirectUrlDisplay'); if(rdEl) rdEl.textContent=KickAPI.getRedirectUri(); }
function closeAuthModal() { document.getElementById('authModal').style.display='none'; }

async function saveCredentials() {
  const secret = document.getElementById('inputClientSecret')?.value.trim();
  if (secret) await KickDB.setConfig('clientSecret', secret);
  closeAuthModal();
  showAlert('Secret guardado. Redirigiendo a Kick...', 'warn');
  setTimeout(() => KickAPI.startOAuth(), 1200);
}

async function resetSecret() { await KickDB.setConfig('clientSecret',''); window.location.reload(); }

// ── Polling ───────────────────────────────────────────────
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    syncNow(false).then(() => {
      const period = document.getElementById('periodSelect')?.value || '30';
      Promise.all([
        KickDB.getStreamsInRange(getPeriodStart(period), new Date()),
        KickDB.getFollowerHistory()
      ]).then(([streams, fh]) => {
        updateStatCards(streams, fh, window._channelCache);
        updateRecentStreamsTable(streams.slice(0,10));
      });
    });
  }, POLL_MS);
}

// ── Export / Import ───────────────────────────────────────
async function exportData() {
  const json = await KickDB.exportAll();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json],{type:'application/json'}));
  a.download = `kickstats_backup_${todayStr()}.json`;
  a.click();
}
async function importData(file) {
  await KickDB.importAll(await file.text());
  showAlert('Datos importados.','warn');
  loadDashboard();
}

// ── Helpers ───────────────────────────────────────────────
function setText(id, v) { const el=document.getElementById(id); if(el) el.textContent=v; }
function setBar(id, pct) { const el=document.getElementById(id); if(el) el.style.width=pct+'%'; }

window.openAuthModal=openAuthModal; window.closeAuthModal=closeAuthModal;
window.saveCredentials=saveCredentials; window.syncNow=syncNow;
window.loadDashboard=loadDashboard; window.switchViewerMode=switchViewerMode;
window.switchFollowerChart=switchFollowerChart; window.exportData=exportData;
window.resetSecret=resetSecret;

document.addEventListener('DOMContentLoaded', init);

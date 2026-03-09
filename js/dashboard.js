// ── dashboard.js ── Main logic for index.html

const CHANNEL = 'iglitchoff';
const POLL_MS = 30000;

let pollInterval = null;
let liveTimerInterval = null;
let liveStartTime = null;
let followerChartMode = 'daily';

// ── Init ──────────────────────────────────────────────────
async function init() {
  await KickDB.open();

  // Set redirect URL display in modal
  const rdEl = document.getElementById('redirectUrlDisplay');
  if (rdEl) rdEl.textContent = KickAPI.getRedirectUri();

  // Handle OAuth callback if code is present
  if (window.location.search.includes('code=')) {
    const modal = document.getElementById('callbackModal');
    if (modal) modal.style.display = 'flex';
    const ok = await KickAPI.handleCallback();
    document.getElementById('callbackMsg').textContent = ok ? '✅ Conectado! Cargando datos...' : '❌ Error de autenticación.';
    await new Promise(r => setTimeout(r, 1500));
    if (modal) modal.style.display = 'none';
  }

  // Check connection status
  const token = await KickDB.getConfig('access_token');
  const btn = document.getElementById('btnConnect');
  if (token && btn) { btn.textContent = '✅ Conectado'; btn.style.background = '#1a2a1a'; btn.style.color = 'var(--green)'; }

  // Load saved credentials
  const savedUser = await KickDB.getConfig('username');
  if (savedUser && document.getElementById('inputUsername'))
    document.getElementById('inputUsername').value = savedUser;

  await loadDashboard();
  startPolling();
}

// ── Dashboard load ────────────────────────────────────────
async function loadDashboard() {
  const period = document.getElementById('periodSelect')?.value || '30';
  const startDate = getPeriodStart(period);
  const endDate = new Date();

  // Fetch fresh data
  await syncNow(false);

  const [allStreams, followerHistory] = await Promise.all([
    KickDB.getStreamsInRange(startDate, endDate),
    KickDB.getFollowerHistory()
  ]);

  const channel = window._channelCache;
  updateStatCards(allStreams, followerHistory, channel);
  updateRecentStreamsTable(allStreams.slice(0, 10));
  buildCharts(allStreams, followerHistory);
}

// ── Sync ──────────────────────────────────────────────────
async function syncNow(showFeedback = true) {
  const username = await KickDB.getConfig('username') || CHANNEL;

  try {
    const channel = await KickAPI.getChannelInfo(username);
    if (!channel) { if (showFeedback) showAlert('No se pudo conectar con Kick API.'); return; }

    window._channelCache = channel;

    // Save follower snapshot
    await KickDB.saveFollowerSnapshot(todayStr(), channel.followers);

    // Update live status
    updateLiveStatus(channel);

    // Fetch and save videos
    const videos = await KickAPI.getVideos(username);
    for (const v of videos) {
      await KickDB.saveStream({
        kickId: v.kickId,
        title: v.title,
        category: v.category,
        startedAt: v.startedAt,
        duration: v.duration,
        peakViewers: v.views || 0,
        avgViewers: 0,
        views: v.views || 0,
        thumbnail: v.thumbnail,
        source: v.source
      });
    }

    const syncEl = document.getElementById('lastSync');
    if (syncEl) syncEl.textContent = `Sync: ${new Date().toLocaleTimeString('es-ES')}`;

  } catch(e) {
    console.error('Sync error:', e);
    if (showFeedback) showAlert('Error al sincronizar: ' + e.message, 'error');
  }
}

// ── Live status ───────────────────────────────────────────
function updateLiveStatus(channel) {
  const liveCard = document.getElementById('liveStreamCard');
  const liveIndicator = document.getElementById('liveIndicator');
  const liveBadge = document.getElementById('liveTimerBadge');
  const avatar = document.getElementById('sidebarAvatar');

  if (channel?.isLive && channel.livestream) {
    const ls = channel.livestream;

    if (liveCard) liveCard.style.display = 'block';
    if (liveIndicator) liveIndicator.style.display = 'flex';
    if (liveBadge) liveBadge.style.display = 'inline-flex';
    if (avatar) avatar.style.border = '2px solid var(--green)';

    const titleEl = document.getElementById('liveStreamTitle');
    const catEl = document.getElementById('liveStreamCategory');
    const viewersEl = document.getElementById('liveViewers');
    const peakEl = document.getElementById('livePeak');

    if (titleEl) titleEl.textContent = ls.title || 'Sin título';
    if (catEl) catEl.textContent = ls.category || 'Sin categoría';
    if (viewersEl) viewersEl.textContent = fmtNum(ls.viewers);
    if (peakEl) peakEl.textContent = fmtNum(ls.viewers);

    // Live session tracking
    if (!liveStartTime) {
      liveStartTime = new Date(ls.startedAt);
      startLiveTimer();

      // Save live session
      KickDB.saveLiveSession({
        kickId: ls.id,
        startedAt: ls.startedAt,
        title: ls.title,
        category: ls.category,
        peakViewers: ls.viewers
      });
    }

    // Record viewer snapshot
    if (ls.id) {
      KickDB.saveViewerSnapshot(String(ls.id), ls.viewers, Date.now());
    }

    // Update peak
    KickDB.getLiveSession().then(sess => {
      if (sess && ls.viewers > (sess.peakViewers || 0)) {
        KickDB.saveLiveSession({ ...sess, peakViewers: ls.viewers });
        if (peakEl) peakEl.textContent = fmtNum(ls.viewers);
      }
    });

  } else {
    // Was live, now offline → save stream to DB
    if (liveStartTime) {
      KickDB.getLiveSession().then(async sess => {
        if (sess) {
          const duration = (Date.now() - new Date(sess.startedAt)) / 1000;
          await KickDB.saveStream({
            kickId: sess.kickId || ('local_' + Date.now()),
            title: sess.title,
            category: sess.category,
            startedAt: sess.startedAt,
            endedAt: new Date().toISOString(),
            duration: Math.round(duration),
            peakViewers: sess.peakViewers || 0,
            avgViewers: 0,
            source: 'live'
          });
          await KickDB.clearLiveSession();
        }
      });
    }

    liveStartTime = null;
    stopLiveTimer();
    if (liveCard) liveCard.style.display = 'none';
    if (liveIndicator) liveIndicator.style.display = 'none';
    if (liveBadge) liveBadge.style.display = 'none';
    if (avatar) avatar.style.border = '2px solid var(--green-dim)';
  }
}

// ── Live Timer ────────────────────────────────────────────
function startLiveTimer() {
  if (liveTimerInterval) clearInterval(liveTimerInterval);
  liveTimerInterval = setInterval(() => {
    if (!liveStartTime) return;
    const elapsed = Math.floor((Date.now() - liveStartTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const str = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const el = document.getElementById('liveTimerVal');
    if (el) el.textContent = str;
    const el2 = document.getElementById('liveDuration');
    if (el2) el2.textContent = str;
  }, 1000);
}

function stopLiveTimer() {
  if (liveTimerInterval) { clearInterval(liveTimerInterval); liveTimerInterval = null; }
}

// ── Stat Cards ────────────────────────────────────────────
function updateStatCards(streams, followerHistory, channel) {
  const followers = channel?.followers ?? followerHistory[followerHistory.length - 1]?.count ?? 0;
  const prevFollowers = followerHistory.length > 1 ? followerHistory[Math.max(0, followerHistory.length - 8)]?.count : null;

  const peakViewers = streams.length ? Math.max(...streams.map(s => s.peakViewers || 0)) : 0;
  const avgViewers = streams.length ? Math.round(streams.reduce((a, s) => a + (s.avgViewers || s.peakViewers || 0), 0) / streams.length) : 0;
  const totalHours = streams.reduce((a, s) => a + (s.duration || 0), 0) / 3600;
  const goal = 1000;
  const goalPct = Math.min(100, Math.round((followers / goal) * 100));

  setText('valFollowers', fmtNum(followers));
  setText('valPeak', fmtNum(peakViewers));
  setText('valAvg', fmtNum(avgViewers));
  setText('valHours', totalHours.toFixed(1) + 'h');
  setText('valStreams', fmtNum(streams.length));
  setText('valGoal', goalPct + '%');

  setBar('goalBar', goalPct);

  if (prevFollowers !== null) {
    const gain = followers - prevFollowers;
    const deltaEl = document.getElementById('deltaFollowers');
    if (deltaEl) {
      deltaEl.textContent = (gain >= 0 ? '+' : '') + fmtNum(gain) + ' últimos días';
      deltaEl.className = 'sc-delta ' + (gain > 0 ? 'pos' : gain < 0 ? 'neg' : 'neu');
    }
  }
}

// ── Recent Streams Table ──────────────────────────────────
function updateRecentStreamsTable(streams) {
  const tbody = document.getElementById('recentStreamsTbody');
  if (!tbody) return;

  if (!streams.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Sin streams registrados. Haz stream para comenzar a trackear datos.</td></tr>';
    return;
  }

  tbody.innerHTML = streams.map(s => `
    <tr>
      <td>${fmtDateTime(s.startedAt)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.title || ''}">${s.title || 'Sin título'}</td>
      <td><span class="badge badge-green">${s.category || '—'}</span></td>
      <td>${fmtDur(s.duration)}</td>
      <td>${fmtNum(s.avgViewers || 0)}</td>
      <td style="color:var(--green);font-weight:700">${fmtNum(s.peakViewers || 0)}</td>
      <td><a class="btn-detail" href="pages/stream-detail.html?id=${s.id || s.kickId}">Ver →</a></td>
    </tr>
  `).join('');
}

// ── Charts ────────────────────────────────────────────────
function buildCharts(streams, followerHistory) {
  KickCharts.buildFollowerChart('chartFollowers', followerHistory, followerChartMode);
  KickCharts.buildCategoriesChart('chartCategories', streams);
  KickCharts.buildViewerChart('chartViewers', streams.slice(0, 20).reverse());
  KickCharts.buildDurationChart('chartDuration', streams.slice(0, 20).reverse());
  KickCharts.buildDayOfWeekChart('chartDayOfWeek', streams);
}

function switchFollowerChart(mode, btn) {
  followerChartMode = mode;
  document.querySelectorAll('#followerTabs .ct-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  KickDB.getFollowerHistory().then(fh => KickCharts.buildFollowerChart('chartFollowers', fh, mode));
}

// ── Modal ─────────────────────────────────────────────────
function openAuthModal() { document.getElementById('authModal').style.display = 'flex'; }
function closeAuthModal() { document.getElementById('authModal').style.display = 'none'; }

async function saveCredentials() {
  const clientId = document.getElementById('inputClientId')?.value.trim();
  const clientSecret = document.getElementById('inputClientSecret')?.value.trim();
  const username = document.getElementById('inputUsername')?.value.trim() || CHANNEL;

  if (clientId) await KickDB.setConfig('clientId', clientId);
  if (clientSecret) await KickDB.setConfig('clientSecret', clientSecret);
  await KickDB.setConfig('username', username);

  closeAuthModal();
  if (clientId) {
    showAlert('Credenciales guardadas. Redirigiendo a Kick para autorizar...', 'warn');
    setTimeout(() => KickAPI.startOAuth(), 1500);
  } else {
    showAlert('Usuario guardado. Usando API pública (sin OAuth).', 'warn');
    await syncNow(true);
  }
}

// ── Polling ───────────────────────────────────────────────
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => syncNow(false).then(() => {
    const period = document.getElementById('periodSelect')?.value || '30';
    KickDB.getStreamsInRange(getPeriodStart(period), new Date()).then(streams => {
      KickDB.getFollowerHistory().then(fh => {
        updateStatCards(streams, fh, window._channelCache);
        updateRecentStreamsTable(streams.slice(0, 10));
      });
    });
  }), POLL_MS);
}

// ── Helpers ───────────────────────────────────────────────
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setBar(id, pct) { const el = document.getElementById(id); if (el) el.style.width = pct + '%'; }

// ── Export / Import ───────────────────────────────────────
async function exportData() {
  const json = await KickDB.exportAll();
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kickstats_backup_${todayStr()}.json`;
  a.click();
}

async function importData(file) {
  const text = await file.text();
  await KickDB.importAll(text);
  showAlert('Datos importados correctamente.', 'warn');
  loadDashboard();
}

window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.saveCredentials = saveCredentials;
window.syncNow = syncNow;
window.loadDashboard = loadDashboard;
window.switchFollowerChart = switchFollowerChart;
window.exportData = exportData;

document.addEventListener('DOMContentLoaded', init);

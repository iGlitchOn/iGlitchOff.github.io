// ── dashboard.js ── Main logic for index.html
// Client ID is public (safe to commit). Secret lives only in IndexedDB.

const CHANNEL   = 'iglitchoff';
const CLIENT_ID = '01KK9JKQQ6V1MM0MFV6EFCFEDE';
const POLL_MS   = 30000;

let pollInterval      = null;
let liveTimerInterval = null;
let liveStartTime     = null;
let followerChartMode = 'daily';

// ── Init ──────────────────────────────────────────────────
async function init() {
  await KickDB.open();

  // Client ID and username are fixed — always write them
  await KickDB.setConfig('clientId', CLIENT_ID);
  await KickDB.setConfig('username', CHANNEL);

  // Handle OAuth callback BEFORE anything else
  if (window.location.search.includes('code=')) {
    const modal = document.getElementById('callbackModal');
    if (modal) modal.style.display = 'flex';
    const ok = await KickAPI.handleCallback();
    const msg = document.getElementById('callbackMsg');
    if (msg) msg.textContent = ok ? '✅ Conectado! Cargando datos...' : '❌ Error de autenticación.';
    await new Promise(r => setTimeout(r, 1500));
    if (modal) modal.style.display = 'none';
  }

  // If no secret saved yet → show first-time setup screen
  const secret = await KickDB.getConfig('clientSecret');
  if (!secret) {
    showSetupScreen();
    return;
  }

  // Update sidebar button
  const token = await KickDB.getConfig('access_token');
  const btn = document.getElementById('btnConnect');
  if (btn) {
    if (token) {
      btn.textContent = '✅ Conectado';
      btn.style.background = '#1a2a1a';
      btn.style.color = 'var(--green)';
    } else {
      btn.textContent = '🔗 Autorizar Kick';
    }
  }

  const rdEl = document.getElementById('redirectUrlDisplay');
  if (rdEl) rdEl.textContent = KickAPI.getRedirectUri();

  await loadDashboard();
  startPolling();
}

// ── First-time setup screen ───────────────────────────────
function showSetupScreen() {
  const main = document.querySelector('.main-content');
  if (!main) return;
  main.innerHTML = `
    <div style="max-width:460px;margin:80px auto;padding:0 20px;display:flex;flex-direction:column;align-items:center">
      <div style="font-size:48px;margin-bottom:16px">🔐</div>
      <h2 style="font-size:22px;font-weight:800;color:var(--green);font-family:var(--mono);margin-bottom:8px">
        Configura tu app
      </h2>
      <p style="color:var(--muted);font-size:13px;text-align:center;margin-bottom:32px;line-height:1.6">
        Solo necesitas hacer esto <strong style="color:var(--text)">una vez</strong>.<br>
        El secret se guarda en tu navegador — nunca en el código.
      </p>
      <div style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;display:flex;flex-direction:column;gap:18px">
        <div>
          <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:6px">
            Client ID <span style="color:var(--green)">(ya guardado)</span>
          </label>
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;font-family:var(--mono);color:var(--muted);word-break:break-all">
            ${CLIENT_ID}
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:6px">
            Client Secret <span style="color:var(--red)">*</span>
          </label>
          <input
            type="password" id="setupSecret"
            placeholder="Pega tu Client Secret aquí..."
            style="width:100%;background:var(--bg);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:11px 14px;font-size:13px;font-family:var(--sans);outline:none;box-sizing:border-box"
            onfocus="this.style.borderColor='var(--green)'"
            onblur="this.style.borderColor='var(--border2)'"
            onkeydown="if(event.key==='Enter')saveSecret()"
          />
          <p style="font-size:11px;color:var(--muted);margin-top:6px">
            Encuéntralo en
            <a href="https://kick.com/settings/developer" target="_blank" style="color:var(--green)">
              kick.com/settings/developer
            </a> → app KickX
          </p>
        </div>
        <button onclick="saveSecret()"
          style="background:var(--green);color:#000;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:800;font-family:var(--sans);cursor:pointer">
          Guardar y continuar →
        </button>
        <div id="setupError" style="display:none;color:var(--red);font-size:12px;text-align:center"></div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:16px;text-align:center">
        🔒 Guardado solo en IndexedDB de este navegador. Nunca sale de tu dispositivo.
      </p>
    </div>
  `;
}

async function saveSecret() {
  const input = document.getElementById('setupSecret');
  const errEl = document.getElementById('setupError');
  const secret = input ? input.value.trim() : '';
  if (!secret) {
    if (errEl) { errEl.textContent = 'Ingresa el Client Secret.'; errEl.style.display = 'block'; }
    return;
  }
  await KickDB.setConfig('clientSecret', secret);
  window.location.reload();
}
window.saveSecret = saveSecret;

// ── Dashboard load ────────────────────────────────────────
async function loadDashboard() {
  const period = document.getElementById('periodSelect') ? document.getElementById('periodSelect').value : '30';
  const startDate = getPeriodStart(period);
  const endDate = new Date();

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
async function syncNow(showFeedback) {
  if (showFeedback === undefined) showFeedback = true;
  const username = await KickDB.getConfig('username') || CHANNEL;

  try {
    const channel = await KickAPI.getChannelInfo(username);
    if (!channel) {
      if (showFeedback) showAlert('No se pudo conectar con Kick API.');
      return;
    }

    window._channelCache = channel;
    await KickDB.saveFollowerSnapshot(todayStr(), channel.followers);
    updateLiveStatus(channel);

    const videos = await KickAPI.getVideos(username);
    for (const v of videos) {
      await KickDB.saveStream({
        kickId: v.kickId,
        title: v.title,
        category: v.category,
        startedAt: v.startedAt,
        duration: v.duration,
        peakViewers: v.peakViewers || v.views || 0,
        avgViewers: v.avgViewers || 0,
        views: v.views || 0,
        thumbnail: v.thumbnail,
        source: v.source
      });
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
  const liveCard      = document.getElementById('liveStreamCard');
  const liveIndicator = document.getElementById('liveIndicator');
  const liveBadge     = document.getElementById('liveTimerBadge');
  const avatar        = document.getElementById('sidebarAvatar');

  if (channel && channel.isLive && channel.livestream) {
    const ls = channel.livestream;

    if (liveCard)      liveCard.style.display      = 'block';
    if (liveIndicator) liveIndicator.style.display  = 'flex';
    if (liveBadge)     liveBadge.style.display      = 'inline-flex';
    if (avatar)        avatar.style.border          = '2px solid var(--green)';

    setText('liveStreamTitle',    ls.title    || 'Sin título');
    setText('liveStreamCategory', ls.category || 'Sin categoría');
    setText('liveViewers',        fmtNum(ls.viewers));
    setText('livePeak',           fmtNum(ls.viewers));

    if (!liveStartTime) {
      liveStartTime = new Date(ls.startedAt);
      startLiveTimer();
      KickDB.saveLiveSession({
        kickId: ls.id, startedAt: ls.startedAt,
        title: ls.title, category: ls.category, peakViewers: ls.viewers
      });
    }

    if (ls.id) KickDB.saveViewerSnapshot(String(ls.id), ls.viewers, Date.now());

    KickDB.getLiveSession().then(function(sess) {
      if (sess && ls.viewers > (sess.peakViewers || 0)) {
        KickDB.saveLiveSession(Object.assign({}, sess, { peakViewers: ls.viewers }));
        setText('livePeak', fmtNum(ls.viewers));
      }
    });

  } else {
    if (liveStartTime) {
      KickDB.getLiveSession().then(async function(sess) {
        if (sess) {
          const duration = (Date.now() - new Date(sess.startedAt)) / 1000;
          await KickDB.saveStream({
            kickId: sess.kickId || ('local_' + Date.now()),
            title: sess.title, category: sess.category,
            startedAt: sess.startedAt, endedAt: new Date().toISOString(),
            duration: Math.round(duration),
            peakViewers: sess.peakViewers || 0, avgViewers: 0, source: 'live'
          });
          await KickDB.clearLiveSession();
        }
      });
    }
    liveStartTime = null;
    stopLiveTimer();
    if (liveCard)      liveCard.style.display      = 'none';
    if (liveIndicator) liveIndicator.style.display  = 'none';
    if (liveBadge)     liveBadge.style.display      = 'none';
    if (avatar)        avatar.style.border          = '2px solid var(--green-dim)';
  }
}

// ── Live Timer ────────────────────────────────────────────
function startLiveTimer() {
  if (liveTimerInterval) clearInterval(liveTimerInterval);
  liveTimerInterval = setInterval(function() {
    if (!liveStartTime) return;
    const elapsed = Math.floor((Date.now() - liveStartTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const str = pad(h) + ':' + pad(m) + ':' + pad(s);
    setText('liveTimerVal', str);
    setText('liveDuration', str);
  }, 1000);
}
function stopLiveTimer() {
  if (liveTimerInterval) { clearInterval(liveTimerInterval); liveTimerInterval = null; }
}
function pad(n) { return String(n).padStart(2, '0'); }

// ── Stat Cards ────────────────────────────────────────────
function updateStatCards(streams, followerHistory, channel) {
  const followers    = channel && channel.followers != null ? channel.followers
                       : (followerHistory.length ? followerHistory[followerHistory.length - 1].count : 0);
  const prevFollowers = followerHistory.length > 1
                       ? followerHistory[Math.max(0, followerHistory.length - 8)].count : null;
  const peakViewers  = streams.length ? Math.max.apply(null, streams.map(function(s) { return s.peakViewers || 0; })) : 0;
  const avgViewers   = streams.length ? Math.round(streams.reduce(function(a, s) { return a + (s.avgViewers || s.peakViewers || 0); }, 0) / streams.length) : 0;
  const totalHours   = streams.reduce(function(a, s) { return a + (s.duration || 0); }, 0) / 3600;
  const goalPct      = Math.min(100, Math.round((followers / 1000) * 100));

  setText('valFollowers', fmtNum(followers));
  setText('valPeak',      fmtNum(peakViewers));
  setText('valAvg',       fmtNum(avgViewers));
  setText('valHours',     totalHours.toFixed(1) + 'h');
  setText('valStreams',   fmtNum(streams.length));
  setText('valGoal',      goalPct + '%');
  setBar('goalBar', goalPct);

  if (prevFollowers !== null) {
    const gain    = followers - prevFollowers;
    const deltaEl = document.getElementById('deltaFollowers');
    if (deltaEl) {
      deltaEl.textContent = (gain >= 0 ? '+' : '') + fmtNum(gain) + ' últimos días';
      deltaEl.className   = 'sc-delta ' + (gain > 0 ? 'pos' : gain < 0 ? 'neg' : 'neu');
    }
  }
}

// ── Recent Streams Table ──────────────────────────────────
function updateRecentStreamsTable(streams) {
  const tbody = document.getElementById('recentStreamsTbody');
  if (!tbody) return;
  if (!streams.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Sin streams registrados aún.</td></tr>';
    return;
  }
  tbody.innerHTML = streams.map(function(s) {
    return '<tr>' +
      '<td>' + fmtDateTime(s.startedAt) + '</td>' +
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (s.title||'') + '">' + (s.title||'Sin título') + '</td>' +
      '<td><span class="badge badge-green">' + (s.category||'—') + '</span></td>' +
      '<td>' + fmtDur(s.duration) + '</td>' +
      '<td>' + fmtNum(s.avgViewers||0) + '</td>' +
      '<td style="color:var(--green);font-weight:700">' + fmtNum(s.peakViewers||0) + '</td>' +
      '<td><a class="btn-detail" href="pages/stream-detail.html?id=' + (s.id||s.kickId) + '">Ver →</a></td>' +
    '</tr>';
  }).join('');
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
  document.querySelectorAll('#followerTabs .ct-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  KickDB.getFollowerHistory().then(function(fh) { KickCharts.buildFollowerChart('chartFollowers', fh, mode); });
}

// ── Auth Modal ────────────────────────────────────────────
function openAuthModal() {
  const m = document.getElementById('authModal');
  if (m) m.style.display = 'flex';
  const rdEl = document.getElementById('redirectUrlDisplay');
  if (rdEl) rdEl.textContent = KickAPI.getRedirectUri();
}
function closeAuthModal() {
  const m = document.getElementById('authModal');
  if (m) m.style.display = 'none';
}

async function saveCredentials() {
  const secret   = document.getElementById('inputClientSecret') ? document.getElementById('inputClientSecret').value.trim() : '';
  const username = document.getElementById('inputUsername')     ? document.getElementById('inputUsername').value.trim()     : CHANNEL;
  if (secret)   await KickDB.setConfig('clientSecret', secret);
  if (username) await KickDB.setConfig('username', username);
  closeAuthModal();
  showAlert('Secret guardado. Redirigiendo a Kick...', 'warn');
  setTimeout(function() { KickAPI.startOAuth(); }, 1200);
}

// ── Polling ───────────────────────────────────────────────
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(function() {
    syncNow(false).then(function() {
      const period = document.getElementById('periodSelect') ? document.getElementById('periodSelect').value : '30';
      KickDB.getStreamsInRange(getPeriodStart(period), new Date()).then(function(streams) {
        KickDB.getFollowerHistory().then(function(fh) {
          updateStatCards(streams, fh, window._channelCache);
          updateRecentStreamsTable(streams.slice(0, 10));
        });
      });
    });
  }, POLL_MS);
}

// ── Helpers ───────────────────────────────────────────────
function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
function setBar(id, pct)  { var el = document.getElementById(id); if (el) el.style.width = pct + '%'; }

async function exportData() {
  const json = await KickDB.exportAll();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'kickstats_backup_' + todayStr() + '.json';
  a.click();
}
async function importData(file) {
  await KickDB.importAll(await file.text());
  showAlert('Datos importados.', 'warn');
  loadDashboard();
}

// Also expose a reset-secret option in case they need to change it
async function resetSecret() {
  await KickDB.setConfig('clientSecret', '');
  window.location.reload();
}

window.openAuthModal      = openAuthModal;
window.closeAuthModal     = closeAuthModal;
window.saveCredentials    = saveCredentials;
window.syncNow            = syncNow;
window.loadDashboard      = loadDashboard;
window.switchFollowerChart = switchFollowerChart;
window.exportData         = exportData;
window.resetSecret        = resetSecret;

document.addEventListener('DOMContentLoaded', init);

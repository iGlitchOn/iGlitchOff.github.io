// ── charts.js ── Chart.js builders for KickStats

const GREEN = '#53FC18';
const GREEN_DIM = '#2a7d0c';
const GREEN_ALPHA = 'rgba(83,252,24,0.15)';
const BLUE = '#4488FF';
const RED = '#FF4444';
const YELLOW = '#FFD700';
const ORANGE = '#FF8C00';
const PURPLE = '#9B59B6';
const MUTED = '#555';
const GRID = '#1e1e1e';
const TEXT_COLOR = '#888';

Chart.defaults.color = TEXT_COLOR;
Chart.defaults.borderColor = GRID;
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.font.size = 11;

const PALETTE = [GREEN, BLUE, YELLOW, RED, ORANGE, PURPLE, '#00BCD4', '#FF69B4', '#7FFF00', '#FF6347'];

let _charts = {};

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function reg(id, chart) {
  destroyChart(id);
  _charts[id] = chart;
  return chart;
}

// ── Follower Area Chart ───────────────────────────────────
function buildFollowerChart(canvasId, data, groupBy = 'daily') {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx || !data.length) return;

  // Group data
  let grouped = [];
  if (groupBy === 'daily') {
    grouped = data.map(d => ({ x: d.date, y: d.count }));
  } else if (groupBy === 'weekly') {
    const weeks = {};
    data.forEach(d => {
      const dt = new Date(d.date);
      const monday = new Date(dt);
      monday.setDate(dt.getDate() - dt.getDay() + 1);
      const key = monday.toISOString().split('T')[0];
      weeks[key] = d.count; // last of week
    });
    grouped = Object.entries(weeks).map(([x, y]) => ({ x, y }));
  } else if (groupBy === 'monthly') {
    const months = {};
    data.forEach(d => {
      const key = d.date.slice(0, 7);
      months[key] = d.count;
    });
    grouped = Object.entries(months).map(([x, y]) => ({ x: x + '-01', y }));
  }

  // Gain per point
  const gainData = grouped.map((d, i) => ({
    x: d.x,
    y: i === 0 ? 0 : d.y - grouped[i - 1].y
  }));

  return reg(canvasId, new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Seguidores',
          data: grouped,
          borderColor: GREEN,
          backgroundColor: GREEN_ALPHA,
          fill: true,
          tension: 0.3,
          pointRadius: grouped.length > 60 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: GREEN,
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Ganados',
          data: gainData,
          borderColor: BLUE,
          backgroundColor: 'rgba(68,136,255,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [4, 4],
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'time', time: { unit: groupBy === 'monthly' ? 'month' : groupBy === 'weekly' ? 'week' : 'day', displayFormats: { day: 'dd MMM', week: 'dd MMM', month: 'MMM yy' } }, grid: { color: GRID } },
        y: { grid: { color: GRID }, title: { display: true, text: 'Seguidores', color: GREEN } },
        y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Ganados', color: BLUE } }
      },
      plugins: {
        legend: { display: true, labels: { color: TEXT_COLOR, usePointStyle: true } },
        tooltip: { backgroundColor: '#111', borderColor: '#333', borderWidth: 1 }
      }
    }
  }));
}

// ── Viewer Bar Chart ──────────────────────────────────────
function buildViewerChart(canvasId, streams) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx || !streams.length) return;

  const labels = streams.map(s => fmtDate(s.startedAt));
  const avgData = streams.map(s => s.avgViewers || 0);
  const peakData = streams.map(s => s.peakViewers || 0);

  return reg(canvasId, new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Avg Viewers', data: avgData, backgroundColor: 'rgba(83,252,24,0.7)', borderRadius: 4, borderSkipped: false },
        { label: 'Peak Viewers', data: peakData, backgroundColor: 'rgba(255,68,68,0.6)', borderRadius: 4, borderSkipped: false }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, beginAtZero: true } },
      plugins: { legend: { labels: { color: TEXT_COLOR } }, tooltip: { backgroundColor: '#111', borderColor: '#333', borderWidth: 1 } }
    }
  }));
}

// ── Duration Bar Chart ────────────────────────────────────
function buildDurationChart(canvasId, streams) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx || !streams.length) return;

  const labels = streams.map(s => fmtDate(s.startedAt));
  const data = streams.map(s => +(((s.duration || 0) / 3600).toFixed(2)));

  return reg(canvasId, new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Horas', data, backgroundColor: 'rgba(68,136,255,0.75)', borderRadius: 4 }]
    },
    options: {
      responsive: true,
      scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, beginAtZero: true, title: { display: true, text: 'Horas', color: BLUE } } },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', borderColor: '#333', borderWidth: 1, callbacks: { label: ctx => `${ctx.parsed.y.toFixed(2)}h` } } }
    }
  }));
}

// ── Categories Doughnut ───────────────────────────────────
function buildCategoriesChart(canvasId, streams) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx || !streams.length) return;

  const counts = {};
  streams.forEach(s => {
    const c = s.category || 'Sin categoría';
    counts[c] = (counts[c] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return reg(canvasId, new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(x => x[0]),
      datasets: [{ data: sorted.map(x => x[1]), backgroundColor: PALETTE, borderColor: '#111', borderWidth: 2, hoverOffset: 6 }]
    },
    options: {
      responsive: true,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { color: TEXT_COLOR, usePointStyle: true, padding: 12, font: { size: 10 } } },
        tooltip: { backgroundColor: '#111', borderColor: '#333', borderWidth: 1 }
      }
    }
  }));
}

// ── Day of Week Bar ───────────────────────────────────────
function buildDayOfWeekChart(canvasId, streams) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const counts = new Array(7).fill(0);
  const totalViewers = new Array(7).fill(0);
  const totalDur = new Array(7).fill(0);

  streams.forEach(s => {
    const d = new Date(s.startedAt).getDay();
    counts[d]++;
    totalViewers[d] += s.avgViewers || 0;
    totalDur[d] += s.duration || 0;
  });

  const avgViewers = counts.map((c, i) => c > 0 ? +(totalViewers[i] / c).toFixed(1) : 0);
  const avgDurH = counts.map((c, i) => c > 0 ? +((totalDur[i] / c) / 3600).toFixed(2) : 0);

  return reg(canvasId, new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [
        { label: 'Streams', data: counts, backgroundColor: 'rgba(83,252,24,0.75)', borderRadius: 5, yAxisID: 'y' },
        { label: 'Avg Viewers', data: avgViewers, backgroundColor: 'rgba(68,136,255,0.6)', borderRadius: 5, yAxisID: 'y2' },
        { label: 'Duración prom (h)', data: avgDurH, backgroundColor: 'rgba(255,215,0,0.5)', borderRadius: 5, yAxisID: 'y3' }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { color: GRID } },
        y: { grid: { color: GRID }, beginAtZero: true, title: { display: true, text: 'Streams', color: GREEN }, position: 'left' },
        y2: { grid: { drawOnChartArea: false }, beginAtZero: true, title: { display: true, text: 'Viewers', color: BLUE }, position: 'right' },
        y3: { display: false, beginAtZero: true }
      },
      plugins: { legend: { labels: { color: TEXT_COLOR } }, tooltip: { backgroundColor: '#111', borderColor: '#333', borderWidth: 1 } }
    }
  }));
}

// ── TVTOP-style per-stream viewer timeline ────────────────
function buildStreamViewerTimeline(canvasId, snapshots, stream) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const labels = snapshots.map(s => new Date(s.ts));
  const data = snapshots.map(s => s.viewers);
  const avgV = data.length ? Math.round(data.reduce((a, b) => a + b, 0) / data.length) : 0;

  return reg(canvasId, new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Viewers',
          data,
          borderColor: GREEN,
          backgroundColor: 'rgba(83,252,24,0.2)',
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2
        },
        {
          label: 'Promedio',
          data: data.map(() => avgV),
          borderColor: BLUE,
          borderDash: [6, 3],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'time', time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } }, grid: { color: GRID } },
        y: { grid: { color: GRID }, beginAtZero: true, title: { display: true, text: 'Usuarios', color: GREEN } }
      },
      plugins: {
        legend: { display: true, labels: { color: TEXT_COLOR } },
        tooltip: {
          backgroundColor: '#111', borderColor: '#333', borderWidth: 1,
          callbacks: {
            title: items => {
              const d = new Date(items[0].parsed.x);
              return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            }
          }
        }
      }
    }
  }));
}

// ── Hourly activity heatmap (stream start hours) ──────────
function buildHourlyChart(canvasId, streams) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const hours = new Array(24).fill(0);
  streams.forEach(s => {
    const h = new Date(s.startedAt).getHours();
    hours[h]++;
  });

  return reg(canvasId, new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`),
      datasets: [{ label: 'Streams iniciados', data: hours, backgroundColor: hours.map(h => h > 0 ? 'rgba(83,252,24,0.75)' : 'rgba(83,252,24,0.1)'), borderRadius: 3 }]
    },
    options: {
      responsive: true,
      scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, beginAtZero: true } },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', borderColor: '#333', borderWidth: 1 } }
    }
  }));
}

// ── Follower milestone progress ───────────────────────────
function buildMilestoneChart(canvasId, current) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const milestones = [100, 250, 500, 1000, 2500, 5000, 10000];
  const data = milestones.map(m => Math.min(current, m));
  const colors = milestones.map(m => current >= m ? GREEN : (current >= m * 0.5 ? BLUE : MUTED));

  return reg(canvasId, new Chart(ctx, {
    type: 'bar',
    data: {
      labels: milestones.map(m => fmtNum(m)),
      datasets: [
        { label: 'Meta', data: milestones, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4 },
        { label: 'Actual', data, backgroundColor: colors, borderRadius: 4 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      scales: {
        x: { grid: { color: GRID }, beginAtZero: true },
        y: { grid: { color: GRID } }
      },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', borderColor: '#333', borderWidth: 1 } }
    }
  }));
}

// ── Growth rate chart (followers per stream) ──────────────
function buildGrowthRateChart(canvasId, streams, followerHistory) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx || !followerHistory.length) return;

  // Map follower count to stream dates
  const data = streams.slice(0, 30).reverse().map(s => {
    const sDate = s.startedAt?.split('T')[0];
    const snap = followerHistory.reduce((closest, f) => {
      return Math.abs(new Date(f.date) - new Date(sDate)) < Math.abs(new Date(closest.date) - new Date(sDate)) ? f : closest;
    }, followerHistory[0]);
    return { x: s.startedAt, y: snap?.count || 0 };
  });

  return reg(canvasId, new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Seguidores al momento del stream',
        data,
        borderColor: GREEN,
        backgroundColor: GREEN_ALPHA,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: GREEN,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { type: 'time', time: { unit: 'day', displayFormats: { day: 'dd MMM' } }, grid: { color: GRID } },
        y: { grid: { color: GRID }, beginAtZero: false }
      },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', borderColor: '#333', borderWidth: 1 } }
    }
  }));
}

window.KickCharts = {
  buildFollowerChart, buildViewerChart, buildDurationChart,
  buildCategoriesChart, buildDayOfWeekChart, buildStreamViewerTimeline,
  buildHourlyChart, buildMilestoneChart, buildGrowthRateChart,
  destroyChart
};

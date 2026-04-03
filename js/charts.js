// ── charts.js ── All Chart.js builders
const G  = '#53FC18', GA = 'rgba(83,252,24,.12)';
const B  = '#4488FF', BA = 'rgba(68,136,255,.12)';
const R  = '#FF4444';
const Y  = '#FFD700';
const OR = '#FF8C00';
const PU = '#9B59B6';
const GR = '#1e1e28';  // grid
const TC = '#60607a';  // text/tick color

Chart.defaults.color          = TC;
Chart.defaults.borderColor    = GR;
Chart.defaults.font.family    = "'JetBrains Mono', monospace";
Chart.defaults.font.size      = 11;

const PAL = [G, B, Y, R, OR, PU, '#00BCD4', '#FF69B4', '#7FFF00', '#FF6347'];

const TT = {
  backgroundColor: '#0e0e14',
  borderColor:     '#2a2a3a',
  borderWidth:     1,
  padding:         10,
  titleColor:      '#e8e8e8',
  bodyColor:       '#aaaaaa',
};

const _charts = {};
function dc(id) { if (_charts[id]) { try { _charts[id].destroy(); } catch(e){} delete _charts[id]; } }
function rc(id, ch) { dc(id); _charts[id] = ch; return ch; }
window.KickCharts = { destroyChart: dc };

// ── Follower area chart (dual y: total + daily gain) ──────
KickCharts.buildFollowerChart = function(id, data, groupBy = 'daily') {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx || !data.length) return;

  let grouped;
  if (groupBy === 'daily') {
    grouped = data.map(d => ({ x: d.date, y: d.count }));
  } else if (groupBy === 'weekly') {
    const w = {};
    data.forEach(d => {
      const dt = new Date(d.date), mon = new Date(dt);
      mon.setDate(dt.getDate() - dt.getDay() + 1);
      w[mon.toISOString().split('T')[0]] = d.count;
    });
    grouped = Object.entries(w).sort((a,b)=>a[0]<b[0]?-1:1).map(([x,y])=>({x,y}));
  } else {
    const m = {};
    data.forEach(d => { m[d.date.slice(0,7)] = d.count; });
    grouped = Object.entries(m).sort((a,b)=>a[0]<b[0]?-1:1).map(([x,y])=>({x:x+'-01',y}));
  }

  const gain = grouped.map((d,i) => ({ x: d.x, y: i === 0 ? 0 : d.y - grouped[i-1].y }));

  return rc(id, new Chart(ctx, {
    type: 'line',
    data: { datasets: [
      { label:'Seguidores', data:grouped, borderColor:G, backgroundColor:GA, fill:true, tension:.3,
        pointRadius:grouped.length>90?0:3, pointHoverRadius:5, borderWidth:2, yAxisID:'y' },
      { label:'Ganados/día', data:gain, borderColor:B, backgroundColor:BA, fill:true, tension:.3,
        pointRadius:0, borderWidth:1.5, borderDash:[4,4], yAxisID:'y2' }
    ]},
    options: {
      responsive:true, animation:false,
      interaction: { mode:'index', intersect:false },
      scales: {
        x: { type:'time', time:{ unit:groupBy==='monthly'?'month':groupBy==='weekly'?'week':'day', displayFormats:{day:'dd MMM',week:'dd MMM',month:'MMM yy'} }, grid:{color:GR}, ticks:{color:TC} },
        y: { grid:{color:GR}, ticks:{color:TC}, title:{display:true,text:'Seguidores',color:G} },
        y2: { position:'right', grid:{drawOnChartArea:false}, ticks:{color:TC}, title:{display:true,text:'Ganados',color:B} }
      },
      plugins: { legend:{display:true,labels:{color:TC,usePointStyle:true}}, tooltip:TT }
    }
  }));
};

// ── Follower gain bar (green/red) ─────────────────────────
KickCharts.buildGainChart = function(id, data) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx || data.length < 2) return;
  const gainData = data.slice(1).map((f,i) => ({ x: f.date, y: f.count - data[i].count }));
  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{ datasets:[{ label:'Ganados', data:gainData, backgroundColor:gainData.map(d=>d.y>=0?'rgba(83,252,24,.8)':'rgba(255,68,68,.7)'), borderRadius:3 }] },
    options:{
      responsive:true, animation:false,
      scales:{ x:{type:'time',time:{unit:'day',displayFormats:{day:'dd MMM'}},grid:{color:GR}}, y:{grid:{color:GR},beginAtZero:true} },
      plugins:{legend:{display:false},tooltip:TT}
    }
  }));
};

// ── Viewer bar chart — ONLY shows real data, null = hidden ─
KickCharts.buildViewerChart = function(id, streams, metric='peak') {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  // Filter to streams that have real viewer data
  const withData = streams.filter(s => {
    const v = metric === 'peak' ? s.peakViewers : s.avgViewers;
    return v != null && v >= 0;
  });

  if (!withData.length) {
    // Draw empty state on canvas
    ctx.fillStyle = TC;
    ctx.font = "13px 'JetBrains Mono'";
    ctx.textAlign = 'center';
    ctx.fillText('Sin datos de viewers disponibles', ctx.canvas.width/2, 60);
    return;
  }

  const labels = withData.map(s => fmtDateShort(s.startedAt));
  const peakData = withData.map(s => s.peakViewers ?? 0);
  const avgData  = withData.map(s => s.avgViewers  ?? 0);

  const datasets = metric === 'both'
    ? [
        { label:'Peak', data:peakData, backgroundColor:'rgba(255,68,68,.7)',  borderRadius:4 },
        { label:'Avg',  data:avgData,  backgroundColor:'rgba(83,252,24,.7)',  borderRadius:4 },
      ]
    : [{ label: metric==='peak'?'Peak Viewers':'Avg Viewers',
         data: metric==='peak'?peakData:avgData,
         backgroundColor:'rgba(83,252,24,.75)', borderRadius:4 }];

  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets },
    options:{
      responsive:true, animation:false,
      interaction:{mode:'index',intersect:false},
      scales:{
        x:{grid:{color:GR},ticks:{color:TC,maxRotation:45}},
        y:{grid:{color:GR},ticks:{color:TC},beginAtZero:true}
      },
      plugins:{legend:{display:metric==='both',labels:{color:TC}},tooltip:TT}
    }
  }));
};

// ── Duration bar chart (seconds input, display in hours) ──
KickCharts.buildDurationChart = function(id, streams) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx || !streams.length) return;

  const valid = streams.filter(s => s.duration > 0);
  if (!valid.length) return;

  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{
      labels: valid.map(s => fmtDateShort(s.startedAt)),
      datasets:[{ label:'Duración', data:valid.map(s => +(s.duration/3600).toFixed(2)),
        backgroundColor:'rgba(68,136,255,.75)', borderRadius:4 }]
    },
    options:{
      responsive:true, animation:false,
      scales:{
        x:{grid:{color:GR},ticks:{color:TC,maxRotation:45}},
        y:{grid:{color:GR},ticks:{color:TC},beginAtZero:true,title:{display:true,text:'Horas',color:B}}
      },
      plugins:{
        legend:{display:false},
        tooltip:{...TT,callbacks:{label:c=>`${c.parsed.y.toFixed(2)}h (${fmtDur(Math.round(c.parsed.y*3600))})`}}
      }
    }
  }));
};

// ── Categories doughnut ───────────────────────────────────
KickCharts.buildCategoryChart = function(id, streams) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx || !streams.length) return;

  const counts = {};
  streams.forEach(s => { const c = s.category || 'Sin categoría'; counts[c] = (counts[c]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,9);

  return rc(id, new Chart(ctx, {
    type:'doughnut',
    data:{ labels:sorted.map(x=>x[0]), datasets:[{ data:sorted.map(x=>x[1]), backgroundColor:PAL, borderColor:'#0e0e14', borderWidth:2, hoverOffset:6 }] },
    options:{
      responsive:true, cutout:'65%',
      plugins:{ legend:{position:'bottom',labels:{color:TC,usePointStyle:true,padding:10,font:{size:10}}}, tooltip:TT }
    }
  }));
};

// ── Day of week analysis ──────────────────────────────────
KickCharts.buildDowChart = function(id, streams) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const DAYS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const counts  = new Array(7).fill(0);
  const totalV  = new Array(7).fill(0);
  const countV  = new Array(7).fill(0); // streams with real viewer data
  const totalD  = new Array(7).fill(0);

  streams.forEach(s => {
    const d = new Date(s.startedAt).getDay();
    counts[d]++;
    if (s.peakViewers != null) { totalV[d] += s.peakViewers; countV[d]++; }
    if (s.duration > 0) totalD[d] += s.duration;
  });

  const avgV = counts.map((c,i) => countV[i]>0 ? Math.round(totalV[i]/countV[i]) : 0);
  const avgH = counts.map((c,i) => c>0 ? +((totalD[i]/c)/3600).toFixed(2) : 0);

  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{ labels:DAYS, datasets:[
      { label:'Streams', data:counts, backgroundColor:'rgba(83,252,24,.75)', borderRadius:5, yAxisID:'y' },
      { label:'Avg Viewers', data:avgV, backgroundColor:'rgba(68,136,255,.6)', borderRadius:5, yAxisID:'y2' },
      { label:'Dur. prom (h)', data:avgH, backgroundColor:'rgba(255,215,0,.45)', borderRadius:5, yAxisID:'y3' }
    ]},
    options:{
      responsive:true, animation:false,
      interaction:{mode:'index',intersect:false},
      scales:{
        x:{grid:{color:GR},ticks:{color:TC}},
        y: {grid:{color:GR},ticks:{color:TC},beginAtZero:true,title:{display:true,text:'Streams',color:G},position:'left'},
        y2:{grid:{drawOnChartArea:false},ticks:{color:TC},beginAtZero:true,title:{display:true,text:'Viewers',color:B},position:'right'},
        y3:{display:false,beginAtZero:true}
      },
      plugins:{legend:{labels:{color:TC}},tooltip:TT}
    }
  }));
};

// ── Hourly start times ────────────────────────────────────
KickCharts.buildHourlyChart = function(id, streams) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const hours = new Array(24).fill(0);
  streams.forEach(s => { const h = new Date(s.startedAt).getHours(); hours[h]++; });

  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{
      labels: Array.from({length:24},(_,i)=>`${String(i).padStart(2,'0')}:00`),
      datasets:[{ label:'Streams iniciados', data:hours,
        backgroundColor:hours.map(h=>h>0?'rgba(83,252,24,.8)':'rgba(83,252,24,.1)'), borderRadius:3 }]
    },
    options:{
      responsive:true, animation:false,
      scales:{x:{grid:{color:GR},ticks:{color:TC,maxRotation:45}},y:{grid:{color:GR},ticks:{color:TC},beginAtZero:true}},
      plugins:{legend:{display:false},tooltip:TT}
    }
  }));
};

// ── Milestone horizontal bar ──────────────────────────────
KickCharts.buildMilestoneChart = function(id, current) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const ms = [100,250,500,750,1000,2500,5000,10000];
  const data = ms.map(m => Math.min(current, m));
  const colors = ms.map(m => current>=m ? G : (current>=m*.5 ? B : '#2a2a3a'));

  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{ labels:ms.map(m=>fmtNum(m)), datasets:[
      { label:'Meta', data:ms, backgroundColor:'rgba(255,255,255,.04)', borderRadius:4 },
      { label:'Actual', data, backgroundColor:colors, borderRadius:4 }
    ]},
    options:{
      indexAxis:'y', responsive:true, animation:false,
      scales:{x:{grid:{color:GR},ticks:{color:TC},beginAtZero:true},y:{grid:{color:GR},ticks:{color:TC}}},
      plugins:{legend:{display:false},tooltip:TT}
    }
  }));
};

// ── Viewer trend over time (with moving average) ──────────
KickCharts.buildViewerTrendChart = function(id, streams, metric='peak') {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const withData = streams.filter(s => (metric==='peak'?s.peakViewers:s.avgViewers) != null);
  if (!withData.length) return;

  const data = withData.map(s => ({ x:s.startedAt, y:metric==='peak'?(s.peakViewers??0):(s.avgViewers??0) }));
  const ma   = data.map((d,i) => {
    const w = data.slice(Math.max(0,i-4),i+1);
    return { x:d.x, y:Math.round(w.reduce((a,b)=>a+b.y,0)/w.length) };
  });

  return rc(id, new Chart(ctx, {
    type:'line',
    data:{ datasets:[
      { label:metric==='peak'?'Peak':'Avg', data, borderColor:G, backgroundColor:GA, fill:true, tension:.2, pointRadius:data.length>30?0:3, borderWidth:2 },
      { label:'Media móvil (5)', data:ma, borderColor:B, borderDash:[5,3], pointRadius:0, borderWidth:1.5, fill:false }
    ]},
    options:{
      responsive:true, animation:false,
      scales:{
        x:{type:'time',time:{unit:'day',displayFormats:{day:'dd MMM'}},grid:{color:GR},ticks:{color:TC}},
        y:{grid:{color:GR},ticks:{color:TC},beginAtZero:true}
      },
      plugins:{legend:{labels:{color:TC}},tooltip:TT}
    }
  }));
};

// ── Distribution histogram ────────────────────────────────
KickCharts.buildDistChart = function(id, values, xLabel='') {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx || !values.length) return;

  const mx = Math.max(...values);
  const mn = Math.min(...values);
  const bs = Math.max(1, Math.ceil((mx-mn)/10));
  const bins = new Array(10).fill(0);
  values.forEach(v => { const bi = Math.min(9,Math.floor((v-mn)/bs)); bins[bi]++; });
  const labels = Array.from({length:10},(_,i)=>`${mn+i*bs}–${mn+(i+1)*bs}`);

  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ label:xLabel||'Frecuencia', data:bins, backgroundColor:'rgba(83,252,24,.7)', borderRadius:3 }] },
    options:{
      responsive:true, animation:false,
      scales:{x:{grid:{color:GR},ticks:{color:TC,maxRotation:45,font:{size:10}}},y:{grid:{color:GR},ticks:{color:TC},beginAtZero:true}},
      plugins:{legend:{display:false},tooltip:TT}
    }
  }));
};

// ── Scatter: viewers vs duration ──────────────────────────
KickCharts.buildScatterChart = function(id, streams) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const data = streams.filter(s=>s.duration>0&&s.peakViewers!=null)
    .map(s => ({ x:+(s.duration/3600).toFixed(2), y:s.peakViewers }));

  return rc(id, new Chart(ctx, {
    type:'scatter',
    data:{ datasets:[{ label:'Streams', data, backgroundColor:'rgba(83,252,24,.65)', pointRadius:5, pointHoverRadius:7 }] },
    options:{
      responsive:true, animation:false,
      scales:{
        x:{grid:{color:GR},ticks:{color:TC},title:{display:true,text:'Duración (horas)',color:TC}},
        y:{grid:{color:GR},ticks:{color:TC},title:{display:true,text:'Peak Viewers',color:TC},beginAtZero:true}
      },
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:c=>`${c.parsed.x.toFixed(1)}h → ${c.parsed.y} viewers`}}}
    }
  }));
};

// ── TVTOP-style viewer timeline ───────────────────────────
KickCharts.buildTimelineChart = function(id, snapshots) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx || !snapshots.length) return;

  const data = snapshots.map(s => s.viewers);
  const avg  = Math.round(data.reduce((a,b)=>a+b,0)/data.length);

  return rc(id, new Chart(ctx, {
    type:'line',
    data:{ labels:snapshots.map(s=>new Date(s.ts)), datasets:[
      { label:'Viewers', data, borderColor:G, backgroundColor:'rgba(83,252,24,.2)', fill:true, tension:.2, pointRadius:0, pointHoverRadius:4, borderWidth:2 },
      { label:'Promedio', data:data.map(()=>avg), borderColor:B, borderDash:[6,3], pointRadius:0, borderWidth:1.5, fill:false }
    ]},
    options:{
      responsive:true, animation:false,
      interaction:{mode:'index',intersect:false},
      scales:{
        x:{type:'time',time:{unit:'minute',displayFormats:{minute:'HH:mm'}},grid:{color:GR},ticks:{color:TC}},
        y:{grid:{color:GR},ticks:{color:TC},beginAtZero:true}
      },
      plugins:{legend:{labels:{color:TC}},tooltip:{...TT,callbacks:{title:items=>new Date(items[0].parsed.x).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}}}
    }
  }));
};

// ── Consistency: streams per week ─────────────────────────
KickCharts.buildConsistencyChart = function(id, streams) {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const weeks = {};
  streams.forEach(s => {
    const dt = new Date(s.startedAt), mon = new Date(dt);
    mon.setDate(dt.getDate() - dt.getDay() + 1);
    const k = mon.toISOString().split('T')[0];
    weeks[k] = (weeks[k]||0)+1;
  });
  const sorted = Object.entries(weeks).sort((a,b)=>a[0]<b[0]?-1:1).slice(-16);

  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{ labels:sorted.map(([d])=>fmtDateShort(d)), datasets:[{ label:'Streams/semana', data:sorted.map(([,v])=>v), backgroundColor:'rgba(68,136,255,.7)', borderRadius:4 }] },
    options:{
      responsive:true, animation:false,
      scales:{x:{grid:{color:GR},ticks:{color:TC,maxRotation:45}},y:{grid:{color:GR},ticks:{color:TC},beginAtZero:true}},
      plugins:{legend:{display:false},tooltip:TT}
    }
  }));
};

// ── Monthly summary bar ───────────────────────────────────
KickCharts.buildMonthlySummaryChart = function(id, streams, metric='streams') {
  dc(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;

  const months = {};
  streams.forEach(s => {
    if (!s.startedAt) return;
    const k = s.startedAt.slice(0,7);
    if (!months[k]) months[k] = { streams:0, duration:0, peakViewers:[], avgViewers:[] };
    months[k].streams++;
    months[k].duration += s.duration||0;
    if (s.peakViewers != null) months[k].peakViewers.push(s.peakViewers);
    if (s.avgViewers  != null) months[k].avgViewers.push(s.avgViewers);
  });

  const sorted = Object.entries(months).sort((a,b)=>a[0]<b[0]?-1:1);
  const labels = sorted.map(([m])=>m);

  let data, color, label;
  if (metric === 'streams') {
    data  = sorted.map(([,v])=>v.streams);
    color = 'rgba(83,252,24,.75)'; label = 'Streams';
  } else if (metric === 'hours') {
    data  = sorted.map(([,v])=>+(v.duration/3600).toFixed(1));
    color = 'rgba(68,136,255,.75)'; label = 'Horas';
  } else if (metric === 'peakViewers') {
    data  = sorted.map(([,v])=>v.peakViewers.length?Math.round(v.peakViewers.reduce((a,b)=>a+b)/v.peakViewers.length):0);
    color = 'rgba(255,68,68,.75)'; label = 'Avg Peak';
  }

  return rc(id, new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ label, data, backgroundColor:color, borderRadius:4 }] },
    options:{
      responsive:true, animation:false,
      scales:{x:{grid:{color:GR},ticks:{color:TC,maxRotation:45}},y:{grid:{color:GR},ticks:{color:TC},beginAtZero:true}},
      plugins:{legend:{display:false},tooltip:TT}
    }
  }));
};

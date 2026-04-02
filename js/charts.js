// ── charts.js ── Chart.js builders
const G='#53FC18',GA='rgba(83,252,24,.12)',B='#4488FF',R='#FF4444',Y='#FFD700',GRID='#1e1e1e',TC='#666';
const PAL=[G,B,Y,R,'#FF8C00','#9B59B6','#00BCD4','#FF69B4','#7FFF00','#FF6347'];
const TT={ backgroundColor:'#111', borderColor:'#2a2a2a', borderWidth:1, padding:10 };

Chart.defaults.color=TC; Chart.defaults.borderColor=GRID;
Chart.defaults.font.family="'JetBrains Mono',monospace"; Chart.defaults.font.size=11;

const _c={};
function dc(id){ if(_c[id]){ _c[id].destroy(); delete _c[id]; } }
function rc(id,ch){ dc(id); _c[id]=ch; return ch; }

window.KickCharts = {
  destroyChart: dc,

  buildFollowerChart(id, data, groupBy='daily') {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx||!data.length) return;
    let grouped=[];
    if(groupBy==='daily') grouped=data.map(d=>({x:d.date,y:d.count}));
    else if(groupBy==='weekly') {
      const w={};
      data.forEach(d=>{const dt=new Date(d.date),mon=new Date(dt);mon.setDate(dt.getDate()-dt.getDay()+1);w[mon.toISOString().split('T')[0]]=d.count;});
      grouped=Object.entries(w).map(([x,y])=>({x,y}));
    } else {
      const m={};
      data.forEach(d=>{m[d.date.slice(0,7)]=d.count;});
      grouped=Object.entries(m).map(([x,y])=>({x:x+'-01',y}));
    }
    const gain=grouped.map((d,i)=>({x:d.x,y:i===0?0:d.y-grouped[i-1].y}));
    return rc(id, new Chart(ctx,{
      type:'line',
      data:{datasets:[
        {label:'Seguidores',data:grouped,borderColor:G,backgroundColor:GA,fill:true,tension:.3,pointRadius:grouped.length>60?0:3,pointHoverRadius:5,borderWidth:2,yAxisID:'y'},
        {label:'Ganados',data:gain,borderColor:B,backgroundColor:'rgba(68,136,255,.08)',fill:true,tension:.3,pointRadius:0,borderWidth:1.5,borderDash:[4,4],yAxisID:'y2'}
      ]},
      options:{responsive:true,interaction:{mode:'index',intersect:false},
        scales:{
          x:{type:'time',time:{unit:groupBy==='monthly'?'month':groupBy==='weekly'?'week':'day',displayFormats:{day:'dd MMM',week:'dd MMM',month:'MMM yy'}},grid:{color:GRID}},
          y:{grid:{color:GRID},title:{display:true,text:'Seguidores',color:G}},
          y2:{position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'Ganados',color:B}}
        },
        plugins:{legend:{display:true,labels:{color:TC,usePointStyle:true}},tooltip:TT}
      }
    }));
  },

  buildViewerChart(id, streams, mode='peak') {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx||!streams.length) return;
    const labels=streams.map(s=>fmtDate(s.startedAt));
    const data=streams.map(s=>mode==='peak'?(s.peakViewers||0):(s.avgViewers||0));
    return rc(id, new Chart(ctx,{
      type:'bar',
      data:{labels,datasets:[{label:mode==='peak'?'Peak Viewers':'Avg Viewers',data,backgroundColor:'rgba(83,252,24,.75)',borderRadius:4}]},
      options:{responsive:true,scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},beginAtZero:true}},plugins:{legend:{display:false},tooltip:TT}}
    }));
  },

  buildDurationChart(id, streams) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx||!streams.length) return;
    return rc(id, new Chart(ctx,{
      type:'bar',
      data:{labels:streams.map(s=>fmtDate(s.startedAt)),datasets:[{label:'Horas',data:streams.map(s=>+((s.duration||0)/3600).toFixed(2)),backgroundColor:'rgba(68,136,255,.75)',borderRadius:4}]},
      options:{responsive:true,scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},beginAtZero:true,title:{display:true,text:'Horas',color:B}}},plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:c=>`${c.parsed.y.toFixed(2)}h`}}}}
    }));
  },

  buildCategoriesChart(id, streams) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx||!streams.length) return;
    const counts={};
    streams.forEach(s=>{const c=s.category||'Sin categoría';counts[c]=(counts[c]||0)+1;});
    const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
    return rc(id, new Chart(ctx,{
      type:'doughnut',
      data:{labels:sorted.map(x=>x[0]),datasets:[{data:sorted.map(x=>x[1]),backgroundColor:PAL,borderColor:'#111',borderWidth:2,hoverOffset:6}]},
      options:{responsive:true,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:TC,usePointStyle:true,padding:12,font:{size:10}}},tooltip:TT}}
    }));
  },

  buildDayOfWeekChart(id, streams) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx) return;
    const days=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const counts=new Array(7).fill(0), tv=new Array(7).fill(0), td=new Array(7).fill(0);
    streams.forEach(s=>{const d=new Date(s.startedAt).getDay();counts[d]++;tv[d]+=s.peakViewers||0;td[d]+=s.duration||0;});
    const avgV=counts.map((c,i)=>c>0?Math.round(tv[i]/c):0);
    const avgH=counts.map((c,i)=>c>0?+((td[i]/c)/3600).toFixed(2):0);
    return rc(id, new Chart(ctx,{
      type:'bar',
      data:{labels:days,datasets:[
        {label:'Streams',data:counts,backgroundColor:'rgba(83,252,24,.75)',borderRadius:5,yAxisID:'y'},
        {label:'Avg Viewers',data:avgV,backgroundColor:'rgba(68,136,255,.6)',borderRadius:5,yAxisID:'y2'},
        {label:'Dur prom (h)',data:avgH,backgroundColor:'rgba(255,215,0,.45)',borderRadius:5,yAxisID:'y3'},
      ]},
      options:{responsive:true,interaction:{mode:'index',intersect:false},
        scales:{
          x:{grid:{color:GRID}},
          y:{grid:{color:GRID},beginAtZero:true,title:{display:true,text:'Streams',color:G},position:'left'},
          y2:{grid:{drawOnChartArea:false},beginAtZero:true,title:{display:true,text:'Viewers',color:B},position:'right'},
          y3:{display:false,beginAtZero:true}
        },
        plugins:{legend:{labels:{color:TC}},tooltip:TT}
      }
    }));
  },

  buildStreamViewerTimeline(id, snapshots) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx) return;
    const data=snapshots.map(s=>s.viewers);
    const avg=data.length?Math.round(data.reduce((a,b)=>a+b,0)/data.length):0;
    return rc(id, new Chart(ctx,{
      type:'line',
      data:{labels:snapshots.map(s=>new Date(s.ts)),datasets:[
        {label:'Viewers',data,borderColor:G,backgroundColor:'rgba(83,252,24,.2)',fill:true,tension:.2,pointRadius:0,pointHoverRadius:4,borderWidth:2},
        {label:'Promedio',data:data.map(()=>avg),borderColor:B,borderDash:[6,3],pointRadius:0,borderWidth:1.5,fill:false}
      ]},
      options:{responsive:true,interaction:{mode:'index',intersect:false},
        scales:{
          x:{type:'time',time:{unit:'minute',displayFormats:{minute:'HH:mm'}},grid:{color:GRID}},
          y:{grid:{color:GRID},beginAtZero:true,title:{display:true,text:'Usuarios',color:G}}
        },
        plugins:{legend:{labels:{color:TC}},tooltip:{...TT,callbacks:{title:items=>new Date(items[0].parsed.x).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}}}
      }
    }));
  },

  buildHourlyChart(id, streams) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx) return;
    const hours=new Array(24).fill(0);
    streams.forEach(s=>{const h=new Date(s.startedAt).getHours();hours[h]++;});
    return rc(id, new Chart(ctx,{
      type:'bar',
      data:{labels:Array.from({length:24},(_,i)=>`${String(i).padStart(2,'0')}:00`),datasets:[{label:'Streams',data:hours,backgroundColor:hours.map(h=>h>0?'rgba(83,252,24,.75)':'rgba(83,252,24,.1)'),borderRadius:3}]},
      options:{responsive:true,scales:{x:{grid:{color:GRID}},y:{grid:{color:GRID},beginAtZero:true}},plugins:{legend:{display:false},tooltip:TT}}
    }));
  },

  buildMilestoneChart(id, current) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx) return;
    const ms=[100,250,500,1000,2500,5000,10000];
    const data=ms.map(m=>Math.min(current,m));
    const colors=ms.map(m=>current>=m?G:current>=m*.5?B:'#333');
    return rc(id, new Chart(ctx,{
      type:'bar',
      data:{labels:ms.map(m=>fmtNum(m)),datasets:[
        {label:'Meta',data:ms,backgroundColor:'rgba(255,255,255,.04)',borderRadius:4},
        {label:'Actual',data,backgroundColor:colors,borderRadius:4}
      ]},
      options:{indexAxis:'y',responsive:true,scales:{x:{grid:{color:GRID},beginAtZero:true},y:{grid:{color:GRID}}},plugins:{legend:{display:false},tooltip:TT}}
    }));
  },

  buildViewerTrendChart(id, streams, metric='peak') {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx||!streams.length) return;
    const data=streams.map(s=>({x:s.startedAt,y:metric==='peak'?(s.peakViewers||0):(s.avgViewers||0)}));
    const ma=data.map((d,i)=>{const w=data.slice(Math.max(0,i-4),i+1);return{x:d.x,y:Math.round(w.reduce((a,b)=>a+b.y,0)/w.length)};});
    return rc(id, new Chart(ctx,{
      type:'line',
      data:{datasets:[
        {label:metric==='peak'?'Peak':'Avg',data,borderColor:G,backgroundColor:GA,fill:true,tension:.2,pointRadius:data.length>30?0:3,borderWidth:2},
        {label:'Media móvil (5)',data:ma,borderColor:B,borderDash:[5,3],pointRadius:0,borderWidth:1.5,fill:false}
      ]},
      options:{responsive:true,scales:{x:{type:'time',time:{unit:'day',displayFormats:{day:'dd MMM'}},grid:{color:GRID}},y:{grid:{color:GRID},beginAtZero:true}},plugins:{legend:{labels:{color:TC}},tooltip:TT}}
    }));
  },

  buildDistributionChart(id, streams) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx||!streams.length) return;
    const vals=streams.map(s=>s.peakViewers||0), mx=Math.max(...vals);
    const bs=Math.max(1,Math.ceil(mx/10)), bins=new Array(10).fill(0);
    vals.forEach(v=>{const bi=Math.min(9,Math.floor(v/bs));bins[bi]++;});
    const labels=Array.from({length:10},(_,i)=>`${i*bs}–${(i+1)*bs}`);
    return rc(id, new Chart(ctx,{
      type:'bar',
      data:{labels,datasets:[{label:'Streams',data:bins,backgroundColor:'rgba(83,252,24,.7)',borderRadius:3}]},
      options:{responsive:true,scales:{x:{grid:{color:GRID},ticks:{maxRotation:45}},y:{grid:{color:GRID},beginAtZero:true}},plugins:{legend:{display:false},tooltip:TT}}
    }));
  },

  buildScatterChart(id, streams) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx||!streams.length) return;
    const data=streams.filter(s=>s.duration&&s.peakViewers).map(s=>({x:+((s.duration/3600).toFixed(2)),y:s.peakViewers}));
    return rc(id, new Chart(ctx,{
      type:'scatter',
      data:{datasets:[{label:'Streams',data,backgroundColor:'rgba(83,252,24,.6)',pointRadius:5,pointHoverRadius:7}]},
      options:{responsive:true,scales:{x:{grid:{color:GRID},title:{display:true,text:'Duración (h)',color:TC}},y:{grid:{color:GRID},title:{display:true,text:'Peak Viewers',color:TC},beginAtZero:true}},plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:c=>`${c.parsed.x.toFixed(1)}h → ${c.parsed.y} viewers`}}}}
    }));
  },

  buildGainDailyChart(id, followerHistory) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx||followerHistory.length<2) return;
    const gainData=followerHistory.slice(1).map((f,i)=>({x:f.date,y:f.count-followerHistory[i].count}));
    return rc(id, new Chart(ctx,{
      type:'bar',
      data:{datasets:[{label:'Ganados',data:gainData,backgroundColor:gainData.map(d=>d.y>=0?'rgba(83,252,24,.75)':'rgba(255,68,68,.7)'),borderRadius:3}]},
      options:{responsive:true,scales:{x:{type:'time',time:{unit:'day',displayFormats:{day:'dd MMM'}},grid:{color:GRID}},y:{grid:{color:GRID},beginAtZero:true}},plugins:{legend:{display:false},tooltip:TT}}
    }));
  },

  buildConsistencyChart(id, streams) {
    const ctx=document.getElementById(id)?.getContext('2d'); if(!ctx) return;
    const weeks={};
    streams.forEach(s=>{const dt=new Date(s.startedAt),mon=new Date(dt);mon.setDate(dt.getDate()-dt.getDay()+1);const k=mon.toISOString().split('T')[0];weeks[k]=(weeks[k]||0)+1;});
    const sorted=Object.entries(weeks).sort((a,b)=>a[0].localeCompare(b[0])).slice(-12);
    return rc(id, new Chart(ctx,{
      type:'bar',
      data:{labels:sorted.map(([d])=>fmtDate(d)),datasets:[{label:'Streams/semana',data:sorted.map(([,v])=>v),backgroundColor:'rgba(68,136,255,.7)',borderRadius:4}]},
      options:{responsive:true,scales:{x:{grid:{color:GRID},ticks:{maxRotation:45}},y:{grid:{color:GRID},beginAtZero:true}},plugins:{legend:{display:false},tooltip:TT}}
    }));
  }
};

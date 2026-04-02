// ── db.js ── IndexedDB wrapper for KickStats
const KickDB = (() => {
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open('kickstats_v3', 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('config'))
          d.createObjectStore('config', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('streams')) {
          const s = d.createObjectStore('streams', { keyPath: 'id', autoIncrement: true });
          s.createIndex('kickId', 'kickId');
          s.createIndex('startedAt', 'startedAt');
        }
        if (!d.objectStoreNames.contains('followerHistory'))
          d.createObjectStore('followerHistory', { keyPath: 'date' });
        if (!d.objectStoreNames.contains('viewerSnapshots')) {
          const vs = d.createObjectStore('viewerSnapshots', { keyPath: 'id', autoIncrement: true });
          vs.createIndex('streamKickId', 'streamKickId');
          vs.createIndex('ts', 'ts');
        }
        if (!d.objectStoreNames.contains('liveSession'))
          d.createObjectStore('liveSession', { keyPath: 'k' });
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
  const p = r => new Promise((res, rej) => { r.onsuccess = e => res(e.target.result); r.onerror = e => rej(e); });

  async function setConfig(k, v) { await open(); return p(tx('config','readwrite').put({ k, v })); }
  async function getConfig(k)    { await open(); const r = await p(tx('config').get(k)); return r?.v ?? null; }

  async function saveStream(stream) {
    await open();
    const store = tx('streams','readwrite');
    const ex = await p(store.index('kickId').get(stream.kickId));
    const obj = ex ? { ...ex, ...stream, id: ex.id } : stream;
    return p(tx('streams','readwrite').put(obj));
  }
  async function getAllStreams() {
    await open();
    const all = await p(tx('streams').getAll());
    return (all||[]).sort((a,b) => new Date(b.startedAt) - new Date(a.startedAt));
  }
  async function getStreamsInRange(start, end) {
    const all = await getAllStreams();
    return all.filter(s => { const d = new Date(s.startedAt); return d >= start && d <= end; });
  }
  async function getStreamByLocalId(id) { await open(); return p(tx('streams').get(id)); }

  async function saveFollowerSnapshot(date, count) { await open(); return p(tx('followerHistory','readwrite').put({ date, count })); }
  async function getFollowerHistory() {
    await open();
    const all = await p(tx('followerHistory').getAll());
    return (all||[]).sort((a,b) => a.date.localeCompare(b.date));
  }

  async function saveViewerSnapshot(streamKickId, viewers, ts) {
    await open();
    return p(tx('viewerSnapshots','readwrite').add({ streamKickId, viewers, ts: ts||Date.now() }));
  }
  async function getViewerSnapshots(streamKickId) {
    await open();
    const all = await p(tx('viewerSnapshots').index('streamKickId').getAll(streamKickId));
    return (all||[]).sort((a,b) => a.ts - b.ts);
  }

  async function saveLiveSession(data) { await open(); return p(tx('liveSession','readwrite').put({ k:'current', ...data })); }
  async function getLiveSession()      { await open(); return p(tx('liveSession').get('current')); }
  async function clearLiveSession()    { await open(); return p(tx('liveSession','readwrite').delete('current')); }

  async function exportAll() {
    const [streams, followerHistory] = await Promise.all([getAllStreams(), getFollowerHistory()]);
    return JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), streams, followerHistory }, null, 2);
  }
  async function importAll(jsonStr) {
    const data = JSON.parse(jsonStr);
    if (data.streams) for (const s of data.streams) await saveStream(s);
    if (data.followerHistory) for (const f of data.followerHistory) await saveFollowerSnapshot(f.date, f.count);
  }

  return {
    open, setConfig, getConfig,
    saveStream, getAllStreams, getStreamsInRange, getStreamByLocalId,
    saveFollowerSnapshot, getFollowerHistory,
    saveViewerSnapshot, getViewerSnapshots,
    saveLiveSession, getLiveSession, clearLiveSession,
    exportAll, importAll
  };
})();
window.KickDB = KickDB;

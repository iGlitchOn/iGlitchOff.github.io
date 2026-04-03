// ── db.js ── IndexedDB for KickStats
const KickDB = (() => {
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open('kickstats_v4', 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('config'))
          d.createObjectStore('config', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('streams')) {
          const s = d.createObjectStore('streams', { keyPath: 'id', autoIncrement: true });
          s.createIndex('kickId',    'kickId',    { unique: false });
          s.createIndex('startedAt', 'startedAt', { unique: false });
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
        if (!d.objectStoreNames.contains('clips'))
          d.createObjectStore('clips', { keyPath: 'id' });
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return db.transaction(store, mode).objectStore(store);
  }
  const p = r => new Promise((res, rej) => {
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });

  // Config
  async function setConfig(k, v)  { await open(); return p(tx('config','readwrite').put({ k, v })); }
  async function getConfig(k)     { await open(); const r = await p(tx('config').get(k)); return r?.v ?? null; }

  // Streams — upsert by kickId
  async function saveStream(stream) {
    await open();
    const store = tx('streams','readwrite');
    const ex = await p(store.index('kickId').get(stream.kickId));
    // Merge: prefer non-null values from new data
    const merged = ex ? mergeStream(ex, stream) : stream;
    return p(tx('streams','readwrite').put(merged));
  }

  function mergeStream(existing, incoming) {
    const merged = { ...existing };
    // Update fields, but don't overwrite real data with null/0
    const fields = ['title','category','startedAt','endedAt','duration','thumbnail','source'];
    for (const f of fields) {
      if (incoming[f] != null && incoming[f] !== '') merged[f] = incoming[f];
    }
    // For viewers: prefer non-null
    if (incoming.peakViewers != null) merged.peakViewers = incoming.peakViewers;
    if (incoming.avgViewers  != null) merged.avgViewers  = incoming.avgViewers;
    return merged;
  }

  async function getAllStreams() {
    await open();
    const all = await p(tx('streams').getAll());
    return (all || [])
      .filter(s => s.startedAt) // discard entries with no date
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }
  async function getStreamsInRange(start, end) {
    const all = await getAllStreams();
    return all.filter(s => {
      const d = new Date(s.startedAt);
      return d >= start && d <= end;
    });
  }
  async function getStreamByLocalId(id) { await open(); return p(tx('streams').get(id)); }

  // Follower snapshots (one per day)
  async function saveFollowerSnapshot(date, count) {
    await open();
    return p(tx('followerHistory','readwrite').put({ date, count }));
  }
  async function getFollowerHistory() {
    await open();
    const all = await p(tx('followerHistory').getAll());
    return (all || []).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Viewer snapshots (per live stream minute)
  async function saveViewerSnapshot(streamKickId, viewers, ts) {
    await open();
    return p(tx('viewerSnapshots','readwrite').add({ streamKickId, viewers, ts: ts || Date.now() }));
  }
  async function getViewerSnapshots(streamKickId) {
    await open();
    const all = await p(tx('viewerSnapshots').index('streamKickId').getAll(streamKickId));
    return (all || []).sort((a, b) => a.ts - b.ts);
  }

  // Live session
  async function saveLiveSession(data) { await open(); return p(tx('liveSession','readwrite').put({ k:'current', ...data })); }
  async function getLiveSession()      { await open(); return p(tx('liveSession').get('current')); }
  async function clearLiveSession()    { await open(); return p(tx('liveSession','readwrite').delete('current')); }

  // Clips cache
  async function saveClips(clips) {
    await open();
    const store = tx('clips','readwrite');
    for (const c of clips) {
      await p(store.put(c));
    }
  }
  async function getClipsCache() { await open(); return p(tx('clips').getAll()); }

  // Export / Import
  async function exportAll() {
    const [streams, followerHistory] = await Promise.all([getAllStreams(), getFollowerHistory()]);
    return JSON.stringify({ version: 4, exportedAt: new Date().toISOString(), streams, followerHistory }, null, 2);
  }
  async function importAll(jsonStr) {
    const data = JSON.parse(jsonStr);
    if (data.streams)         for (const s of data.streams)         await saveStream(s);
    if (data.followerHistory) for (const f of data.followerHistory) await saveFollowerSnapshot(f.date, f.count);
  }

  return {
    open, setConfig, getConfig,
    saveStream, getAllStreams, getStreamsInRange, getStreamByLocalId,
    saveFollowerSnapshot, getFollowerHistory,
    saveViewerSnapshot, getViewerSnapshots,
    saveLiveSession, getLiveSession, clearLiveSession,
    saveClips, getClipsCache,
    exportAll, importAll
  };
})();

window.KickDB = KickDB;

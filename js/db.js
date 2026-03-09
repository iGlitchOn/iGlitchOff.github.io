// ── db.js ── IndexedDB wrapper for KickStats
const DB_NAME = 'kickstats_db';
const DB_VER = 2;

const KickDB = (() => {
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('config'))
          d.createObjectStore('config', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('streams')) {
          const s = d.createObjectStore('streams', { keyPath: 'id', autoIncrement: true });
          s.createIndex('startedAt', 'startedAt');
          s.createIndex('kickId', 'kickId');
        }
        if (!d.objectStoreNames.contains('followerHistory'))
          d.createObjectStore('followerHistory', { keyPath: 'date' });
        if (!d.objectStoreNames.contains('viewerSnapshots')) {
          const vs = d.createObjectStore('viewerSnapshots', { keyPath: 'id', autoIncrement: true });
          vs.createIndex('streamKickId', 'streamKickId');
          vs.createIndex('ts', 'ts');
        }
        if (!d.objectStoreNames.contains('liveSession'))
          d.createObjectStore('liveSession', { keyPath: 'key' });
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async function setConfig(key, value) {
    await open();
    return new Promise((res, rej) => {
      const r = tx('config', 'readwrite').put({ key, value });
      r.onsuccess = () => res(); r.onerror = e => rej(e);
    });
  }

  async function getConfig(key) {
    await open();
    return new Promise((res, rej) => {
      const r = tx('config').get(key);
      r.onsuccess = e => res(e.target.result?.value ?? null);
      r.onerror = e => rej(e);
    });
  }

  async function saveStream(stream) {
    await open();
    return new Promise((res, rej) => {
      const store = tx('streams', 'readwrite');
      const q = store.index('kickId').get(stream.kickId);
      q.onsuccess = e => {
        const existing = e.target.result;
        const obj = existing ? { ...existing, ...stream, id: existing.id } : stream;
        const r = store.put(obj);
        r.onsuccess = () => res(); r.onerror = ev => rej(ev);
      };
      q.onerror = ev => rej(ev);
    });
  }

  async function getAllStreams() {
    await open();
    return new Promise((res, rej) => {
      const r = tx('streams').getAll();
      r.onsuccess = e => res((e.target.result || []).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)));
      r.onerror = e => rej(e);
    });
  }

  async function getStreamsInRange(startDate, endDate) {
    const all = await getAllStreams();
    return all.filter(s => { const d = new Date(s.startedAt); return d >= startDate && d <= endDate; });
  }

  async function getStreamByLocalId(id) {
    await open();
    return new Promise((res, rej) => {
      const r = tx('streams').get(id);
      r.onsuccess = e => res(e.target.result || null);
      r.onerror = e => rej(e);
    });
  }

  async function saveFollowerSnapshot(date, count) {
    await open();
    return new Promise((res, rej) => {
      const r = tx('followerHistory', 'readwrite').put({ date, count });
      r.onsuccess = () => res(); r.onerror = e => rej(e);
    });
  }

  async function getFollowerHistory() {
    await open();
    return new Promise((res, rej) => {
      const r = tx('followerHistory').getAll();
      r.onsuccess = e => res((e.target.result || []).sort((a, b) => a.date.localeCompare(b.date)));
      r.onerror = e => rej(e);
    });
  }

  async function saveViewerSnapshot(streamKickId, viewers, ts) {
    await open();
    return new Promise((res, rej) => {
      const r = tx('viewerSnapshots', 'readwrite').add({ streamKickId, viewers, ts: ts || Date.now() });
      r.onsuccess = () => res(); r.onerror = e => rej(e);
    });
  }

  async function getViewerSnapshots(streamKickId) {
    await open();
    return new Promise((res, rej) => {
      const r = tx('viewerSnapshots').index('streamKickId').getAll(streamKickId);
      r.onsuccess = e => res((e.target.result || []).sort((a, b) => a.ts - b.ts));
      r.onerror = e => rej(e);
    });
  }

  async function saveLiveSession(data) {
    await open();
    return new Promise((res, rej) => {
      const r = tx('liveSession', 'readwrite').put({ key: 'current', ...data });
      r.onsuccess = () => res(); r.onerror = e => rej(e);
    });
  }

  async function getLiveSession() {
    await open();
    return new Promise((res, rej) => {
      const r = tx('liveSession').get('current');
      r.onsuccess = e => res(e.target.result || null);
      r.onerror = e => rej(e);
    });
  }

  async function clearLiveSession() {
    await open();
    return new Promise((res, rej) => {
      const r = tx('liveSession', 'readwrite').delete('current');
      r.onsuccess = () => res(); r.onerror = e => rej(e);
    });
  }

  async function exportAll() {
    const [streams, followerHistory] = await Promise.all([getAllStreams(), getFollowerHistory()]);
    return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), streams, followerHistory }, null, 2);
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

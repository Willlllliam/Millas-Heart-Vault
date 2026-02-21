// db.js
const DB_NAME = "millashvault";
const DB_VERSION = 5; // bump version to add meta store
const STORE_ENTRIES = "entries"; // key = dayKey (YYYY-MM-DD)
const STORE_META = "meta";       // key = string, value = any

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: "dayKey" });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(db, name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

export async function getEntry(dayKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_ENTRIES).get(dayKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function putEntry(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    // add() prevents overwrite => no editing in MVP
    const req = store(db, STORE_ENTRIES, "readwrite").add(entry);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllEntries() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_ENTRIES).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// --- Meta (cooldown etc) ---

export async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_META).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = store(db, STORE_META, "readwrite").put({ key, value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

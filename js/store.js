/* Persistence.

   IndexedDB is the real home for the data. localStorage is kept as a fallback
   for the case where IndexedDB can't be opened at all (private browsing, a
   corrupted profile), because the app must never fail to take a bill.

   Shape:
     kv          { k, v }   — "settings", "treatments", "meta"
     bills       keyed by id
     patients    keyed by id
     packages    keyed by id   (Phase 2 — created now so no upgrade is needed later)
     redemptions keyed by id   (Phase 2)
     snapshots   keyed by id   — rolling local backups

   The old localStorage keys (cfg2, tx2, bills2) are read once during migration
   and then deliberately LEFT IN PLACE for a few releases, as a safety net. */

import { uid, toast } from "./util.js";

const DB_NAME = "qi-tcm";
const DB_VERSION = 1;
const STORES = ["kv", "bills", "patients", "packages", "redemptions", "snapshots"];
const SNAPSHOT_KEEP = 14;
const SNAPSHOT_EVERY_MS = 24 * 60 * 60 * 1000;

let db = null;
export let backend = "none";        // "idb" | "ls" | "none"

/* ---------- localStorage fallback ---------- */
const mem = {};
let HAS_LS = false;
try { localStorage.setItem("__t","1"); localStorage.removeItem("__t"); HAS_LS = true; } catch(e){ HAS_LS = false; }

function lsLoad(k, f){
  try {
    const r = HAS_LS ? localStorage.getItem(k) : mem[k];
    return r == null ? f : JSON.parse(r);
  } catch(e){ return f; }
}
function lsSave(k, v){
  const r = JSON.stringify(v);
  try { if (HAS_LS) localStorage.setItem(k, r); else mem[k] = r; }
  catch(e){ mem[k] = r; }
}

/* ---------- open ---------- */
/* Resolved rather than assumed: in a browser window and globalThis are the
   same object, but the global is the reliable one to read. */
function idbFactory(){
  if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB;
  if (typeof globalThis !== "undefined" && globalThis.indexedDB) return globalThis.indexedDB;
  if (typeof window !== "undefined" && window.indexedDB) return window.indexedDB;
  return null;
}

function openDb(){
  return new Promise((resolve, reject) => {
    const idb = idbFactory();
    if (!idb) { reject(new Error("no indexedDB")); return; }
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); }
    catch(e){ reject(e); return; }

    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv", { keyPath:"k" });
      STORES.filter((s) => s !== "kv").forEach((s) => {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath:"id" });
      });
      const t = req.transaction;
      const bills = t.objectStore("bills");
      if (!bills.indexNames.contains("by_patient")) bills.createIndex("by_patient", "patientId");
      if (!bills.indexNames.contains("by_date"))    bills.createIndex("by_date", "date");
      const packs = t.objectStore("packages");
      if (!packs.indexNames.contains("by_patient")) packs.createIndex("by_patient", "patientId");
      if (!packs.indexNames.contains("by_status"))  packs.createIndex("by_status", "status");
      const reds = t.objectStore("redemptions");
      if (!reds.indexNames.contains("by_package")) reds.createIndex("by_package", "packageId");
      if (!reds.indexNames.contains("by_bill"))    reds.createIndex("by_bill", "billId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error || new Error("open failed"));
    req.onblocked = () => reject(new Error("blocked"));
    setTimeout(() => reject(new Error("timeout")), 8000);
  });
}

function run(storeNames, mode, fn){
  return new Promise((resolve, reject) => {
    if (backend !== "idb"){ reject(new Error("no idb")); return; }
    let t;
    try { t = db.transaction(storeNames, mode); }
    catch(e){ reject(e); return; }
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error || new Error("aborted"));
    try { out = fn(t); } catch(e){ try { t.abort(); } catch(_){} reject(e); }
  });
}

/* ---------- public API ---------- */

/* Several writes that must land together or not at all — a redemption writing
   a bill, a redemption record and a package update, for instance. Phase 2
   depends on this; Phase 1 does not yet exercise it. */
export function tx(storeNames, fn){
  if (backend === "idb") return run(storeNames, "readwrite", fn);
  return Promise.resolve(fn(null));   /* fallback has no transactions */
}

export async function putKV(k, v){
  if (backend === "idb"){
    try { await run(["kv"], "readwrite", (t) => t.objectStore("kv").put({ k, v })); return; }
    catch(e){ warn(e); }
  }
  lsSave(kvLsKey(k), v);
}

function kvLsKey(k){
  return k === "settings" ? "cfg2" : k === "treatments" ? "tx2" : "qi_" + k;
}

export async function putRecord(storeName, record){
  if (backend === "idb"){
    try { await run([storeName], "readwrite", (t) => t.objectStore(storeName).put(record)); return; }
    catch(e){ warn(e); }
  }
  mirrorToLs(storeName);
}

export async function putMany(storeName, records){
  if (backend === "idb"){
    try {
      await run([storeName], "readwrite", (t) => {
        const s = t.objectStore(storeName);
        records.forEach((r) => s.put(r));
      });
      return;
    } catch(e){ warn(e); }
  }
  mirrorToLs(storeName);
}

export async function remove(storeName, id){
  if (backend === "idb"){
    try { await run([storeName], "readwrite", (t) => t.objectStore(storeName).delete(id)); return; }
    catch(e){ warn(e); }
  }
  mirrorToLs(storeName);
}

export async function clearStore(storeName){
  if (backend === "idb"){
    try { await run([storeName], "readwrite", (t) => t.objectStore(storeName).clear()); return; }
    catch(e){ warn(e); }
  }
  mirrorToLs(storeName);
}

export async function replaceAll(storeName, records){
  if (backend === "idb"){
    try {
      await run([storeName], "readwrite", (t) => {
        const s = t.objectStore(storeName);
        s.clear();
        records.forEach((r) => s.put(r));
      });
      return;
    } catch(e){ warn(e); }
  }
  mirrorToLs(storeName);
}

/* In fallback mode the in-memory arrays are the truth, so a change to any of
   them is written back wholesale. state.js registers these suppliers. */
const suppliers = {};
export function registerSupplier(storeName, fn){ suppliers[storeName] = fn; }
function mirrorToLs(storeName){
  const fn = suppliers[storeName];
  if (!fn) return;
  if (storeName === "bills") lsSave("bills2", fn());
  else lsSave("qi_" + storeName, fn());
}

export function markMigratedInLs(meta){ lsSave("qi_meta", meta); }

let warned = false;
function warn(e){
  if (warned) return;
  warned = true;
  console.warn("storage write failed", e);
  toast("Couldn't save to this device's storage.");
}

/* ---------- boot ---------- */
export async function ready(){
  try {
    db = await openDb();
    backend = "idb";
  } catch(e){
    console.warn("IndexedDB unavailable, using localStorage", e);
    backend = HAS_LS ? "ls" : "none";
  }

  if (navigator.storage && navigator.storage.persist){
    try { await navigator.storage.persist(); } catch(e){ /* best effort */ }
  }

  if (backend === "idb") return loadFromIdb();
  return loadFromLs();
}

/* Reads every store in one transaction. The getAll results are captured as
   they arrive and handed back when the transaction completes. */
function readAllStores(){
  const out = {};
  return run(STORES, "readonly", (t) => {
    STORES.forEach((name) => {
      const r = t.objectStore(name).getAll();
      r.onsuccess = () => { out[name] = r.result || []; };
    });
  }).then(() => {
    STORES.forEach((name) => { if (!out[name]) out[name] = []; });
    return out;
  });
}

async function loadFromIdb(){
  let out, readOk = true;
  try { out = await readAllStores(); }
  catch(e){
    readOk = false;
    out = {};
    STORES.forEach((n) => { out[n] = []; });
    console.warn("could not read the database", e);
  }

  /* The kv store holds { k, v } rows; everything else is a plain list. The
     rows are turned into a map here, and the map must be spread AFTER the
     raw stores or `out.kv` clobbers it and every setting silently reads as
     undefined. That bug cost a release — keep the order. */
  const kvMap = {};
  (out.kv || []).forEach((row) => { if (row && row.k) kvMap[row.k] = row.v; });

  /* The one-time migration from v1.5 rewrites bills from the old
     localStorage copy, so it must only ever run when the database is
     genuinely new. A failed read looks identical to an empty database from
     here, and treating one as the other would throw away every bill issued
     since the upgrade. */
  const migrated = kvMap.meta && kvMap.meta.migratedFrom;
  const reallyEmpty = readOk
    && !(out.bills || []).length
    && !(out.patients || []).length
    && !Object.keys(kvMap).length;

  if (!migrated && !readOk){
    return { ...out, fromLegacy:false, kv:kvMap, legacy:null, readFailed:true };
  }

  if (!migrated && reallyEmpty){
    const old = {
      settings: lsLoad("cfg2", null),
      treatments: lsLoad("tx2", null),
      bills: lsLoad("bills2", null)
    };
    if (old.settings || old.treatments || old.bills){
      return { ...out, fromLegacy:true, kv:kvMap, legacy:old };
    }
  }

  /* A boot that fell back to localStorage writes patients and bills only
     there. If the database opens cleanly later, that work is invisible and
     looks exactly like it was lost. Adopt it — but only when there is
     nothing in the database to contradict, so nothing is ever resurrected
     over newer data. */
  if (readOk && !(out.patients || []).length && !(out.bills || []).length){
    const stranded = {
      patients: lsLoad("qi_patients", []),
      packages: lsLoad("qi_packages", []),
      redemptions: lsLoad("qi_redemptions", [])
    };
    if ((stranded.patients || []).length){
      return { ...out, fromLegacy:false, kv:kvMap, legacy:null, rescued:stranded };
    }
  }

  return { ...out, fromLegacy:false, kv:kvMap, legacy:null };
}

function loadFromLs(){
  const meta = lsLoad("qi_meta", null);
  return {
    fromLegacy: false,
    fallback: true,
    /* This tablet has used IndexedDB before, so what's in localStorage is a
       pre-migration snapshot — older than the real data sitting in a database
       we currently can't open. Entering bills now would fork the records. */
    staleRisk: !!(meta && meta.migratedFrom),
    kv: {
      settings: lsLoad("cfg2", null),
      treatments: lsLoad("tx2", null),
      meta: meta
    },
    bills: lsLoad("bills2", []),
    patients: lsLoad("qi_patients", []),
    packages: lsLoad("qi_packages", []),
    redemptions: lsLoad("qi_redemptions", []),
    snapshots: []
  };
}

/* ---------- snapshots ---------- */
export async function maybeSnapshot(buildDump){
  if (backend !== "idb") return;
  const snaps = await listSnapshots();
  if (!snaps) return;
  const last = snaps[0];
  if (last && Date.now() - new Date(last.at).getTime() < SNAPSHOT_EVERY_MS) return;

  const row = { id: uid(), at: new Date().toISOString(), dump: buildDump() };
  const drop = snaps.slice(SNAPSHOT_KEEP - 1).map((s) => s.id);
  try {
    await run(["snapshots"], "readwrite", (t) => {
      const s = t.objectStore("snapshots");
      s.put(row);
      drop.forEach((id) => s.delete(id));
    });
  } catch(e){ /* a missed snapshot is not worth bothering her about */ }
}

export async function listSnapshots(){
  if (backend !== "idb") return [];
  let snaps = [];
  try {
    await run(["snapshots"], "readonly", (t) => {
      const r = t.objectStore("snapshots").getAll();
      r.onsuccess = () => { snaps = r.result || []; };
    });
  } catch(e){ return []; }
  return snaps.sort((a,b) => String(b.at).localeCompare(String(a.at)));
}

export async function restoreSnapshot(id){
  const snaps = await listSnapshots();
  const hit = snaps.filter((s) => s.id === id)[0];
  return hit ? hit.dump : null;
}

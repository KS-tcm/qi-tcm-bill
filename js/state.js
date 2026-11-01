/* The data the whole app shares, plus the defaults it starts from.

   Reads are synchronous against these in-memory arrays; writes go to
   IndexedDB in the background. The datasets are small enough (one clinic,
   one practitioner) that holding them all in memory is the simple, correct
   choice, and it keeps every render function synchronous. */

import { uid } from "./util.js";
import * as store from "./store.js";

export const DEFAULT_TX = [
  { c:"consult", n:"First Time Consultation", p:35 },
  { c:"consult", n:"Follow-up Consultation",  p:20 },

  { c:"treat", n:"Acupuncture One Side",  p:80 },
  { c:"treat", n:"Acupuncture Both Side", p:120 },
  { c:"treat", n:"Cupping",               p:60 },
  { c:"treat", n:"Guasha",                p:60 },
  { c:"treat", n:"Moxibustion by Pcs",    p:5 },
  { c:"treat", n:"Moxibustion by Box",    p:35 },
  { c:"treat", n:"Face Acupuncture",      p:108 },
  { c:"treat", n:"Face Guasha",           p:118 },
  { c:"treat", n:"Herbal Medicine",       p:15, v:1, d:"RM15–20 per day" },

  { c:"combo", n:"FACE & BODY BALANCE",   p:148, d:"Face Acupuncture + Body Acupuncture" },
  { c:"combo", n:"GLOW & RELEASE",        p:168, d:"Face Guasha + Body Acupuncture" },
  { c:"combo", n:"FACIAL REJUVENATION",   p:178, d:"Face Guasha + Face Acupuncture" },
  { c:"combo", n:"ULTIMATE FACE & BODY",  p:248, d:"Face Guasha + Face Acupuncture + Body Acupuncture" },

  /* Prepaid packages: p is what she is paid, cr the credit it grants,
     mo how many months it stays spendable. */
  { c:"package", n:"Prepaid 500", p:500, cr:600,  mo:9 },
  { c:"package", n:"Prepaid 800", p:800, cr:1000, mo:12 }
];

export const DEFAULT_SETTINGS = {
  name:"Qi TCM", addr:"", phone:"", reg:"",
  foot:"Thank you. Please rest well.",
  prefix:"", next:1, seal:"Qi",
  patNext:1,                /* running patient number */
  pkgNext:1,                /* running package number */
  showBillNo:true,          /* print the bill number on the bill itself */
  encrypt:true,             /* encrypted backups by default */
  lastBackup:""             /* ISO date of the last backup she saved */
};

export const S = {
  settings: Object.assign({}, DEFAULT_SETTINGS),
  treatments: DEFAULT_TX.slice(),
  bills: [],
  patients: [],
  packages: [],        /* Phase 2 */
  redemptions: [],     /* Phase 2 */
  meta: {},
  qr: {},              /* { tng, duitnow } as data URLs, set in Setup */
  draft: newDraft(),
  shown: null
};

export function newDraft(prev){
  return {
    name: "",
    patientId: null,
    items: [],
    disc: { m: prev ? prev.disc.m : "pct", v:0, s: prev ? prev.disc.s : "treat" },
    whenMode: "now",
    when: null,
    pay: "",
    credit: 0,           /* ringgit of package credit she has chosen to use */
    creditOwnerId: null  /* whose package — usually the patient, sometimes family */
  };
}

/* ---------- persistence helpers used across modules ---------- */
export function saveSettings(){ return store.putKV("settings", S.settings); }
export function saveTreatments(){ return store.putKV("treatments", S.treatments); }
export function saveMeta(){ return store.putKV("meta", S.meta); }
export function saveQr(){ return store.putKV("qr", S.qr); }
export function saveBill(b){ return store.putRecord("bills", b); }
export function savePatient(p){ return store.putRecord("patients", p); }

export function sortBills(){
  S.bills.sort((a,b) => String(b.date).localeCompare(String(a.date)));
}

/* A complete dump, used for backups and for the rolling local snapshots. */
export function buildDump(){
  return {
    v: 6,
    app: "2.0",
    savedAt: new Date().toISOString(),
    cfg: S.settings,
    qr: S.qr,
    tx: S.treatments,
    bills: S.bills,
    patients: S.patients,
    packages: S.packages,
    redemptions: S.redemptions
  };
}

export function applyDump(d){
  S.settings   = Object.assign({}, DEFAULT_SETTINGS, d.cfg || {});
  S.qr         = d.qr || {};
  S.treatments = d.tx || DEFAULT_TX.slice();
  S.bills      = (d.bills || []).map(normaliseBill);
  S.patients   = d.patients || [];
  S.packages   = d.packages || [];
  S.redemptions= d.redemptions || [];
  sortBills();
  return Promise.all([
    store.putKV("settings", S.settings),
    store.putKV("qr", S.qr),
    store.putKV("treatments", S.treatments),
    store.replaceAll("bills", S.bills),
    store.replaceAll("patients", S.patients),
    store.replaceAll("packages", S.packages),
    store.replaceAll("redemptions", S.redemptions)
  ]);
}

/* Bills from before v2.0 have no id and no patient link. */
export function normaliseBill(b){
  if (!b.id) b.id = uid();
  if (!("patientId" in b)) b.patientId = null;
  /* The method was called "DuitNow QR" up to v2.1, which read as "DuitNow QR
     QR" once the app started appending the word. Bills already on the tablet
     carry the old wording and would otherwise match no option in the
     payment picker, showing as blank. */
  if (b.pay === "DuitNow QR") b.pay = "DuitNow";
  return b;
}

/* In localStorage fallback mode every change rewrites the whole array. */
store.registerSupplier("bills", () => S.bills);
store.registerSupplier("patients", () => S.patients);
store.registerSupplier("packages", () => S.packages);
store.registerSupplier("redemptions", () => S.redemptions);

/* ---------- boot ---------- */
export async function boot(){
  const loaded = await store.ready();

  if (loaded.legacy){
    /* First run after the upgrade: bring cfg2 / tx2 / bills2 across.
       The localStorage keys are left in place as a safety net. */
    const L = loaded.legacy;
    S.settings   = Object.assign({}, DEFAULT_SETTINGS, L.settings || {});
    S.treatments = L.treatments || DEFAULT_TX.slice();
    S.bills      = (L.bills || []).map(normaliseBill);
    S.patients   = [];
    S.meta = { migratedFrom: "localStorage@1.5", migratedAt: new Date().toISOString() };
    sortBills();
    await Promise.all([
      store.putKV("settings", S.settings),
      store.putKV("treatments", S.treatments),
      store.replaceAll("bills", S.bills),
      store.putKV("meta", S.meta)
    ]);
    /* a marker in localStorage too, so a later fallback boot can tell that
       the real data now lives in IndexedDB and warn instead of serving stale */
    store.markMigratedInLs(S.meta);
  } else if (loaded.rescued){
    /* An earlier session wrote to the fallback store because the database
       would not open. It opens now, so bring that work across rather than
       leaving it stranded where nothing will ever read it. */
    S.settings    = Object.assign({}, DEFAULT_SETTINGS, loaded.kv.settings || {});
    S.treatments  = loaded.kv.treatments || DEFAULT_TX.slice();
    S.meta        = loaded.kv.meta || {};
    S.bills       = (loaded.bills || []).map(normaliseBill);
    S.patients    = loaded.rescued.patients || [];
    S.packages    = loaded.rescued.packages || [];
    S.redemptions = loaded.rescued.redemptions || [];
    sortBills();
    await Promise.all([
      store.replaceAll("patients", S.patients),
      store.replaceAll("packages", S.packages),
      store.replaceAll("redemptions", S.redemptions)
    ]);
  } else {
    S.settings    = Object.assign({}, DEFAULT_SETTINGS, loaded.kv.settings || {});
    S.treatments  = loaded.kv.treatments || DEFAULT_TX.slice();
    S.meta        = loaded.kv.meta || {};
    S.qr          = loaded.kv.qr || {};
    S.bills       = (loaded.bills || []).map(normaliseBill);
    S.patients    = loaded.patients || [];
    S.packages    = loaded.packages || [];
    S.redemptions = loaded.redemptions || [];
    sortBills();
  }

  S.draft = newDraft();
  return loaded;
}

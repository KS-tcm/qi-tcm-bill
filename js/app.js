/* Bootstrap: open storage, load everything, wire the tabs, start the
   update check. Nothing here knows how any one feature works. */

import { $, all, toast, emit, on, APP_VERSION } from "./util.js";
import { S, boot, buildDump, applyDump } from "./state.js";
import * as store from "./store.js";
import { initSheet } from "./sheet.js";
import { initBilling, renderChips, renderDraft, paintPicked } from "./billing.js";
import { initRecords, renderRecords, resetAmountVisibility } from "./records.js";
import { initSettings, fillSettings, refreshCounters } from "./settings.js";
import * as patients from "./patients.js";
import * as linkbills from "./linkbills.js";

const TABS = ["bill","patients","records","settings","link"];

export function goTab(name){
  all(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  TABS.forEach((k) => {
    const el = $("panel-" + k);
    if (el) el.hidden = (k !== name);
  });
  if (name === "records"){ resetAmountVisibility(); renderRecords(); }
  if (name === "patients") patients.render();
  if (name === "settings") refreshCounters();
  if (name === "link")     linkbills.open();
}

function initTabs(){
  all(".tab").forEach((btn) => {
    btn.addEventListener("click", () => goTab(btn.dataset.tab));
  });
}

/* ---------- update checking ----------
   version.json is tiny and always fetched fresh, so the app can tell when a
   newer build has been published without re-downloading itself. */
let updateDismissed = false;

function checkForUpdate(){
  fetch("version.json?t=" + Date.now(), { cache:"no-store" })
    .then((r) => r.ok ? r.json() : null)
    .then((j) => {
      if (!j || !j.version || updateDismissed) return;
      if (String(j.version) !== APP_VERSION){
        $("updMsg").textContent = "Version " + j.version + " is ready. You're on " + APP_VERSION + ".";
        $("updBar").hidden = false;
      }
    })
    .catch(() => { /* offline — nothing to do */ });
}

function initUpdates(){
  $("updBtn").addEventListener("click", () => {
    if (S.draft.items.length &&
        !confirm("Reload now?\n\nThe visit you're part-way through will be cleared. Issued bills are not affected.")) return;
    location.reload();
  });
  $("updLater").addEventListener("click", () => {
    updateDismissed = true;
    $("updBar").hidden = true;
  });

  window.addEventListener("load", checkForUpdate);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(); });
  setInterval(checkForUpdate, 30 * 60 * 1000);
}

/* ---------- go ---------- */
async function start(){
  const loaded = await boot();

  const w = $("storeWarn");
  w.hidden = (store.backend !== "none");
  if (store.backend === "ls"){
    w.hidden = false;
    w.textContent = loaded.staleRisk
      ? "This tablet's database couldn't be opened, and what's shown here is an older copy of your records. Don't enter new bills yet — close the app, reopen it, and if this message comes back, restore from your most recent backup."
      : "This tablet's database couldn't be opened, so the app is using simpler fallback storage. Everything still works — save a backup today.";
  }

  initTabs();
  initSheet();
  initBilling();
  initRecords();
  initSettings();

  fillSettings();
  renderChips();
  renderDraft();
  paintPicked();
  renderRecords();
  patients.render();

  initUpdates();

  if ("serviceWorker" in navigator){
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* file:// or offline — ignore */ });
    });
  }

  /* rolling local snapshot, at most one a day */
  store.maybeSnapshot(buildDump);

  if (loaded && loaded.legacy){
    toast("Your bills have been moved to the new storage.");
  }
  if (loaded && loaded.rescued){
    toast("Recovered " + (loaded.rescued.patients || []).length + " patients saved while the database was unavailable.");
  }
  if (loaded && loaded.readFailed){
    const w = $("storeWarn");
    w.hidden = false;
    w.textContent = "This tablet's database could not be read just now, so nothing is shown. Don't enter anything — close the app, reopen it, and if this message comes back, restore from your most recent backup.";
  }

  $("linkTab").hidden = !linkbills.shouldOffer();
  if (linkbills.shouldOffer()) goTab("link");
  else goTab("bill");
}

on("go-tab", goTab);
on("restore-dump", async (dump) => {
  await applyDump(dump);
  emit("restored");
  renderChips(); renderDraft(); paintPicked(); renderRecords(); patients.render();
  toast("Snapshot restored.");
});
on("restored", () => {
  renderChips(); renderDraft(); paintPicked(); renderRecords(); patients.render();
  $("linkTab").hidden = !linkbills.shouldOffer();
});
on("bills-changed", () => { $("linkTab").hidden = !linkbills.shouldOffer(); });

start().catch((e) => {
  console.error(e);
  document.body.innerHTML = "<p style='padding:24px;font-family:system-ui'>"
    + "The app couldn't start. Reload the page, and if it keeps happening, mention version "
    + APP_VERSION + ".</p>";
});

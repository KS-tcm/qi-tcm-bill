/* The Setup tab: practice details, bill numbering, price list, backup
   passphrase, and the danger zone. */

import { $, all, esc, toast, emit, on, APP_VERSION, fmtDate } from "./util.js";
import { S, saveSettings, saveTreatments, saveQr } from "./state.js";
import { renderChips } from "./billing.js";
import * as store from "./store.js";

const SFIELDS = {
  sName:"name", sAddr:"addr", sPhone:"phone", sReg:"reg",
  sFoot:"foot", sPrefix:"prefix", sSeal:"seal"
};

/* Variable treatments are ordinary treatments (same category, same discount
   treatment) that carry a v flag — the flag is what splits them in Setup. */
const TX_GROUPS = [
  { box:"txConsult",  match:(t) => t.c === "consult" },
  { box:"txTreat",    match:(t) => t.c === "treat" && !t.v },
  { box:"txVariable", match:(t) => t.c === "treat" && !!t.v },
  { box:"txCombo",    match:(t) => t.c === "combo" },
  { box:"txPackage",  match:(t) => t.c === "package" }
];

export function renderTxEditor(){
  TX_GROUPS.forEach((g) => {
    const box = $(g.box);
    box.innerHTML = "";
    S.treatments.forEach((t, i) => {
      if (!g.match(t)) return;
      const row = document.createElement("div");
      row.className = "tx";

      const n = document.createElement("input");
      n.className = "n"; n.value = t.n; n.placeholder = "Name";
      n.addEventListener("input", () => { S.treatments[i].n = n.value; saveTreatments(); renderChips(); });

      const p = document.createElement("input");
      p.className = "p"; p.type = "number"; p.step = "0.01"; p.min = "0";
      p.inputMode = "decimal"; p.value = t.p;
      p.addEventListener("input", () => { S.treatments[i].p = parseFloat(p.value) || 0; saveTreatments(); renderChips(); });

      const del = document.createElement("button");
      del.textContent = "×";
      del.setAttribute("aria-label", "Remove " + t.n);
      del.addEventListener("click", () => {
        if (!confirm("Remove " + S.treatments[i].n + " from the list?")) return;
        S.treatments.splice(i, 1);
        saveTreatments(); renderTxEditor(); renderChips();
      });

      row.appendChild(n); row.appendChild(p); row.appendChild(del);

      if (t.c === "package"){
        const cr = document.createElement("input");
        cr.className = "p cr"; cr.type = "number"; cr.step = "1"; cr.min = "0";
        cr.inputMode = "decimal"; cr.value = t.cr == null ? "" : t.cr;
        cr.setAttribute("aria-label", "Credit granted");
        cr.addEventListener("input", () => { S.treatments[i].cr = parseFloat(cr.value) || 0; saveTreatments(); renderChips(); });

        const mo = document.createElement("input");
        mo.className = "p mo"; mo.type = "number"; mo.step = "1"; mo.min = "1";
        mo.inputMode = "numeric"; mo.value = t.mo == null ? 12 : t.mo;
        mo.setAttribute("aria-label", "Months valid");
        mo.addEventListener("input", () => { S.treatments[i].mo = parseInt(mo.value, 10) || 12; saveTreatments(); renderChips(); });

        const lab = document.createElement("span");
        lab.className = "pkglab";
        lab.textContent = "paid → credit → months";

        row.appendChild(cr); row.appendChild(mo); row.appendChild(lab);
      }

      if (t.c === "combo" || t.v){
        const d = document.createElement("input");
        d.className = "d"; d.value = t.d || "";
        d.placeholder = t.v ? "Note printed on the bill, e.g. RM15–20 per day" : "What's included";
        d.addEventListener("input", () => { S.treatments[i].d = d.value; saveTreatments(); renderChips(); });
        row.appendChild(d);
      }
      box.appendChild(row);
    });
  });
}

export function fillSettings(){
  Object.keys(SFIELDS).forEach((id) => { $(id).value = S.settings[SFIELDS[id]] || ""; });
  $("sNext").value = S.settings.next;
  $("sPatNext").value = S.settings.patNext || 1;
  $("brandName").textContent = S.settings.name || "Clinic";
  $("sEncrypt").checked = !!S.settings.encrypt;
  $("sShowBillNo").checked = S.settings.showBillNo !== false;
  paintQr();
  paintPassNote();
  renderTxEditor();
}

function paintQr(){
  ["tng","duitnow"].forEach((key) => {
    const img = $("qrPrev-" + key);
    const note = $("qrNote-" + key);
    if (S.qr && S.qr[key]){
      img.src = S.qr[key];
      img.hidden = false;
      note.textContent = "Saved on this tablet.";
      $("qrClear-" + key).hidden = false;
    } else {
      img.hidden = true;
      note.textContent = "Nothing uploaded — the app will look for qr-" + key + ".png in the app folder.";
      $("qrClear-" + key).hidden = true;
    }
  });
}

/* Scaled down before saving: a QR only needs to be sharp enough to scan,
   and the full-size photo would otherwise ride along in every backup and
   every daily snapshot. */
function onQrFile(e, key){
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (!/^image\//.test(f.type)){ toast("That isn't an image."); return; }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 512;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
      x.drawImage(img, 0, 0, w, h);
      S.qr[key] = c.toDataURL("image/png");
      saveQr();
      paintQr();
      toast((key === "tng" ? "TnG" : "DuitNow") + " QR saved.");
    };
    img.onerror = () => toast("Couldn't read that image.");
    img.src = String(reader.result || "");
  };
  reader.readAsDataURL(f);
}

function paintPassNote(){
  const n = $("passNote");
  if (S.settings.passphrase){
    n.textContent = "A passphrase is set. A lost passphrase cannot be recovered and your backups will be unreadable — write it down somewhere other than this tablet.";
  } else {
    n.textContent = "No passphrase set yet. Backups stay unencrypted until you set one.";
  }
}

export function initSettings(){
  Object.keys(SFIELDS).forEach((id) => {
    $(id).addEventListener("input", (e) => {
      S.settings[SFIELDS[id]] = e.target.value;
      saveSettings();
      if (id === "sName") $("brandName").textContent = S.settings.name || "Clinic";
    });
  });

  $("sNext").addEventListener("input", (e) => {
    S.settings.next = Math.max(1, parseInt(e.target.value, 10) || 1);
    saveSettings();
  });
  $("sPatNext").addEventListener("input", (e) => {
    S.settings.patNext = Math.max(1, parseInt(e.target.value, 10) || 1);
    saveSettings();
  });

  $("sShowBillNo").addEventListener("change", (e) => {
    S.settings.showBillNo = e.target.checked;
    saveSettings();
  });

  ["tng","duitnow"].forEach((key) => {
    $("qrPick-" + key).addEventListener("click", () => $("qrFile-" + key).click());
    $("qrFile-" + key).addEventListener("change", (e) => onQrFile(e, key));
    $("qrClear-" + key).addEventListener("click", () => {
      if (!S.qr[key]) return;
      if (!confirm("Remove the saved " + (key === "tng" ? "TnG" : "DuitNow") + " QR?")) return;
      delete S.qr[key];
      saveQr();
      paintQr();
      toast("QR removed.");
    });
  });

  $("sEncrypt").addEventListener("change", (e) => {
    S.settings.encrypt = e.target.checked;
    saveSettings();
    if (S.settings.encrypt && !S.settings.passphrase) toast("Set a passphrase below.");
  });

  $("btnPass").addEventListener("click", () => {
    const a = prompt("New backup passphrase:", "");
    if (a === null) return;
    if (a.length < 6){ toast("Use at least 6 characters."); return; }
    const b = prompt("Type it once more:", "");
    if (b === null) return;
    if (a !== b){ toast("Those didn't match."); return; }
    S.settings.passphrase = a;
    saveSettings();
    paintPassNote();
    toast("Passphrase set.");
  });

  all("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.add;
      S.treatments.push(
        kind === "variable" ? { c:"treat", v:1, n:"", p:0, d:"" }
      : kind === "package"  ? { c:"package", n:"", p:0, cr:0, mo:12 }
      : { c:kind, n:"", p:0 });
      saveTreatments();
      renderTxEditor();
      const box = $({ consult:"txConsult", treat:"txTreat", variable:"txVariable", combo:"txCombo", package:"txPackage" }[kind]);
      const ins = box.querySelectorAll("input.n");
      if (ins.length) ins[ins.length - 1].focus();
    });
  });

  $("btnWipe").addEventListener("click", async () => {
    if (!confirm("Erase every issued bill?\n\nPatients, the price list and your settings are NOT touched. Save a backup first if you might need the bills.")) return;
    if (!confirm("This cannot be undone. Erase all bills?")) return;
    S.bills = [];
    await store.replaceAll("bills", []);
    emit("bills-changed");
    toast("All bills erased.");
  });

  $("btnSnapshots").addEventListener("click", showSnapshots);

  $("verNote").textContent = "App version " + APP_VERSION + ". Mention this if something looks wrong.";
}

async function showSnapshots(){
  const snaps = await store.listSnapshots();
  if (!snaps.length){ toast("No local snapshots yet."); return; }
  const lines = snaps.map((s, i) =>
    (i + 1) + ". " + fmtDate(s.at) + " — " + ((s.dump.bills || []).length) + " bills, "
    + ((s.dump.patients || []).length) + " patients"
  ).join("\n");
  const pick = prompt("Local snapshots (kept automatically, one a day):\n\n" + lines
    + "\n\nType a number to restore it, or Cancel.", "");
  if (pick === null) return;
  const n = parseInt(pick, 10);
  if (!n || n < 1 || n > snaps.length){ toast("No snapshot with that number."); return; }
  const chosen = snaps[n - 1];
  if (!confirm("Restore the snapshot from " + fmtDate(chosen.at) + "?\n\nEverything currently on this tablet is replaced.")) return;
  emit("restore-dump", chosen.dump);
}

on("restored", fillSettings);

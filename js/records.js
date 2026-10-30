/* The Records tab: reporting period, the bill list, CSV export, backup. */

import { $, all, esc, money, fmtDate, fmtTime, csvTime, localInputValue, download,
         csvCell, toast, emit, on, startOfDay, startOfWeek, CATS, PAY_METHODS } from "./util.js";
import { S, saveBill, saveSettings, buildDump, applyDump } from "./state.js";
import { isVoid, live, lineSubtotal, cashTaken, creditUsed, eligibleForDiscount } from "./money.js";
import * as packages from "./packages.js";
import { renderSheet } from "./sheet.js";
import { findPatient, renderPackageRows, billTag } from "./patients.js";
import { saveBackup, readBackupFile, daysSince } from "./backup.js";

const period = { kind:"month", from:"", to:"" };

/* Amounts start hidden every time the tab is opened. The tablet sits on a
   counter with patients on the other side of it, and the day's takings are
   nobody else's business. Deliberately not remembered — the safe state is
   the one you get without thinking about it. */
let hideAmounts = true;
const MASK = "[RM ****]";
function show(v){ return hideAmounts ? MASK : money(v); }

function periodRange(){
  const now = new Date();
  if (period.kind === "today") return { a: startOfDay(now), b: null, label: "Today" };
  if (period.kind === "week")  return { a: startOfWeek(now), b: null, label: "This week (from Monday)" };
  if (period.kind === "month") return { a: new Date(now.getFullYear(), now.getMonth(), 1), b: null, label: "This month" };
  if (period.kind === "custom"){
    const a = period.from ? startOfDay(new Date(period.from + "T00:00")) : null;
    const b = period.to ? new Date(new Date(period.to + "T00:00").getTime() + 86400000) : null;
    const lbl = (a ? fmtDate(a) : "the beginning") + " to "
              + (period.to ? fmtDate(new Date(period.to + "T00:00")) : "today");
    return { a, b, label: lbl };
  }
  return { a:null, b:null, label:"All time" };
}

function inPeriod(b, r){
  const d = new Date(b.date);
  if (r.a && d < r.a) return false;
  if (r.b && d >= r.b) return false;
  return true;
}

export function renderRecords(){
  const r = periodRange();
  const shownBills = S.bills.filter((b) => inPeriod(b, r));
  const counted = live(shownBills);

  const list = $("recList");
  list.innerHTML = "";
  $("recEmpty").hidden = shownBills.length > 0;
  $("recEmpty").textContent = S.bills.length ? "No bills in this period." : "No bills issued yet.";

  shownBills.forEach((b) => {
    const row = document.createElement("div");
    row.className = "rec" + (isVoid(b) ? " void" : "");

    const p = findPatient(b.patientId);
    const main = document.createElement("button");
    main.className = "recmain";
    main.innerHTML = "<span class='rno'>" + esc(b.no) + "</span>"
      + "<span class='rmid'><b>" + esc(b.name || "No name") + (p ? " · " + esc(p.no) : "") + "</b>"
      + "<i>" + fmtDate(b.date) + ", " + fmtTime(b.date)
      + " · " + b.items.length + " item" + (b.items.length === 1 ? "" : "s")
      + (b.discAmt > 0 && !hideAmounts ? " · −" + money(b.discAmt) : "")
      + (b.mode === "backdated" ? " · backdated" : "") + "</i></span>"
      + (isVoid(b) ? "<span class='vtag'>VOID</span>" : "")
      + billTag(b)
      + "<span class='ramt'>" + show(typeof b.balanceDue === "number" ? b.balanceDue : b.total) + "</span>";
    main.addEventListener("click", () => renderSheet(b, false));

    /* a native select gives Android's own picker — one tap, no custom dialog */
    const sel = document.createElement("select");
    sel.className = "pay" + (b.pay ? " set" : "");
    sel.setAttribute("aria-label", "Payment method for bill " + b.no);
    sel.disabled = isVoid(b);
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = "Payment…";
    sel.appendChild(blank);
    PAY_METHODS.forEach((m) => {
      const o = document.createElement("option");
      o.value = m; o.textContent = m;
      sel.appendChild(o);
    });
    sel.value = b.pay || "";
    sel.addEventListener("change", () => {
      b.pay = sel.value;
      sel.classList.toggle("set", !!b.pay);
      saveBill(b);
      toast(b.pay ? "Marked paid by " + b.pay + "." : "Payment method cleared.");
    });

    row.appendChild(main);
    row.appendChild(sel);
    list.appendChild(row);
  });

  /* Sales is cash actually received, so each ringgit is counted once and
     only once: a package sale counts on the day she is paid for it, and a
     bill settled entirely from credit counts nothing. Credit redeemed is
     shown beside it so the two reconcile. */
  $("stSales").textContent  = show(counted.reduce((t,b) => t + cashTaken(b), 0));
  $("stCredit").textContent = show(counted.reduce((t,b) => t + creditUsed(b), 0));
  $("stCount").textContent  = counted.length;
  $("stVoid").textContent   = shownBills.length - counted.length;
  renderUnredeemed();

  paintEye();
  all(".periods button").forEach((btn) => btn.classList.toggle("on", btn.dataset.p === period.kind));
  $("rangeBox").hidden = period.kind !== "custom";
  $("periodNote").textContent = r.label + " · voided bills are excluded from the sales figure.";
  paintBackupNote();
}

/* What she still owes in services. Stated in credit ringgit, not cash —
   it is what customers can still come and spend, which is the figure that
   matters at the counter. */
function renderUnredeemed(){
  const box = $("unredBody");
  if (!box) return;
  const all_ = packages.outstanding();
  const card = $("unredCard");

  if (!all_.length){
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const total = all_.reduce((t,p) => t + packages.remaining(p), 0);
  const soon = packages.expiringSoon(60);

  $("unredTotal").textContent = show(total);
  $("unredNote").textContent = all_.length + " package" + (all_.length === 1 ? "" : "s")
    + " still carrying a balance"
    + (soon.length ? " · " + soon.length + " expiring within 60 days" : "");

  box.innerHTML = "";
  if (soon.length){
    const h = document.createElement("h3");
    h.textContent = "Expiring within 60 days";
    box.appendChild(h);
    const sb = document.createElement("div");
    box.appendChild(sb);
    renderPackageRows(sb, soon, { showOwner:true, mask: hideAmounts });
  }
  const rest = all_.filter((p) => soon.indexOf(p) === -1);
  if (rest.length){
    const h = document.createElement("h3");
    h.textContent = soon.length ? "Everything else" : "All outstanding";
    box.appendChild(h);
    const rb = document.createElement("div");
    box.appendChild(rb);
    renderPackageRows(rb, rest, { showOwner:true, mask: hideAmounts });
  }
}

function paintBackupNote(){
  const n = $("backupNote");
  if (!n) return;
  const d = daysSince(S.settings.lastBackup);
  if (d === Infinity){
    n.textContent = "No backup saved yet.";
    n.className = "note warnish";
  } else if (d === 0){
    n.textContent = "Backed up today.";
    n.className = "note";
  } else {
    n.textContent = "Last backed up " + d + " day" + (d === 1 ? "" : "s") + " ago.";
    n.className = d >= 7 ? "note warnish" : "note";
  }
}

function exportCsv(){
  if (!S.bills.length){ toast("No bills to export yet."); return; }
  const rows = [["bill_no","status","date","time","entry_mode","issued_at","voided_at","void_reason",
                 "customer","patient_no","patient_ic_last4","payment_method","category","item","qty",
                 "unit_price","line_total","line_in_discount","line_subtotal","bill_subtotal",
                 "bill_discount","bill_rounding","bill_total","credit_applied","balance_due"]];
  S.bills.slice().reverse().forEach((b) => {
    const d = new Date(b.date);
    const issued = b.issuedAt ? new Date(b.issuedAt) : d;
    const p = findPatient(b.patientId);
    const last4 = p && p.ic ? String(p.ic).replace(/\D/g,"").slice(-4) : "";
    b.items.forEach((i) => {
      rows.push([b.no,
                 isVoid(b) ? "void" : "issued",
                 localInputValue(d).slice(0,10), csvTime(b.date),
                 b.mode || "real-time",
                 localInputValue(issued).replace("T"," "),
                 b.voidedAt ? localInputValue(new Date(b.voidedAt)).replace("T"," ") : "",
                 b.voidReason || "",
                 b.name, p ? p.no : "", last4, b.pay || "",
                 CATS[i.c] || i.c, i.n, i.q, i.p.toFixed(2), (i.p * i.q).toFixed(2),
                 eligibleForDiscount(i, b.disc) ? "yes" : "no",
                 lineSubtotal(b, i).toFixed(2),
                 b.sub.toFixed(2),
                 (b.discAmt || 0).toFixed(2), (b.roundAdj || 0).toFixed(2), b.total.toFixed(2),
                 (b.creditApplied || 0).toFixed(2),
                 (typeof b.balanceDue === "number" ? b.balanceDue : b.total).toFixed(2)]);
    });
  });
  const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n");
  download("qi-tcm-bills-" + new Date().toISOString().slice(0,10) + ".csv", csv, "text/csv;charset=utf-8");
  toast("CSV downloaded.");
}

async function doBackup(){
  const ok = await saveBackup(buildDump(), S.settings, S.settings.passphrase);
  if (ok){
    S.settings.lastBackup = new Date().toISOString();
    saveSettings();
    paintBackupNote();
  }
}

function askPassphrase(){
  return Promise.resolve(prompt("Backup passphrase:", "") || "");
}

function onRestoreFile(e){
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    e.target.value = "";
    let dump;
    try {
      dump = await readBackupFile(String(r.result || ""), askPassphrase);
    } catch(err){
      if (err && err.message !== "cancelled") toast(err.message || "Couldn't read that backup.");
      return;
    }
    const counts = [
      (dump.bills || []).length + " bills",
      (dump.patients || []).length + " patients",
      (dump.tx || []).length + " price list items"
    ].join(", ");
    if (!confirm("Replace everything currently on this tablet?\n\nThe backup holds " + counts + ".\nSettings and the price list are replaced too.")) return;
    await applyDump(dump);
    emit("restored");
    toast("Backup restored.");
  };
  r.readAsText(f);
}

function paintEye(){
  const b = $("btnEye");
  if (!b) return;
  b.classList.toggle("off", hideAmounts);
  b.setAttribute("aria-pressed", String(!hideAmounts));
  b.setAttribute("aria-label", hideAmounts ? "Show amounts" : "Hide amounts");
  b.innerHTML = hideAmounts ? EYE_OFF : EYE_ON;
}

/* Inline so they work offline with no icon font. */
const EYE_ON = "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z'/><circle cx='12' cy='12' r='3.2'/></svg>";
const EYE_OFF = "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M1.5 12S5 5.5 12 5.5c1.6 0 3 .34 4.2.87M22.5 12s-3.5 6.5-10.5 6.5c-1.7 0-3.2-.38-4.5-.97'/><path d='M9.9 9.9a3.2 3.2 0 0 0 4.3 4.3'/><path d='M3 3l18 18'/></svg>";

/* Re-hides on every entry to the tab, not just the first. */
export function resetAmountVisibility(){
  hideAmounts = true;
}

export function initRecords(){
  $("btnEye").addEventListener("click", () => {
    hideAmounts = !hideAmounts;
    renderRecords();
  });

  all(".periods button").forEach((btn) => {
    btn.addEventListener("click", () => {
      period.kind = btn.dataset.p;
      if (period.kind === "custom" && !period.from){
        const now = new Date();
        period.from = localInputValue(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0,10);
        period.to = localInputValue(now).slice(0,10);
        $("rangeFrom").value = period.from;
        $("rangeTo").value = period.to;
      }
      renderRecords();
    });
  });
  $("rangeFrom").addEventListener("input", (e) => { period.from = e.target.value; renderRecords(); });
  $("rangeTo").addEventListener("input", (e) => { period.to = e.target.value; renderRecords(); });

  $("btnCsv").addEventListener("click", exportCsv);
  $("btnBackup").addEventListener("click", doBackup);
  $("btnRestore").addEventListener("click", () => $("fileIn").click());
  $("fileIn").addEventListener("change", onRestoreFile);
}

on("bills-changed", renderRecords);
on("packages-changed", () => { if (!$("panel-records").hidden) renderRecords(); });
on("open-bill", (b) => renderSheet(b, false));

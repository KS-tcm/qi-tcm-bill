/* The Bill tab: treatment chips, the draft, the patient picker, package
   credit, and issuing.

   The patient picker still accepts a plain typed name and bills it — a
   walk-in should never be blocked on creating a record — but when a patient
   is chosen the bill carries their id, their alerts appear before anything is
   charged, and any package credit they hold becomes available. */

import { $, all, esc, money, fmtDate, fmtTime, localInputValue, uid, toast, emit, on } from "./util.js";
import { S, newDraft, saveBill, saveSettings, sortBills } from "./state.js";
import { totals, eligibleForDiscount, defaultDiscountFlag } from "./money.js";
import { renderSheet, billHtml } from "./sheet.js";
import { searchPatients, findPatient, maskIC, newPatientForm, activePatients } from "./patients.js";
import * as packages from "./packages.js";
import { openQr, qrKeyFor } from "./qr.js";

export function billNo(seq){
  const st = S.settings;
  return (st.prefix ? st.prefix + "-" : "") + new Date().getFullYear() + "-" + String(seq).padStart(4,"0");
}

/* ---------- chips ---------- */
export function renderChips(){
  [["consult","gridConsult"],["treat","gridTreat"],["combo","gridCombo"],["package","gridPackage"]]
  .forEach((pair) => {
    const g = $(pair[1]);
    if (!g) return;
    g.innerHTML = "";
    S.treatments.forEach((t, i) => {
      if (t.c !== pair[0]) return;
      const on_ = S.draft.items.some((it) => it.n === t.n);
      const b = document.createElement("button");
      b.className = "chip"
        + (pair[0] === "combo" ? " combo" : "")
        + (pair[0] === "package" ? " pkg" : "")
        + (on_ ? " on" : "");

      if (t.c === "package"){
        b.innerHTML = "<b>" + esc(t.n) + "</b>"
          + "<i>" + money(t.p) + " → " + money(t.cr) + " credit</i>"
          + "<u>Valid " + (t.mo || 12) + " months</u>";
      } else {
        b.innerHTML = "<b>" + esc(t.n) + "</b><i>" + (t.v ? "price on the day" : money(t.p)) + "</i>"
                    + (t.d ? "<u>" + esc(t.d) + "</u>" : "");
      }
      b.addEventListener("click", () => addItem(i));
      g.appendChild(b);
    });
  });
  const pkgWrap = $("packageSection");
  if (pkgWrap) pkgWrap.hidden = !S.treatments.some((t) => t.c === "package");
}

/* Consultation reads first on a bill, then treatments, combos and any
   package. Sorting the draft itself rather than only the printed copy keeps
   the on-screen list and the bill in the same order. */
const CAT_ORDER = { consult:0, treat:1, combo:2, package:3 };
function sortDraft(){
  S.draft.items.sort((a,b) => (CAT_ORDER[a.c] ?? 9) - (CAT_ORDER[b.c] ?? 9));
}

function addItem(i){
  const t = S.treatments[i];
  const found = S.draft.items.filter((it) => it.n === t.n)[0];
  if (found){ found.q += 1; }
  else {
    const line = {
      n: t.n, p: Number(t.p) || 0, q: 1, c: t.c,
      v: t.v ? 1 : 0, d: t.d || "",
      di: defaultDiscountFlag(t.c)
    };
    if (t.c === "package"){ line.cr = Number(t.cr) || 0; line.mo = Number(t.mo) || 12; }
    S.draft.items.push(line);
  }
  sortDraft();
  renderDraft(); renderChips();
}

function bump(idx, by){
  const it = S.draft.items[idx];
  it.q += by;
  if (it.q < 1) S.draft.items.splice(idx, 1);
  renderDraft(); renderChips();
}

export function renderDraft(){
  const ul = $("draftLines");
  ul.innerHTML = "";
  S.draft.items.forEach((it, idx) => {
    const li = document.createElement("li");

    const nm = document.createElement("div");
    nm.className = "lname";
    const sub = it.c === "package"
      ? money(it.cr) + " credit · " + (it.mo || 12) + " months"
      : (it.v ? (it.d ? esc(it.d) : "price set on the day") : money(it.p) + " each");
    nm.innerHTML = "<b>" + esc(it.n) + "</b><i>" + sub + "</i>";
    li.appendChild(nm);

    const s = document.createElement("div");
    s.className = "lsum";

    if (it.v){
      const pi = document.createElement("input");
      pi.className = "lprice"; pi.type = "number"; pi.min = "0"; pi.step = "0.5";
      pi.inputMode = "decimal"; pi.value = it.p;
      pi.setAttribute("aria-label", "Daily price for " + it.n);
      pi.addEventListener("input", () => {
        it.p = parseFloat(pi.value) || 0;
        s.textContent = money(it.p * it.q);
        updateTotal();
      });
      li.appendChild(pi);
    }

    /* per-line discount toggle — packages are never discountable, so they
       show a dash rather than a control that would do nothing */
    const dsc = document.createElement("button");
    dsc.className = "dtog" + (it.di === 1 ? " on" : "");
    if (it.c === "package"){
      dsc.classList.add("na");
      dsc.textContent = "—";
      dsc.disabled = true;
      dsc.setAttribute("aria-label", "Packages are never discounted");
    } else {
      dsc.textContent = "%";
      dsc.setAttribute("aria-pressed", String(it.di === 1));
      dsc.setAttribute("aria-label", (it.di === 1 ? "Exclude " : "Include ") + it.n + " in the discount");
      dsc.addEventListener("click", () => {
        it.di = it.di === 1 ? 0 : 1;
        renderDraft();
      });
    }
    li.appendChild(dsc);

    const q = document.createElement("div"); q.className = "qty";
    const minus = document.createElement("button"); minus.textContent = "−";
    minus.setAttribute("aria-label", "Reduce " + it.n);
    minus.addEventListener("click", () => bump(idx, -1));
    const cnt = document.createElement("span"); cnt.textContent = it.q;
    const plus = document.createElement("button"); plus.textContent = "+";
    plus.setAttribute("aria-label", "Add " + it.n);
    plus.addEventListener("click", () => bump(idx, 1));
    q.appendChild(minus); q.appendChild(cnt); q.appendChild(plus);
    li.appendChild(q);

    s.textContent = money(it.p * it.q);
    li.appendChild(s);
    ul.appendChild(li);
  });

  const any = S.draft.items.length > 0;
  $("draftEmpty").hidden = any;
  $("btnIssue").disabled = !any;
  $("btnEstimate").disabled = !any;
  updateTotal();
}

export function updateTotal(){
  const d = S.draft;
  const t = totals(d.items, d.disc, d.credit);

  $("draftTotal").textContent = d.items.length ? money(t.balanceDue) : "—";
  $("totalLabel").textContent = t.creditApplied > 0 ? "Balance due" : "Total";

  $("roundNote").textContent = t.roundAdj > 0
    ? "Rounded down from " + money(t.net) + " · " + money(t.roundAdj) + " off"
    : "";

  /* A discount typed against nothing selected takes nothing off. Saying that
     plainly beats showing a row of zeros, which looks like a bug. */
  const chosen = d.items.filter((i) => eligibleForDiscount(i, d.disc));
  const note = $("discNote");
  if (!d.items.length){
    note.textContent = "";
    note.className = "discNote";
  } else if (!chosen.length){
    note.textContent = d.disc.v > 0
      ? "No items selected — this discount takes nothing off."
      : "No items selected for the discount.";
    note.className = d.disc.v > 0 ? "discNote warn" : "discNote";
  } else {
    note.textContent = d.disc.v > 0
      ? "−" + money(t.disc) + " off " + money(t.base) + " across "
        + chosen.length + " item" + (chosen.length === 1 ? "" : "s")
      : money(t.base) + " eligible across " + chosen.length + " item" + (chosen.length === 1 ? "" : "s");
    note.className = "discNote";
  }

  /* credit applied line */
  const row = $("creditRow");
  if (t.creditApplied > 0){
    row.hidden = false;
    $("creditApplied").textContent = "−" + money(t.creditApplied);
  } else {
    row.hidden = true;
  }

  paintCredit();
  paintPayButtons();
}

/* ---------- discount presets ---------- */
function applyPreset(kind){
  S.draft.items.forEach((it) => {
    if (it.c === "package"){ it.di = 0; return; }
    if (kind === "all")   it.di = 1;
    if (kind === "treat") it.di = it.c === "treat" ? 1 : 0;
    if (kind === "tc")    it.di = (it.c === "treat" || it.c === "consult") ? 1 : 0;
    if (kind === "none")  it.di = 0;
  });
  renderDraft();
}

/* ---------- patient picker ---------- */
export function paintPicked(){
  const d = S.draft;
  const p = findPatient(d.patientId);
  const box = $("patPicked");
  const input = $("cName");
  const alert = $("patAlert");

  if (p){
    box.hidden = false;
    input.hidden = true;
    box.innerHTML = "<span class='pmid'><b>" + esc(p.name) + "</b><i>"
      + esc([p.no, p.phone, maskIC(p.ic)].filter(Boolean).join(" · ")) + "</i></span>"
      + "<button id='patClear' aria-label='Clear patient'>×</button>";
    $("patClear").addEventListener("click", clearPatient);
    alert.hidden = !p.alerts;
    if (p.alerts) alert.innerHTML = "<b>Alerts</b>" + esc(p.alerts);
  } else {
    box.hidden = true;
    input.hidden = false;
    alert.hidden = true;
  }
  paintCredit();
}

function clearPatient(){
  S.draft.patientId = null;
  S.draft.name = "";
  S.draft.credit = 0;
  S.draft.creditOwnerId = null;
  $("cName").value = "";
  paintPicked();
  renderDraft();
  $("cName").focus();
}

export function pickPatient(p){
  S.draft.patientId = p.id;
  S.draft.name = p.name;
  S.draft.credit = 0;
  S.draft.creditOwnerId = null;
  $("patPop").hidden = true;
  paintPicked();
  renderDraft();
}

function renderPop(){
  const pop = $("patPop");
  const q = $("cName").value.trim();
  const hits = searchPatients(q).slice(0, 8);

  if (!q && !hits.length){ pop.hidden = true; return; }

  pop.innerHTML = "";
  hits.forEach((p) => {
    const credit = packages.creditAvailable(p.id);
    const b = document.createElement("button");
    b.innerHTML = "<b>" + esc(p.name) + "</b><i>"
      + esc([p.no, p.phone, maskIC(p.ic)].filter(Boolean).join(" · "))
      + (credit > 0 ? " · " + money(credit) + " credit" : "") + "</i>";
    b.addEventListener("mousedown", (e) => { e.preventDefault(); pickPatient(p); });
    pop.appendChild(b);
  });

  if (q){
    const nb = document.createElement("button");
    nb.className = "new";
    nb.innerHTML = "<b>＋ New patient &ldquo;" + esc(q) + "&rdquo;</b><i>Opens the patient form</i>";
    nb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pop.hidden = true;
      emit("go-tab", "patients");
      newPatientForm(q, true);
    });
    pop.appendChild(nb);
  }
  if (!hits.length && !q) pop.innerHTML = "<div class='none'>No patients yet.</div>";
  pop.hidden = false;
}

/* ---------- package credit ---------- */
export function paintCredit(){
  const d = S.draft;
  const box = $("creditBox");
  if (!box) return;

  const ownerId = d.creditOwnerId || d.patientId;
  const owner = findPatient(ownerId);
  const avail = ownerId ? packages.creditAvailable(ownerId) : 0;
  const t = totals(d.items, d.disc, 0);

  /* nothing to offer: no patient, or nobody with credit at all */
  const anyoneHasCredit = S.packages.some((p) => packages.statusOf(p) === "active");
  if ((!d.patientId && !d.creditOwnerId) || (avail <= 0 && !anyoneHasCredit)){
    box.hidden = true;
    return;
  }
  if (avail <= 0 && !d.credit && !anyoneHasCredit){ box.hidden = true; return; }

  box.hidden = false;
  const pkgs = ownerId ? packages.spendable(ownerId) : [];
  const soonest = pkgs[0];
  const borrowed = !!(d.creditOwnerId && d.creditOwnerId !== d.patientId);

  const head = avail > 0
    ? "<b>" + (borrowed && owner ? esc(owner.name) + "'s credit" : "Package credit")
      + " · " + money(avail) + " available</b>"
      + (soonest ? "<i>" + esc(soonest.no) + " · " + packages.describe(soonest) + "</i>" : "")
    : "<b>No credit available" + (owner ? " for " + esc(owner.name) : "") + "</b>"
      + "<i>Another patient's package can still be used.</i>";

  const canUse = avail > 0 && t.creditable > 0 && !d.credit;

  box.innerHTML =
    "<div class='credtop'><span class='credmid'>" + head + "</span>"
    + (canUse ? "<button class='credbtn' id='btnUseCredit'>Use credit</button>" : "")
    + (d.credit > 0 ? "<button class='credbtn off' id='btnDropCredit'>Remove</button>" : "")
    + "</div>"
    + (d.credit > 0
        ? "<p class='credline'>Using " + money(d.credit) + " of credit"
          + (borrowed && owner ? " from " + esc(owner.name) + "'s package" : "") + ".</p>"
        : "")
    + "<button class='credalt' id='btnOtherCredit'>Use someone else's package</button>";

  if ($("btnUseCredit")) $("btnUseCredit").addEventListener("click", useCredit);
  if ($("btnDropCredit")) $("btnDropCredit").addEventListener("click", () => {
    S.draft.credit = 0;
    S.draft.creditOwnerId = null;
    renderDraft();
  });
  $("btnOtherCredit").addEventListener("click", chooseOtherOwner);
}

function useCredit(){
  const d = S.draft;
  const ownerId = d.creditOwnerId || d.patientId;
  const avail = packages.creditAvailable(ownerId);
  const t = totals(d.items, d.disc, 0);
  const take = Math.min(avail, t.creditable);
  if (take <= 0) return;
  d.credit = Math.round(take * 100) / 100;
  renderDraft();
}

/* Credit is transferable between family members, so this asks explicitly
   whose package is about to be spent and confirms by name. */
function chooseOtherOwner(){
  const holders = activePatients()
    .map((p) => ({ p, credit: packages.creditAvailable(p.id) }))
    .filter((h) => h.credit > 0);

  if (!holders.length){ toast("Nobody is holding package credit."); return; }

  const list = holders.map((h, i) => (i + 1) + ". " + h.p.name + " (" + h.p.no + ") — " + money(h.credit)).join("\n");
  const pick = prompt("Whose package should pay for this?\n\n" + list + "\n\nType a number, or Cancel.", "");
  if (pick === null) return;
  const n = parseInt(pick, 10);
  if (!n || n < 1 || n > holders.length){ toast("No one with that number."); return; }

  const chosen = holders[n - 1];
  const t = totals(S.draft.items, S.draft.disc, 0);
  const take = Math.min(chosen.credit, t.creditable);
  if (take <= 0){ toast("Nothing on this bill can be paid with credit."); return; }

  if (!confirm("Take " + money(take) + " from " + chosen.p.name + "'s package (" + chosen.p.no + ")?")) return;
  S.draft.creditOwnerId = chosen.p.id;
  S.draft.credit = Math.round(take * 100) / 100;
  renderDraft();
}

/* ---------- date & time of visit ---------- */
export function setWhenMode(mode){
  S.draft.whenMode = mode;
  all(".when button").forEach((b) => b.classList.toggle("on", b.dataset.when === mode));
  const input = $("whenIn");
  input.hidden = (mode !== "pick");
  if (mode === "pick"){
    if (!input.value) input.value = localInputValue(new Date());
    S.draft.when = input.value;
  } else {
    S.draft.when = null;
  }
  updateWhenNote();
}

function updateWhenNote(){
  const note = $("whenNote");
  const d = S.draft;
  if (d.whenMode === "pick" && d.when){
    const when = new Date(d.when);
    note.textContent = "Recorded as " + fmtDate(when) + " at " + fmtTime(when) + " · marked backdated";
    note.className = "whenNote back";
  } else {
    note.textContent = "Uses the clock when you issue the bill.";
    note.className = "whenNote";
  }
}

/* ---------- payment ---------- */
function paintPayButtons(){
  const t = totals(S.draft.items, S.draft.disc, S.draft.credit);
  const nothingDue = S.draft.items.length > 0 && t.balanceDue <= 0;

  all(".pays button").forEach((b) => b.classList.toggle("on", b.dataset.pay === S.draft.pay));
  $("payField").hidden = nothingDue;
  if (nothingDue && S.draft.pay) S.draft.pay = "";

  const qrBtn = $("btnQr");
  const has = qrKeyFor(S.draft.pay);
  qrBtn.hidden = !has;
  if (has) qrBtn.textContent = "Show " + S.draft.pay + " QR";
}

export function resetDraft(){
  S.draft = newDraft(S.draft);
  $("cName").value = "";
  $("discVal").value = "0";
  $("whenIn").value = "";
  paintPicked();
  setWhenMode("now");
  renderDraft(); renderChips();
}

/* ---------- build + issue ---------- */
export function draftToBill(issued){
  const d = S.draft;
  const t = totals(d.items, d.disc, d.credit);
  const backdated = d.whenMode === "pick" && !!d.when;
  const when = backdated ? new Date(d.when) : new Date();
  return {
    no: issued ? billNo(S.settings.next) : null,
    date: when.toISOString(),
    issuedAt: new Date().toISOString(),
    mode: backdated ? "backdated" : "real-time",
    name: String(d.name || "").trim(),
    patientId: d.patientId || null,
    items: d.items.map((i) => {
      const line = { n:i.n, p:i.p, q:i.q, c:i.c, d:i.d || "", di: i.di === 1 ? 1 : 0 };
      if (i.c === "package"){ line.cr = i.cr; line.mo = i.mo; }
      return line;
    }),
    disc: { m:d.disc.m, v:d.disc.v, s:d.disc.s },
    pay: d.pay || "",
    discAmt: t.disc, sub: t.sub, net: t.net, roundAdj: t.roundAdj, total: t.total,
    creditApplied: t.creditApplied, balanceDue: t.balanceDue,
    creditOwnerId: t.creditApplied > 0 ? (d.creditOwnerId || d.patientId) : null
  };
}

async function issue(){
  const d = S.draft;
  const sellsPackage = d.items.some((i) => i.c === "package");

  if (sellsPackage && !d.patientId){
    toast("A package needs an owner — choose a patient first.");
    return;
  }

  const bill = draftToBill(true);
  bill.id = uid();

  await packages.commitBill(bill, {
    creditAmount: bill.creditApplied,
    creditOwnerId: bill.creditOwnerId
  });

  S.settings.next = Number(S.settings.next) + 1;
  saveSettings();
  sortBills();
  $("sNext").value = S.settings.next;
  renderSheet(bill, true);
  resetDraft();
  emit("bills-changed");
  emit("packages-changed");
}

export function initBilling(){
  $("discVal").addEventListener("input", (e) => {
    S.draft.disc.v = Math.max(0, parseFloat(e.target.value) || 0);
    updateTotal();
  });
  $("discMode").addEventListener("click", () => {
    S.draft.disc.m = S.draft.disc.m === "pct" ? "amt" : "pct";
    $("discMode").textContent = S.draft.disc.m === "pct" ? "%" : "RM";
    updateTotal();
  });
  all(".scope button").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.scope));
  });

  $("cName").addEventListener("input", (e) => {
    S.draft.name = e.target.value;
    S.draft.patientId = null;
    S.draft.credit = 0;
    S.draft.creditOwnerId = null;
    renderPop();
  });
  $("cName").addEventListener("focus", renderPop);
  $("cName").addEventListener("blur", () => {
    setTimeout(() => { $("patPop").hidden = true; }, 120);
  });

  all(".when button").forEach((btn) => {
    btn.addEventListener("click", () => setWhenMode(btn.dataset.when));
  });
  $("whenIn").addEventListener("input", (e) => { S.draft.when = e.target.value; updateWhenNote(); });

  all(".pays button").forEach((btn) => {
    btn.addEventListener("click", () => {
      S.draft.pay = (S.draft.pay === btn.dataset.pay) ? "" : btn.dataset.pay;
      paintPayButtons();
    });
  });
  $("btnQr").addEventListener("click", () => openQr(S.draft.pay, billHtml(draftToBill(false), false)));

  $("btnClear").addEventListener("click", () => {
    if (S.draft.items.length && !confirm("Clear this visit?")) return;
    resetDraft();
  });

  $("btnEstimate").addEventListener("click", () => renderSheet(draftToBill(false), false));
  $("btnIssue").addEventListener("click", () => { issue(); });

  $("discMode").textContent = S.draft.disc.m === "pct" ? "%" : "RM";
  setWhenMode("now");
  paintPicked();
}

/* Opening a patient's "Bill this patient" button lands here. */
on("bill-patient", (p) => {
  S.draft.patientId = p.id;
  S.draft.name = p.name;
  S.draft.credit = 0;
  S.draft.creditOwnerId = null;
  paintPicked();
  renderDraft();
});
on("issue-from-estimate", () => {
  if (!S.draft.items.length) return;
  issue();
});
on("patients-changed", paintPicked);
on("packages-changed", () => { if (!$("panel-bill").hidden) paintCredit(); });

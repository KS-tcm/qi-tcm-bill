/* One-time screen: bills written before v2.0 carry a typed-in name and no
   patient link. This groups them by name and lets her point each group at a
   patient, or create one from it.

   Nothing is forced. A group left alone stays unlinked, and an unlinked bill
   is still a perfectly good bill. */

import { $, esc, emit, toast, fmtDate } from "./util.js";
import { S, saveMeta, savePatient, saveSettings } from "./state.js";
import * as store from "./store.js";
import { activePatients, blankPatient, commitPatient, findPatient } from "./patients.js";

export function unlinkedGroups(){
  const groups = {};
  S.bills.forEach((b) => {
    if (b.patientId) return;
    /* unlinked because the patient was deleted, not because they predate
       patient records — offering to recreate them would undo the delete */
    if (b.patientDeleted) return;
    const key = String(b.name || "").trim();
    if (!key) return;
    (groups[key] = groups[key] || []).push(b);
  });
  return Object.keys(groups)
    .map((name) => ({ name, bills: groups[name] }))
    .sort((a,b) => b.bills.length - a.bills.length);
}

export function shouldOffer(){
  if (S.meta && S.meta.linkDone) return false;
  return unlinkedGroups().length > 0;
}

export function open(){
  const groups = unlinkedGroups();
  const box = $("linkBody");

  box.innerHTML =
    "<div class='card'>"
      + "<h2>Link old bills to patients</h2>"
      + "<p class='note'>These bills were written before patients existed, so they only carry a typed name. "
      + "Point each one at a patient, or make a new patient from it. Anything you skip stays exactly as it is.</p>"
      + "<div id='linkList'></div>"
    + "</div>"
    + "<div class='card'>"
      + "<div class='actions'>"
        + "<button class='btn quiet' id='linkLater'>Not now</button>"
        + "<button class='btn solid' id='linkDone'>Done</button>"
      + "</div>"
      + "<p class='note'>You can come back to this from Setup at any time.</p>"
    + "</div>";

  const list = $("linkList");
  if (!groups.length){
    list.innerHTML = "<div class='empty'>Every bill is linked.</div>";
  }

  groups.forEach((g) => {
    const row = document.createElement("div");
    row.className = "linkrow";
    const span = g.bills.length === 1
      ? fmtDate(g.bills[0].date)
      : g.bills.length + " bills · " + fmtDate(g.bills[g.bills.length - 1].date) + " to " + fmtDate(g.bills[0].date);

    row.innerHTML = "<span class='lmid'><b>" + esc(g.name) + "</b><i>" + span + "</i></span>";

    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "Link " + g.name);
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = "Leave unlinked";
    sel.appendChild(blank);

    const mk = document.createElement("option");
    mk.value = "__new"; mk.textContent = "＋ Create patient";
    sel.appendChild(mk);

    activePatients().forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name + " (" + p.no + ")";
      sel.appendChild(o);
    });

    sel.addEventListener("change", () => {
      if (sel.value === "__new"){
        const p = blankPatient();
        p.name = g.name;
        const saved = commitPatient(p);
        if (!saved){ toast("Couldn't create that patient."); return; }
        link(g, saved.id);
        toast(saved.no + " created from " + g.bills.length + " bill" + (g.bills.length === 1 ? "" : "s") + ".");
        open();
        return;
      }
      if (sel.value){
        link(g, sel.value);
        row.classList.add("done");
        toast("Linked.");
        emit("bills-changed");
      }
    });

    row.appendChild(sel);
    list.appendChild(row);
  });

  $("linkLater").addEventListener("click", () => emit("go-tab", "bill"));
  $("linkDone").addEventListener("click", () => {
    S.meta = S.meta || {};
    S.meta.linkDone = true;
    saveMeta();
    emit("go-tab", "bill");
    toast("Done. You can reopen this from Setup.");
  });
}

function link(group, patientId){
  const p = findPatient(patientId);
  group.bills.forEach((b) => {
    b.patientId = patientId;
    if (p) b.name = p.name;
  });
  store.putMany("bills", group.bills);
  emit("bills-changed");
  emit("patients-changed");
}

/* Patient records.

   The patient form mirrors the fields of the Google Form she already asks new
   patients to fill in — Name, Gender, IC No., Phone No., Address, Email —
   plus two the form has no reason to carry: free-text alerts, and a guardian
   for anyone under 18.

   The form in this app is her data-entry screen; a patient never sees it.
   So it carries no consent wording, only a record of whether consent
   happened and where. */

import { $, all, esc, uid, money, fmtDate, toast, emit, on, parseCsv, download, csvCell, MONTHS as MONTH_NAMES } from "./util.js";
import { S, savePatient, saveSettings } from "./state.js";
import * as store from "./store.js";
import { isVoid } from "./money.js";
import * as packages from "./packages.js";

/* ---------- Malaysian IC ---------- */
/* YYMMDD-PB-###G — the first six digits are the date of birth and the final
   digit carries sex: odd male, even female. Anything that doesn't match the
   pattern (a passport, a foreign ID) is kept verbatim and derives nothing. */
const IC_RE = /^(\d{2})(\d{2})(\d{2})-?(\d{2})-?(\d{3})(\d)$/;

export function parseIC(raw){
  const s = String(raw || "").trim().replace(/\s+/g,"");
  const m = IC_RE.exec(s);
  if (!m) return null;
  const yy = +m[1], mm = +m[2], dd = +m[3];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const nowYY = new Date().getFullYear() % 100;
  const year = yy <= nowYY ? 2000 + yy : 1900 + yy;
  const d = new Date(year, mm - 1, dd);
  if (d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;

  return {
    dob: year + "-" + String(mm).padStart(2,"0") + "-" + String(dd).padStart(2,"0"),
    gender: (+m[6]) % 2 === 1 ? "M" : "F"
  };
}

/* Shown everywhere except the patient's own detail screen. */
export function maskIC(ic){
  const s = String(ic || "").trim();
  if (!s) return "";
  const tail = s.replace(/\D/g,"").slice(-4);
  if (tail.length < 4) return s;
  return "••••••-••-" + tail;
}

export function ageFrom(dob){
  if (!dob) return null;
  const b = new Date(dob + "T00:00");
  if (isNaN(b)) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

export function patientNo(seq){ return "SI-" + String(seq).padStart(4,"0"); }

/* The patient number identifies the patient, so two records can never carry
   the same one. Checked against every record, not just the visible ones. */
export function numberTaken(no, exceptId){
  const want = String(no || "").trim().toUpperCase();
  if (!want) return null;
  return S.patients.filter((o) => o.id !== exceptId && String(o.no).toUpperCase() === want)[0] || null;
}

/* The next number nobody is using. Setup lets her move the counter by hand,
   so it can land on one already issued; this walks past those rather than
   handing out a duplicate. */
export function nextFreeNumber(){
  let seq = Math.max(1, Number(S.settings.patNext || 1));
  let guard = 0;
  while (numberTaken(patientNo(seq)) && guard++ < 100000) seq++;
  return { no: patientNo(seq), seq };
}

export function findPatient(id){
  if (!id) return null;
  return S.patients.filter((p) => p.id === id)[0] || null;
}

export function activePatients(){
  return S.patients.filter((p) => !p.archivedAt);
}

export function searchPatients(q){
  const s = String(q || "").trim().toLowerCase();
  const list = activePatients();
  if (!s) return list.slice().sort(byRecentVisit);
  const digits = s.replace(/\D/g,"");
  return list.filter((p) => {
    if (String(p.name || "").toLowerCase().indexOf(s) !== -1) return true;
    if (digits && String(p.phone || "").replace(/\D/g,"").indexOf(digits) !== -1) return true;
    if (digits && String(p.ic || "").replace(/\D/g,"").indexOf(digits) !== -1) return true;
    return false;
  }).sort(byRecentVisit);
}

export function billsFor(id){
  return S.bills.filter((b) => b.patientId === id);
}

export function visitCount(id){
  return S.bills.filter((b) => b.patientId === id && !isVoid(b)).length;
}

function lastVisit(p){
  const bs = billsFor(p.id);
  return bs.length ? bs[0].date : "";
}
function byRecentVisit(a,b){
  const la = lastVisit(a), lb = lastVisit(b);
  if (la && lb) return String(lb).localeCompare(String(la));
  if (la) return -1;
  if (lb) return 1;
  return String(a.name||"").localeCompare(String(b.name||""));
}

/* ---------- create / update ---------- */
export function blankPatient(){
  return {
    id: null, no: "", name:"", ic:"", phone:"", gender:"", dob:"",
    email:"", address:"", alerts:"",
    guardianName:"", guardianPhone:"",
    consentAt:"", consentSource:"",
    createdAt:"", updatedAt:"", archivedAt:""
  };
}

/* Returns the saved patient, or null when the number it was given is
   already in use — the caller is expected to say so rather than guess. */
export function commitPatient(p){
  const now = new Date().toISOString();
  if (!p.id){
    if (p.no){
      if (numberTaken(p.no)) return null;
      p.no = String(p.no).trim().toUpperCase();
    } else {
      p.no = nextFreeNumber().no;
    }
    p.id = uid();
    p.createdAt = now;
    /* keep the counter ahead of whatever number this record ended up with,
       so an imported list never collides with the next one she creates */
    const seq = parseInt(String(p.no).replace(/\D/g,""), 10);
    S.settings.patNext = Math.max(Number(S.settings.patNext || 1), (seq || 0) + 1);
    saveSettings();
    S.patients.push(p);
  } else if (numberTaken(p.no, p.id)){
    return null;
  }
  p.updatedAt = now;
  savePatient(p);
  emit("patients-changed");
  return p;
}

/* Families share phones and the occasional IC typo happens, so a clash is
   worth naming but never worth blocking. */
export function duplicateWarning(p){
  const digits = (s) => String(s || "").replace(/\D/g,"");
  const hits = [];
  activePatients().forEach((o) => {
    if (o.id === p.id) return;
    if (p.ic && digits(o.ic) && digits(o.ic) === digits(p.ic)) hits.push(o.name + " (" + o.no + ") has this IC number");
    else if (p.phone && digits(o.phone) && digits(o.phone) === digits(p.phone)) hits.push(o.name + " (" + o.no + ") has this phone number");
  });
  return hits.slice(0,2).join(". ");
}

/* ---------- views ---------- */
let view = "list";      /* list | detail | form */
let detailId = null;
let form = null;
let listQuery = "";
let listFilter = "";      /* "" | "credit" */
let listSort = "recent";  /* "recent" | "visits" | "no" | "no-desc" */
let visitMode = "list";   /* "list" | "cal" */

export function showPatients(){
  view = "list"; detailId = null; form = null;
  render();
}
export function openPatient(id){
  view = "detail"; detailId = id;
  render();
}
let returnToBill = false;
export function newPatientForm(prefillName, backToBill){
  form = blankPatient();
  if (prefillName) form.name = prefillName;
  detailId = null;
  returnToBill = !!backToBill;
  view = "form";
  render();
}
function editPatient(id){
  const p = findPatient(id);
  if (!p) return;
  form = Object.assign({}, p);
  view = "form";
  render();
}

export function render(){
  const box = $("patBody");
  if (!box) return;
  if (view === "import") return renderImport(box);
  if (view === "form")   return renderForm(box);
  if (view === "detail") return renderDetail(box);
  return renderList(box);
}

/* ---------- list ---------- */
function renderList(box){
  let list = searchPatients(listQuery);

  /* Clinic-wide figures, which also act as controls: tapping Unredeemed
     credit narrows the list to the people holding it, tapping Visits sorts
     by who comes most. Tapping either again clears it. */
  const everyone = activePatients();
  const totalCredit = everyone.reduce((t,p) => t + packages.creditAvailable(p.id), 0);
  const totalVisits = everyone.reduce((t,p) => t + visitCount(p.id), 0);

  if (listFilter === "credit") list = list.filter((p) => packages.creditAvailable(p.id) > 0);
  if (listSort === "visits"){
    list = list.slice().sort((a,b) => visitCount(b.id) - visitCount(a.id));
  }
  if (listSort === "no" || listSort === "no-desc"){
    list = list.slice().sort((a,b) => String(a.no).localeCompare(String(b.no)));
    if (listSort === "no-desc") list.reverse();
  }

  box.innerHTML =
    "<div class='subnav'>"
      + "<input class='search' id='patSearch' placeholder='Search name, phone or IC' autocomplete='off'>"
      + "<button class='back' id='patNew'>＋ New</button>"
      + "<button class='back' id='patImport'>Import CSV</button>"
      + "<button class='back' id='patTemplate'>CSV template</button>"
    + "</div>"
    + "<div class='pstats three'>"
      + "<button class='pstat" + (listSort.indexOf("no") === 0 ? " on" : "") + "' id='pfPatients'>"
        + "<u>Patients</u><b>" + everyone.length + "</b></button>"
      + "<button class='pstat" + (listFilter === "credit" ? " on" : "") + "' id='pfCredit'>"
        + "<u>Unredeemed credit</u><b>" + money(totalCredit) + "</b></button>"
      + "<button class='pstat" + (listSort === "visits" ? " on" : "") + "' id='pfVisits'>"
        + "<u>Visits</u><b>" + totalVisits + "</b></button>"
    + "</div>"
    + "<div class='card'>"
      + "<h2>Patients" + (list.length ? " · " + list.length : "")
        + (listFilter === "credit" ? " · holding credit" : "")
        + (listSort === "visits" ? " · most visits first" : "")
        + (listSort === "no" ? " · oldest first" : "")
        + (listSort === "no-desc" ? " · newest first" : "") + "</h2>"
      + "<div id='patList'></div>"
      + (list.length ? "" : "<div class='empty'>"
          + (listFilter === "credit" ? "Nobody is holding package credit."
             : everyone.length ? "No one matches that."
             : "No patients yet. Add one, or import your Google Form responses.")
          + "</div>")
    + "</div>"
    + "<input type='file' id='patFile' accept='.csv,text/csv' hidden>";

  const ul = $("patList");
  list.forEach((p) => {
    const bs = billsFor(p.id);
    const last = bs.length ? fmtDate(bs[0].date) : "no visits yet";
    const n = visitCount(p.id);
    const credit = packages.creditAvailable(p.id);
    const b = document.createElement("button");
    b.className = "pitem";
    b.innerHTML = "<span class='pno'>" + esc(p.no) + "</span>"
      + "<span class='pmid'><b>" + esc(p.name || "Unnamed") + "</b>"
      + "<i>" + last + "</i></span>"
      + "<span class='pvis'>" + n + "<u>visit" + (n === 1 ? "" : "s") + "</u></span>"
      + (credit > 0 ? "<span class='pcred'>" + money(credit) + "</span>" : "")
      + (p.alerts ? "<span class='palert' title='Has alerts'>!</span>" : "");
    b.addEventListener("click", () => openPatient(p.id));
    ul.appendChild(b);
  });

  const s = $("patSearch");
  s.value = listQuery;
  s.addEventListener("input", (e) => {
    listQuery = e.target.value;
    renderList(box);
    const again = $("patSearch");
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  });
  $("pfCredit").addEventListener("click", () => {
    listFilter = listFilter === "credit" ? "" : "credit";
    renderList(box);
  });
  $("pfVisits").addEventListener("click", () => {
    listSort = listSort === "visits" ? "recent" : "visits";
    renderList(box);
  });
  $("pfPatients").addEventListener("click", () => {
    listSort = listSort === "no" ? "no-desc" : listSort === "no-desc" ? "recent" : "no";
    renderList(box);
  });
  $("patNew").addEventListener("click", () => newPatientForm(""));
  $("patImport").addEventListener("click", () => $("patFile").click());
  $("patTemplate").addEventListener("click", downloadTemplate);
  $("patFile").addEventListener("change", onImportFile);
}

/* ---------- detail ---------- */
function renderDetail(box){
  const p = findPatient(detailId);
  if (!p) return showPatients();

  const bs = billsFor(p.id);
  const livebs = bs.filter((b) => !isVoid(b));
  const spend = livebs.reduce((t,b) => t + (b.total || 0), 0);
  const age = ageFrom(p.dob);
  const credit = packages.creditAvailable(p.id);
  const pkgs = packages.packagesFor(p.id);

  const meta = [
    p.no,
    age == null ? "" : age,
    p.gender === "M" ? "M" : p.gender === "F" ? "F" : "",
    p.phone
  ].filter(Boolean).join(" · ");

  box.innerHTML =
    "<div class='subnav'><button class='back' id='patBack'>← Patients</button></div>"
    + "<div class='card'>"
      + "<div class='phead'>"
        + "<h1>" + esc(p.name || "Unnamed") + "</h1>"
        + "<p class='pmeta'>" + esc(meta) + "</p>"
        + (p.ic ? "<p class='pic'>" + esc(p.ic) + "</p>" : "")
      + "</div>"
      + (p.alerts ? "<div class='alertbar'><b>Alerts</b>" + esc(p.alerts) + "</div>" : "")
      + (p.guardianName ? "<p class='note'>Guardian: " + esc(p.guardianName)
          + (p.guardianPhone ? " · " + esc(p.guardianPhone) : "") + "</p>" : "")
      + "<div class='stats' style='margin-top:14px'>"
        + "<div class='stat'><u>Visits</u><b>" + livebs.length + "</b></div>"
        + "<div class='stat'><u>Total spend</u><b>" + money(spend) + "</b></div>"
        + "<div class='stat" + (credit > 0 ? " good" : "") + "'><u>Credit left</u><b>" + money(credit) + "</b></div>"
      + "</div>"
      + "<p class='note'>" + consentLine(p) + "</p>"
      + "<div class='actions'>"
        + "<button class='btn' id='patEdit'>Edit</button>"
        + "<button class='btn danger' id='patDelete'>Delete</button>"
      + "</div>"
    + "</div>"
    + (pkgs.length ? "<div class='card'><h2>Packages</h2><div id='patPkgs'></div></div>" : "")
    + "<div class='card'>"
      + "<div class='vhead'>"
        + "<h2>Visit history</h2>"
        + "<div class='vmode' role='group' aria-label='How to show visits'>"
          + "<button data-vm='list'" + (visitMode === "list" ? " class='on'" : "") + ">List</button>"
          + "<button data-vm='cal'" + (visitMode === "cal" ? " class='on'" : "") + ">Calendar</button>"
        + "</div>"
      + "</div>"
      + (bs.length
          ? (visitMode === "cal" ? "<div id='patCal'></div>" : "<ul class='vhist' id='patVisits'></ul>")
          : "<div class='empty'>No bills linked yet.</div>")
    + "</div>";

  if (pkgs.length) renderPackageRows($("patPkgs"), pkgs);

  all(".vmode button").forEach((btn) => {
    btn.addEventListener("click", () => { visitMode = btn.dataset.vm; render(); });
  });

  if (bs.length && visitMode === "cal") renderCalendar($("patCal"), bs);

  if (bs.length && visitMode === "list"){
    const ul = $("patVisits");
    bs.forEach((b) => {
      const li = document.createElement("li");
      li.className = isVoid(b) ? "void" : "";
      const names = b.items.map((i) => i.n).join(", ");
      /* a fully-redeemed bill shows "credit", never a bare RM 0.00 — a zero
         there reads like a mistake rather than a thing that happened */
      let amt;
      if (isVoid(b)) amt = "void";
      else if ((b.creditApplied || 0) > 0 && (b.balanceDue || 0) <= 0) amt = money(b.creditApplied);
      else if ((b.creditApplied || 0) > 0) amt = money(b.balanceDue);
      else amt = money(b.total);
      li.innerHTML = "<span class='vdate'>" + fmtDate(b.date)
          + (b.no ? "<em class='vno'>" + esc(b.no) + "</em>" : "") + "</span>"
        + "<span class='vitems'>" + esc(names || "—") + "</span>"
        + billTag(b)
        + "<span class='vamt'>" + amt + "</span>";
      li.addEventListener("click", () => emit("open-bill", b));
      ul.appendChild(li);
    });
  }

  $("patBack").addEventListener("click", showPatients);
  $("patEdit").addEventListener("click", () => editPatient(p.id));
  $("patDelete").addEventListener("click", () => deletePatient(p));
}

/* Bills carry their own snapshot of the name, so a deleted patient leaves
   the money record intact and readable — the bills simply stop pointing at
   anybody. Unspent package credit is the one thing that blocks: deleting
   then would erase the record of services she has already been paid for. */
async function deletePatient(p){
  const bs = billsFor(p.id);
  const held = packages.packagesFor(p.id).filter((k) => packages.statusOf(k) !== "void");
  const owing = held.reduce((t,k) => t + packages.remaining(k), 0);

  if (owing > 0){
    alert("This patient can't be deleted.\n\n"
      + (p.name || "They") + " still holds " + money(owing) + " of package credit ("
      + held.map((k) => k.no).join(", ") + "). Deleting the record now would erase "
      + "what you owe them. Let the credit be spent, or void the package first.");
    return;
  }

  const warn = bs.length
    ? "\n\n" + bs.length + " bill" + (bs.length === 1 ? "" : "s")
      + " stay in your records, still showing \u201c" + (p.name || "no name")
      + "\u201d, but with no patient number and no record behind the name."
    : "";
  if (!confirm("Delete " + (p.name || "this patient") + " (" + p.no + ")?" + warn
      + "\n\nThis cannot be undone.")) return;
  if (bs.length && !confirm("Really delete? Their visit history will no longer be reachable from the patient list.")) return;

  /* The bill keeps the name it was issued under — only the link to a patient
     record goes. The flag stops the link-old-bills screen from turning round
     and offering to recreate the patient she has just deleted. */
  bs.forEach((b) => {
    b.patientId = null;
    b.patientDeleted = true;
  });
  if (bs.length) await store.putMany("bills", bs);

  S.patients = S.patients.filter((x) => x.id !== p.id);
  await store.remove("patients", p.id);
  if (store.backend !== "idb") await store.replaceAll("patients", S.patients);

  emit("patients-changed");
  emit("bills-changed");
  toast(p.no + " deleted.");
  showPatients();
}

/* A bill that SOLD a package is tagged Package; one paid from existing
   credit is tagged Credit. Two different events, two different words. */
export function billTag(b){
  if (isVoid(b)) return "";
  if ((b.items || []).some((i) => i.c === "package")) return "<span class='pkgtag'>Package</span>";
  if ((b.creditApplied || 0) > 0) return "<span class='credtag'>Credit</span>";
  return "";
}

function consentLine(p){
  if (!p.consentAt) return "No consent recorded for this patient.";
  const where = p.consentSource === "form" ? "intake form" : "recorded in person";
  return "Consent " + where + " · " + fmtDate(p.consentAt);
}

/* ---------- calendar view ---------- */
/* A month at a time, a dot per visit. The cells are too narrow on a phone to
   carry treatment names, so the month's visits are listed underneath and a
   tapped day scrolls to its own row rather than trying to squeeze the text
   into a 40px box. */
let calMonth = null;   /* Date set to the 1st of the month on show */

function monthKey(d){ return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2,"0"); }

function renderCalendar(box, bills){
  if (!calMonth){
    calMonth = bills.length ? new Date(bills[0].date) : new Date();
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
  }

  const byDay = {};
  bills.forEach((b) => {
    const d = new Date(b.date);
    if (d.getFullYear() !== calMonth.getFullYear() || d.getMonth() !== calMonth.getMonth()) return;
    (byDay[d.getDate()] = byDay[d.getDate()] || []).push(b);
  });

  const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;            /* weeks run Monday first */
  const days = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear() === calMonth.getFullYear()
                   && today.getMonth() === calMonth.getMonth();

  let cells = "";
  for (let i = 0; i < lead; i++) cells += "<div class='cday out'></div>";
  for (let d = 1; d <= days; d++){
    const hits = byDay[d] || [];
    const live = hits.filter((b) => !isVoid(b));
    cells += "<div class='cday" + (hits.length ? " has" : "")
      + (isThisMonth && today.getDate() === d ? " today" : "") + "'"
      + (hits.length ? " data-day='" + d + "' role='button' tabindex='0'" : "") + ">"
      + "<span class='cnum'>" + d + "</span>"
      + (hits.length ? "<span class='cdots'>"
          + live.map(() => "<i></i>").join("")
          + hits.filter((b) => isVoid(b)).map(() => "<i class='v'></i>").join("")
          + "</span>" : "")
      + "</div>";
  }

  const monthVisits = Object.keys(byDay)
    .map(Number).sort((a,b) => a - b)
    .map((d) => ({ d, list: byDay[d] }));

  box.innerHTML =
    "<div class='calbar'>"
      + "<button id='calPrev' aria-label='Previous month'>‹</button>"
      + "<b>" + MONTH_NAMES[calMonth.getMonth()] + " " + calMonth.getFullYear() + "</b>"
      + "<button id='calNext' aria-label='Next month'>›</button>"
    + "</div>"
    + "<div class='calhead'>" + ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
        .map((x) => "<span>" + x + "</span>").join("") + "</div>"
    + "<div class='calgrid'>" + cells + "</div>"
    + (monthVisits.length
        ? "<ul class='vhist callist' id='calList'></ul>"
        : "<div class='empty'>No visits this month.</div>");

  if (monthVisits.length){
    const ul = $("calList");
    monthVisits.forEach(({ d, list }) => {
      list.forEach((b) => {
        const li = document.createElement("li");
        li.className = isVoid(b) ? "void" : "";
        li.id = "cal-day-" + d;
        const names = b.items.map((i) => i.n).join(", ");
        li.innerHTML = "<span class='vdate'>" + d + " " + MONTH_NAMES[calMonth.getMonth()]
            + (b.no ? "<em class='vno'>" + esc(b.no) + "</em>" : "") + "</span>"
          + "<span class='vitems'>" + esc(names || "—") + "</span>"
          + billTag(b)
          + "<span class='vamt'>" + (isVoid(b) ? "void"
              : money(typeof b.balanceDue === "number" ? b.balanceDue : b.total)) + "</span>";
        li.addEventListener("click", () => emit("open-bill", b));
        ul.appendChild(li);
      });
    });
  }

  $("calPrev").addEventListener("click", () => {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
    render();
  });
  $("calNext").addEventListener("click", () => {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
    render();
  });
  all("#patCal .cday[data-day]").forEach((cell) => {
    const go = () => {
      const row = $("cal-day-" + cell.dataset.day);
      if (!row) return;
      all("#calList li").forEach((li) => li.classList.remove("lit"));
      row.classList.add("lit");
      if (row.scrollIntoView) row.scrollIntoView({ block:"nearest" });
    };
    cell.addEventListener("click", go);
    cell.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); go(); } });
  });
}

/* ---------- form ---------- */
function renderForm(box){
  const p = form;
  const isNew = !p.id;
  const age = ageFrom(p.dob);
  const minor = age != null && age < 18;

  box.innerHTML =
    "<div class='subnav'><button class='back' id='patCancel'>← Cancel</button></div>"
    + "<div class='card'>"
      + "<h2>" + (isNew ? "New patient" : "Edit " + esc(p.name || "patient")) + "</h2>"
      + field("fName", "Name <span class='req'>*</span>", p.name)
      + field("fIc", "IC No. <span class='req'>*</span>", p.ic, "e.g. 790214-10-5128")
      + field("fPhone", "Phone No. <span class='req'>*</span>", p.phone, "", "tel")
      + "<div class='row2'>"
        + field("fDob", "Date of birth", p.dob, "", "date")
        + "<div class='field'><span>Gender</span>"
          + "<div class='selsplit' id='fGender'>"
            + "<button data-g='F'" + (p.gender === "F" ? " class='on'" : "") + ">Female</button>"
            + "<button data-g='M'" + (p.gender === "M" ? " class='on'" : "") + ">Male</button>"
          + "</div></div>"
      + "</div>"
      + "<p class='note' id='fIcNote'></p>"
      + field("fAddress", "Address", p.address)
      + field("fEmail", "Email", p.email, "", "email")
    + "</div>"
    + "<div class='card'>"
      + "<h2>Alerts</h2>"
      + "<label class='field'><span>Anything to watch before treating</span>"
        + "<textarea id='fAlerts' placeholder='e.g. On warfarin. Avoid cupping over lower back.'>" + esc(p.alerts) + "</textarea>"
        + "<span class='hint'>Shown in red on this patient's screen and on the Bill tab whenever they're selected.</span>"
      + "</label>"
    + "</div>"
    + "<div class='card' id='fGuardBox'" + (minor ? "" : " hidden") + ">"
      + "<h2>Guardian</h2>"
      + "<div class='row2'>"
        + field("fGName", "Guardian name", p.guardianName)
        + field("fGPhone", "Guardian phone", p.guardianPhone, "", "tel")
      + "</div>"
      + "<p class='note'>Shown because this patient is under 18.</p>"
    + "</div>"
    + "<div class='card'>"
      + "<h2>Consent</h2>"
      + "<label class='field' style='display:flex;align-items:center;gap:10px'>"
        + "<input type='checkbox' id='fConsent' style='width:22px;height:22px;flex:none'"
        + (p.consentAt ? " checked" : "") + ">"
        + "<span style='margin:0'>Consent given" + (p.consentSource === "form" ? " — intake form" : "") + "</span>"
      + "</label>"
      + "<p class='note'>Tick this when the patient has agreed to you keeping their details. Imported patients carry the date from the form.</p>"
    + "</div>"
    + "<div class='card'>"
      + "<p class='warn' id='fDup' hidden></p>"
      + "<div class='actions'><button class='btn solid wide' id='fSave'>Save patient</button></div>"
    + "</div>";

  const g = (id) => $(id);
  const bind = (id, key) => g(id).addEventListener("input", (e) => { p[key] = e.target.value; });

  bind("fName","name"); bind("fPhone","phone"); bind("fAddress","address");
  bind("fEmail","email"); bind("fGName","guardianName"); bind("fGPhone","guardianPhone");
  g("fAlerts").addEventListener("input", (e) => { p.alerts = e.target.value; });

  g("fIc").addEventListener("input", (e) => { p.ic = e.target.value; });
  g("fIc").addEventListener("blur", () => {
    const got = parseIC(p.ic);
    const note = $("fIcNote");
    if (got){
      p.dob = got.dob;
      if (!p.gender) p.gender = got.gender;
      g("fDob").value = p.dob;
      paintGender();
      note.textContent = "Date of birth and gender filled in from the IC number. Change either if it's wrong.";
      $("fGuardBox").hidden = !(ageFrom(p.dob) != null && ageFrom(p.dob) < 18);
    } else if (p.ic){
      note.textContent = "Not a Malaysian IC format — saved as typed, nothing filled in.";
    } else {
      note.textContent = "";
    }
  });

  g("fDob").addEventListener("input", (e) => {
    p.dob = e.target.value;
    const a = ageFrom(p.dob);
    $("fGuardBox").hidden = !(a != null && a < 18);
  });

  function paintGender(){
    Array.prototype.forEach.call($("fGender").children, (b) => {
      b.classList.toggle("on", b.dataset.g === p.gender);
    });
  }
  Array.prototype.forEach.call(g("fGender").children, (b) => {
    b.addEventListener("click", () => {
      p.gender = (p.gender === b.dataset.g) ? "" : b.dataset.g;
      paintGender();
    });
  });

  g("fConsent").addEventListener("change", (e) => {
    if (e.target.checked){
      if (!p.consentAt){
        p.consentAt = new Date().toISOString();
        p.consentSource = "verbal";
      }
    } else {
      p.consentAt = ""; p.consentSource = "";
    }
  });

  g("patCancel").addEventListener("click", () => {
    if (detailId) openPatient(detailId); else showPatients();
  });

  g("fSave").addEventListener("click", () => {
    p.name = String(p.name || "").trim();
    if (!p.name){ toast("A name is needed."); g("fName").focus(); return; }

    const dup = duplicateWarning(p);
    const warnBox = $("fDup");
    if (dup && warnBox.hidden){
      warnBox.textContent = dup + ". Tap save again to keep both.";
      warnBox.hidden = false;
      return;
    }

    const saved = commitPatient(p);
    if (!saved){
      toast("Patient number " + p.no + " already belongs to someone else.");
      return;
    }
    toast(saved.no + " saved.");
    if (returnToBill){
      returnToBill = false;
      emit("bill-patient", saved);
      emit("go-tab", "bill");
      showPatients();
      return;
    }
    detailId = saved.id;
    openPatient(saved.id);
  });
}

function field(id, label, value, placeholder, type){
  return "<label class='field'><span>" + label + "</span>"
    + "<input id='" + id + "' type='" + (type || "text") + "'"
    + " value='" + esc(value || "") + "'"
    + (placeholder ? " placeholder='" + esc(placeholder) + "'" : "")
    + " autocomplete='off'></label>";
}

/* Shared by the patient screen and the Records unredeemed list. */
export function renderPackageRows(box, pkgs, opts){
  const o = opts || {};
  const amt = (v) => o.mask ? "[RM ****]" : money(v);
  box.innerHTML = "";
  pkgs.forEach((pkg) => {
    const st = packages.statusOf(pkg);
    const left = packages.remaining(pkg);
    const row = document.createElement("div");
    row.className = "pkgrow " + st;

    const who = o.showOwner ? (findPatient(pkg.patientId) || {}) : null;
    row.innerHTML =
      "<span class='pkmid'><b>" + esc(pkg.no)
        + (who ? " · " + esc(who.name || "—") : "")
        + "</b><i>"
        + "paid " + amt(pkg.paid) + ", credit " + amt(pkg.credit)
        + " · " + esc(packages.describe(pkg))
        + (pkg.used > 0 ? " · used " + amt(pkg.used) : "")
        + (pkg.extensions && pkg.extensions.length ? " · extended" : "")
        + "</i></span>"
      + "<span class='pkamt'>" + amt(left) + "</span>";

    /* Expired credit is never taken away quietly — it stops being spendable
       and she can give it more time, with a dated record of having done so. */
    if (st === "expired" && left > 0){
      const ext = document.createElement("button");
      ext.className = "pkbtn";
      ext.textContent = "Extend";
      ext.addEventListener("click", async () => {
        const months = prompt("Extend " + pkg.no + " by how many months?", "3");
        if (months === null) return;
        const n = parseInt(months, 10);
        if (!n || n < 1){ toast("Enter a number of months."); return; }
        const why = prompt("Note (optional) — why is it being extended?", "");
        if (why === null) return;
        await packages.extend(pkg, n, why);
        toast(pkg.no + " extended to " + fmtDate(pkg.expiresAt) + ".");
        emit("packages-changed");
        render();
      });
      row.appendChild(ext);
    }
    box.appendChild(row);
  });
}

/* The exact shape the importer expects, so she can see it rather than
   guess at it. Matches the Google Form's own column names. */
function downloadTemplate(){
  const rows = [
    CSV_HEADER,
    ["SI-0001","2026-09-01 10:00:00","Siti Rahman","Female","880315-10-5513","013-222 3344",
     "12 Jalan Satu, Ipoh","siti@example.com","Pregnant — no lower back points.","",""],
    ["","2026-09-02 14:30:00","Tan Wei Kit","Male","790214-10-5128","012-345 6789","","","","",""]
  ];
  const csv = "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\n");
  download("qi-tcm-patient-template.csv", csv, "text/csv;charset=utf-8");
  toast("Template downloaded. Only Name is required.");
}

/* ---------- CSV import ---------- */
/* Her Google Form writes a response sheet with these columns. Matching is
   loose on case and punctuation so a renamed header still lands. */
/* One column set shared by the template, the export and the importer, so a
   list can leave the app and come back without losing anything. The leftmost
   column is the patient number: supply it and the patient keeps that number
   on import, which is what makes continuing a half-finished list possible.
   Her Google Form's own headers are still recognised. */
const COLS = [
  { key:"no",      names:["patient no","patient number","no","id"] },
  { key:"stamp",   names:["timestamp","submitted at","consent at","date"] },
  { key:"name",    names:["name","full name","patient name"] },
  { key:"gender",  names:["gender","sex"] },
  { key:"ic",      names:["ic no","ic number","ic","nric","mykad"] },
  { key:"phone",   names:["phone no","phone number","phone","contact","mobile"] },
  { key:"address", names:["address"] },
  { key:"email",   names:["email","email address","e-mail"] },
  { key:"alerts",  names:["alerts","notes","warnings"] },
  { key:"gname",   names:["guardian name"] },
  { key:"gphone",  names:["guardian phone"] }
];

const CSV_HEADER = ["Patient No.","Timestamp","Name","Gender","IC No.","Phone No.",
                    "Address","Email","Alerts","Guardian Name","Guardian Phone"];

function normHeader(h){
  return String(h || "").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
}

export function mapCsv(rows){
  if (!rows.length) return { map:{}, rows:[] };
  const head = rows[0].map(normHeader);
  const map = {};
  COLS.forEach((c) => {
    head.forEach((h, i) => {
      if (map[c.key] != null) return;
      if (c.names.indexOf(h) !== -1) map[c.key] = i;
    });
  });
  return { map, rows: rows.slice(1) };
}

function onImportFile(e){
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    e.target.value = "";
    let text = String(r.result || "");

    let rows;
    try { rows = parseCsv(text); }
    catch(err){ toast("Couldn't read that file."); return; }
    startImport(rows);
  };
  r.readAsText(f);
}

function startImport(rows){
  const { map, rows: body } = mapCsv(rows);
  if (map.name == null){
    toast("No Name column found in that file.");
    return;
  }
  const digits = (s) => String(s || "").replace(/\D/g,"");
  const pick = (r, k) => map[k] == null ? "" : String(r[map[k]] || "").trim();

  /* Numbers already issued, plus the ones claimed earlier in this same file
     — a list can contradict itself as easily as it can contradict the app. */
  const seenInFile = {};

  pending = body.map((r) => {
    const rec = blankPatient();
    rec.name    = pick(r,"name");
    rec.ic      = pick(r,"ic");
    rec.phone   = pick(r,"phone");
    rec.address = pick(r,"address");
    rec.email   = pick(r,"email");
    rec.alerts  = pick(r,"alerts");
    rec.guardianName  = pick(r,"gname");
    rec.guardianPhone = pick(r,"gphone");

    /* a supplied number is kept, which is what lets a half-finished list be
       imported and carried on from */
    const wantNo = pick(r,"no").trim().toUpperCase();
    rec.no = wantNo || "";

    const gRaw = pick(r,"gender").toLowerCase();
    if (gRaw.indexOf("f") === 0 || gRaw.indexOf("perempuan") === 0) rec.gender = "F";
    else if (gRaw.indexOf("m") === 0 || gRaw.indexOf("lelaki") === 0) rec.gender = "M";

    const got = parseIC(rec.ic);
    if (got){ rec.dob = got.dob; if (!rec.gender) rec.gender = got.gender; }

    const stamp = pick(r,"stamp");
    const when = stamp ? new Date(stamp) : null;
    rec.consentAt = (when && !isNaN(when)) ? when.toISOString() : new Date().toISOString();
    rec.consentSource = "form";

    const clash = activePatients().filter((o) =>
      (rec.ic && digits(o.ic) && digits(o.ic) === digits(rec.ic)) ||
      (rec.phone && digits(o.phone) && digits(o.phone) === digits(rec.phone))
    )[0];
    const held = rec.no ? numberTaken(rec.no) : null;
    const dupInFile = rec.no && seenInFile[rec.no];
    if (rec.no) seenInFile[rec.no] = true;

    let why = "";
    if (held) why = "number " + rec.no + " already belongs to " + held.name;
    else if (dupInFile) why = "number " + rec.no + " appears twice in this file";
    else if (clash) why = clash.name + " (" + clash.no + ")";

    return { rec, clash: why, skip: !!why || !rec.name };
  });

  view = "import";
  render();
}

let pending = [];

function renderImport(box){
  const willAdd = pending.filter((r) => !r.skip).length;

  box.innerHTML =
    "<div class='subnav'><button class='back' id='impCancel'>← Cancel</button></div>"
    + "<div class='card'>"
      + "<h2>Import preview</h2>"
      + "<p class='note'>" + pending.length + " row" + (pending.length === 1 ? "" : "s")
        + " found. Rows that already match someone are unticked. Consent is taken from the form's timestamp.</p>"
      + "<div id='impList'></div>"
    + "</div>"
    + "<div class='card'>"
      + "<div class='actions'><button class='btn solid wide' id='impGo'>Add " + willAdd
      + " patient" + (willAdd === 1 ? "" : "s") + "</button></div>"
    + "</div>";

  const list = $("impList");
  pending.forEach((row, i) => {
    const div = document.createElement("label");
    div.className = "linkrow" + (row.skip ? "" : " done");
    div.innerHTML =
      "<input type='checkbox' style='width:22px;height:22px;flex:none'" + (row.skip ? "" : " checked") + ">"
      + "<span class='lmid'><b>" + esc(row.rec.name || "(no name)") + "</b><i>"
      + esc([maskIC(row.rec.ic), row.rec.phone].filter(Boolean).join(" · ") || "no details")
      + (row.clash ? " · already matches " + esc(row.clash) : "") + "</i></span>";
    div.querySelector("input").addEventListener("change", (e) => {
      pending[i].skip = !e.target.checked;
      renderImport(box);
    });
    list.appendChild(div);
  });

  $("impCancel").addEventListener("click", () => { pending = []; showPatients(); });
  $("impGo").addEventListener("click", () => {
    let n = 0, refused = 0;
    pending.forEach((row) => {
      if (row.skip || !row.rec.name) return;
      /* a last check at the moment of writing: rows earlier in this same run
         may have taken the number since the preview was drawn */
      if (commitPatient(row.rec)) n++;
      else refused++;
    });
    pending = [];
    toast(n + " patient" + (n === 1 ? "" : "s") + " imported"
      + (refused ? ", " + refused + " skipped for a repeated number" : "") + ".");
    showPatients();
  });
}

on("patients-changed", () => { if (view === "list") render(); });
on("packages-changed", () => { if (view === "detail" || view === "list") render(); });

/* Small shared helpers. No imports — everything else may depend on this. */

export const APP_VERSION = "2.0.1";
export const LOGO_SRC = "./logo.png";

export const LOGO = new Image();
LOGO.src = LOGO_SRC;

export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const CATS = { consult:"Consultation", treat:"Treatments", combo:"Combos", package:"Package" };
export const PAY_METHODS = ["Cash", "TnG", "DuitNow QR"];

export function $(id){ return document.getElementById(id); }
export function all(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }

export function money(n){ return "RM " + (Math.round(n*100)/100).toFixed(2); }

export function fmtDate(iso){
  const d = new Date(iso);
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}
export function fmtTime(iso){
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? "am" : "pm";
  h = h % 12; if (h === 0) h = 12;
  return h + ":" + String(m).padStart(2,"0") + " " + ap;
}
export function csvTime(iso){
  const d = new Date(iso);
  return String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
}

/* value for a datetime-local input, in the tablet's own timezone */
export function localInputValue(d){
  const p = (n) => String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
}

export function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}

let toastTimer = null;
export function toast(m){
  const t = $("toast");
  t.textContent = m;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

export function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
export function startOfWeek(d){            /* weeks run Monday to Sunday */
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

export function download(name, blobOrText, type){
  const blob = (blobOrText instanceof Blob) ? blobOrText : new Blob([blobOrText], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function csvCell(v){
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}

/* Splits a CSV file into rows, honouring quoted fields and embedded newlines. */
export function parseCsv(text){
  const rows = [];
  let row = [], cell = "", q = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++){
    const ch = src[i];
    if (q){
      if (ch === '"'){
        if (src[i+1] === '"'){ cell += '"'; i++; }
        else q = false;
      } else cell += ch;
    } else if (ch === '"'){ q = true; }
    else if (ch === ","){ row.push(cell); cell = ""; }
    else if (ch === "\n"){ row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

export function uid(){
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,9);
}

/* A tiny event bus. Modules announce changes rather than importing each other,
   which is what keeps the module graph free of cycles. */
const handlers = {};
export function on(name, fn){ (handlers[name] = handlers[name] || []).push(fn); }
export function emit(name, payload){ (handlers[name] || []).forEach((fn) => fn(payload)); }

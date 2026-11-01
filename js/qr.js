/* The payment QR overlay.

   Lives in its own module because both the Bill tab and the issued-bill
   screen open it, and billing.js already imports sheet.js — putting it in
   either of those would make the two import each other. */

import { $, all, esc } from "./util.js";
import { S } from "./state.js";

export const QR_METHODS = [
  { pay:"TnG",         key:"tng",     label:"TnG" },
  { pay:"DuitNow",     key:"duitnow", label:"DuitNow" }
];

export function qrKeyFor(method){
  const hit = QR_METHODS.filter((m) => m.pay === method)[0];
  return hit ? hit.key : "";
}

/* Uploaded in Setup wins; otherwise the app looks for a file shipped beside
   index.html, so the images can live in the repo instead if you prefer. */
export function qrSrc(method){
  const key = qrKeyFor(method);
  if (!key) return "";
  if (S.qr && S.qr[key]) return S.qr[key];
  return "./qr-" + key + ".png";
}

/* An uploaded image is known to exist. A repo file might not, so it is only
   assumed when nothing has been uploaded at all — the overlay says plainly
   when the picture fails to load. */
export function hasUploaded(method){
  const key = qrKeyFor(method);
  return !!(key && S.qr && S.qr[key]);
}
export function anyQrConfigured(){
  return QR_METHODS.some((m) => hasUploaded(m.pay));
}

let current = "";
let sideBill = "";

/* `bill` is pre-rendered HTML rather than a bill object: sheet.js already
   knows how to draw one, and taking the string keeps this module from
   importing it — sheet.js imports this one. */
export function openQr(method, bill){
  current = method || QR_METHODS[0].pay;
  sideBill = bill || "";
  paint();
  $("qrWrap").hidden = false;
  document.body.classList.add("locked");
}

export function closeQr(){
  $("qrWrap").hidden = true;
  document.body.classList.remove("locked");
}

function paint(){
  const src = qrSrc(current);

  /* The customer is looking at a QR and needs to know what to key in, so the
     bill sits beside it rather than being dismissed to get here. */
  const side = $("qrBill");
  side.innerHTML = sideBill;
  side.hidden = !sideBill;
  $("qrInner").classList.toggle("split", !!sideBill);

  $("qrTitle").textContent = current;
  $("qrMiss").hidden = true;
  $("qrImg").hidden = false;
  $("qrImg").src = src;

  /* Only offer the switch when the other one is actually set up — a button
     that leads to a missing picture is worse than no button. */
  const others = QR_METHODS.filter((m) => m.pay !== current && hasUploaded(m.pay));
  const sw = $("qrSwitch");
  sw.innerHTML = "";
  sw.hidden = !others.length;
  others.forEach((m) => {
    const b = document.createElement("button");
    b.textContent = "Show " + m.label + " instead";
    b.addEventListener("click", () => { current = m.pay; paint(); });
    sw.appendChild(b);
  });
}

export function initQr(){
  $("qrClose").addEventListener("click", closeQr);
  $("qrImg").addEventListener("error", () => {
    $("qrImg").hidden = true;
    $("qrMiss").hidden = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("qrWrap").hidden) closeQr();
  });
}

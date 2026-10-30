/* Prepaid value-credit packages.

   She sells RM600 of credit for RM500. The credit is a payment method, not a
   price change: line items keep their real prices and the bill arithmetic is
   untouched. That is the whole reason value-credit was the easier choice.

   Two rules worth stating plainly, because both protect her at the counter:

   - Credit is never spent automatically. She taps. Auto-applying would spend
     a customer's balance without either of them deciding to, and there are
     good reasons to pay cash and keep the credit for later.

   - Expired credit is never silently forfeited. The package stops being
     spendable, the balance stays visible, and extending it is one tap that
     leaves a dated record. Zeroing someone's balance without their knowing
     is an argument she cannot win. */

import { uid, money, fmtDate, emit } from "./util.js";
import { S } from "./state.js";
import * as store from "./store.js";

export function packageNo(seq){
  return "PK-" + new Date().getFullYear() + "-" + String(seq).padStart(4,"0");
}

export function remaining(pkg){
  return Math.round(((pkg.credit || 0) - (pkg.used || 0)) * 100) / 100;
}

export function isExpired(pkg, at){
  if (!pkg.expiresAt) return false;
  return new Date(pkg.expiresAt).getTime() < (at ? at.getTime() : Date.now());
}

/* Status is computed rather than stored, so nothing has to run in the
   background to keep it honest. Only "void" is a stored fact. */
export function statusOf(pkg){
  if (pkg.status === "void") return "void";
  if (remaining(pkg) <= 0) return "exhausted";
  if (isExpired(pkg)) return "expired";
  return "active";
}

export function packagesFor(patientId){
  return S.packages
    .filter((p) => p.patientId === patientId)
    .sort((a,b) => String(b.soldAt).localeCompare(String(a.soldAt)));
}

/* Spendable now, soonest expiry first — that order minimises forfeiture,
   which is the fair default when there are no refunds. */
export function spendable(patientId){
  return S.packages
    .filter((p) => p.patientId === patientId && statusOf(p) === "active")
    .sort((a,b) => String(a.expiresAt || "9999").localeCompare(String(b.expiresAt || "9999")));
}

export function creditAvailable(patientId){
  return Math.round(spendable(patientId).reduce((t,p) => t + remaining(p), 0) * 100) / 100;
}

/* Every package still owed, whether or not it can be spent today. */
export function outstanding(){
  return S.packages
    .filter((p) => p.status !== "void" && remaining(p) > 0)
    .sort((a,b) => String(a.expiresAt || "9999").localeCompare(String(b.expiresAt || "9999")));
}

export function expiringSoon(days){
  const cutoff = Date.now() + (days || 60) * 86400000;
  return outstanding().filter((p) => {
    if (!p.expiresAt) return false;
    const t = new Date(p.expiresAt).getTime();
    return t >= Date.now() && t <= cutoff;
  });
}

export function findPackage(id){
  return S.packages.filter((p) => p.id === id)[0] || null;
}

export function redemptionsForBill(billId){
  return S.redemptions.filter((r) => r.billId === billId && !r.reversedAt);
}

/* ---------- selling ---------- */
/* Called as part of issuing a bill. One package record per package line,
   per unit — buying two at once gives two separate balances with their own
   expiry dates, which is simpler to reason about than one merged pot. */
export function packagesFromBill(bill){
  const made = [];
  bill.items.forEach((item) => {
    if (item.c !== "package") return;
    for (let n = 0; n < item.q; n++){
      const sold = new Date(bill.date);
      const expires = new Date(sold);
      expires.setMonth(expires.getMonth() + (Number(item.mo) || 12));
      made.push({
        id: uid(),
        no: packageNo(S.settings.pkgNext || 1),
        patientId: bill.patientId,
        billId: bill.id,
        tier: item.n,
        soldAt: sold.toISOString(),
        paid: Number(item.p) || 0,
        credit: Number(item.cr) || 0,
        used: 0,
        expiresAt: expires.toISOString(),
        status: "active",
        extensions: []
      });
      S.settings.pkgNext = Number(S.settings.pkgNext || 1) + 1;
    }
  });
  return made;
}

/* ---------- redeeming ---------- */
/* Takes `amount` from the owner's packages, soonest expiry first, splitting
   across several when one doesn't cover it. Returns the redemption records
   and the mutated packages; the caller writes all of it in one transaction. */
export function planRedemption(ownerId, amount){
  let left = Math.round((amount || 0) * 100) / 100;
  const touched = [];
  const records = [];

  spendable(ownerId).forEach((pkg) => {
    if (left <= 0) return;
    const take = Math.min(remaining(pkg), left);
    if (take <= 0) return;
    pkg.used = Math.round(((pkg.used || 0) + take) * 100) / 100;
    left = Math.round((left - take) * 100) / 100;
    touched.push(pkg);
    records.push({ packageId: pkg.id, amount: take });
  });

  return { records, touched, shortfall: Math.max(0, left) };
}

/* ---------- the writes ---------- */
/* Issuing a bill that sells packages, redeems credit, or both. All of it
   lands together or none of it does: a half-written redemption would either
   give away credit she was paid for or take credit the customer still owns. */
export async function commitBill(bill, opts){
  const o = opts || {};
  const newPackages = packagesFromBill(bill);
  const plan = o.creditAmount > 0
    ? planRedemption(o.creditOwnerId || bill.patientId, o.creditAmount)
    : { records: [], touched: [] };

  const redemptions = plan.records.map((r) => ({
    id: uid(),
    packageId: r.packageId,
    billId: bill.id,
    patientId: bill.patientId,
    ownerId: o.creditOwnerId || bill.patientId,
    amount: r.amount,
    at: new Date().toISOString(),
    reversedAt: ""
  }));

  S.bills.unshift(bill);
  newPackages.forEach((p) => S.packages.push(p));
  redemptions.forEach((r) => S.redemptions.push(r));

  await store.tx(["bills","packages","redemptions"], (t) => {
    if (!t){ return; }                      /* fallback storage, mirrored below */
    t.objectStore("bills").put(bill);
    newPackages.forEach((p) => t.objectStore("packages").put(p));
    plan.touched.forEach((p) => t.objectStore("packages").put(p));
    redemptions.forEach((r) => t.objectStore("redemptions").put(r));
  });
  await mirror();
  return { newPackages, redemptions };
}

/* Voiding. Three distinct cases, and the third has to be refused:

   - redeemed credit → give it back, even if the package has since expired
   - sold a package, nothing spent → void the package too
   - sold a package, credit already spent → refuse, and say why */
export function voidBlockedReason(bill){
  const sold = S.packages.filter((p) => p.billId === bill.id && p.status !== "void");
  const spent = sold.filter((p) => (p.used || 0) > 0);
  if (spent.length){
    return "Package " + spent[0].no + " was sold on this bill and "
         + money(spent[0].used) + " of its credit has already been spent. "
         + "Voiding it would take back credit the customer has used. "
         + "Settle this one by hand instead.";
  }
  return "";
}

export async function voidBill(bill, reason){
  bill.status = "void";
  bill.voidedAt = new Date().toISOString();
  bill.voidReason = (reason || "").trim();

  /* give back whatever this bill took */
  const restored = [];
  const touched = [];
  redemptionsForBill(bill.id).forEach((r) => {
    const pkg = findPackage(r.packageId);
    if (!pkg) return;
    pkg.used = Math.round(((pkg.used || 0) - r.amount) * 100) / 100;
    if (pkg.used < 0) pkg.used = 0;
    r.reversedAt = bill.voidedAt;
    restored.push(r);
    if (touched.indexOf(pkg) === -1) touched.push(pkg);
  });

  /* and cancel whatever it sold */
  const cancelled = S.packages.filter((p) => p.billId === bill.id && p.status !== "void");
  cancelled.forEach((p) => { p.status = "void"; });

  await store.tx(["bills","packages","redemptions"], (t) => {
    if (!t) return;
    t.objectStore("bills").put(bill);
    touched.forEach((p) => t.objectStore("packages").put(p));
    cancelled.forEach((p) => t.objectStore("packages").put(p));
    restored.forEach((r) => t.objectStore("redemptions").put(r));
  });
  await mirror();

  return { restored: restored.length, cancelled: cancelled.length, expiredRestore: touched.some(isExpired) };
}

/* Months are counted from today when the package has already lapsed, and
   from the existing date when it hasn't. Adding three months to a date that
   went by last year would hand back something still expired, which is not
   what she means when she tells a customer she has extended it. */
export async function extend(pkg, months, reason){
  const from = pkg.expiresAt;
  const base = isExpired(pkg) ? new Date() : new Date(pkg.expiresAt || Date.now());
  const to = new Date(base);
  to.setMonth(to.getMonth() + (Number(months) || 3));
  pkg.expiresAt = to.toISOString();
  pkg.extensions = pkg.extensions || [];
  pkg.extensions.push({ at: new Date().toISOString(), from, to: pkg.expiresAt, reason: reason || "" });
  await store.putRecord("packages", pkg);
  emit("packages-changed");
  return pkg;
}

/* localStorage fallback has no transactions; the suppliers rewrite the
   whole arrays instead. */
function mirror(){
  if (store.backend === "idb") return Promise.resolve();
  return Promise.all([
    store.replaceAll("bills", S.bills),
    store.replaceAll("packages", S.packages),
    store.replaceAll("redemptions", S.redemptions)
  ]);
}

export function describe(pkg){
  const st = statusOf(pkg);
  if (st === "void") return "Voided";
  if (st === "exhausted") return "Used up";
  if (st === "expired") return "Expired " + fmtDate(pkg.expiresAt);
  return "Expires " + fmtDate(pkg.expiresAt);
}

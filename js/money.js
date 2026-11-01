/* All bill arithmetic. Pure functions — no DOM, no storage.

   Order of operations, and it matters:
     1. sum the lines                     → sub
     2. discount the chosen lines         → discAmt
     3. net = sub − discAmt
     4. round down to whole ringgit       → roundAdj, total
     5. apply package credit              → creditApplied
     6. balanceDue = total − creditApplied

   Credit is applied after rounding so the deduction is a clean figure and
   the customer keeps the rounding benefit. */

const CAT_WORDS = {
  consult:"consultation fees", treat:"treatments",
  combo:"combo packages", package:"prepaid packages"
};

/* Which lines a discount covers.

   From v2.1 each line carries its own flag (`di`), set by tapping it. Bills
   written before that have no flag, so they fall back to the old category
   scope — their stored totals stay correct and so does anything recomputed
   from them (the CSV's per-line apportionment, the note on a reprinted bill). */
export function eligibleForDiscount(item, disc){
  if (item.c === "package") return false;     /* never — the bonus is the discount */
  if (item.di === 1) return true;
  if (item.di === 0) return false;
  const scope = (disc && disc.s) || "treat";
  return scope === "tc" ? (item.c === "treat" || item.c === "consult") : (item.c === "treat");
}

/* Nothing is discounted unless she chooses it. A line that quietly arrives
   already discounted is a discount given without being decided on. */
export function defaultDiscountFlag(){
  return 0;
}

export function totals(items, disc, credit){
  const by = { consult:0, treat:0, combo:0, package:0 };
  items.forEach((i) => { by[i.c] = (by[i.c] || 0) + i.p * i.q; });
  const sub = by.consult + by.treat + by.combo + by.package;

  let base = 0;
  items.forEach((i) => { if (eligibleForDiscount(i, disc)) base += i.p * i.q; });

  let d = 0;
  if (disc && disc.v > 0) d = disc.m === "pct" ? base * disc.v / 100 : disc.v;
  d = Math.round(Math.min(Math.max(d, 0), base) * 100) / 100;

  /* charge whole ringgit only — always in the customer's favour, so she never
     has to hand back coins. The epsilon keeps 149.00 from floating to 148. */
  const net = Math.round((sub - d) * 100) / 100;
  const rounded = Math.floor(net + 1e-9);
  const adj = Math.round((net - rounded) * 100) / 100;

  /* Buying a package can't be paid for with package credit. */
  const creditable = Math.max(0, Math.round((rounded - by.package) * 100) / 100);
  const applied = Math.round(Math.min(Math.max(credit || 0, 0), creditable) * 100) / 100;
  const due = Math.round((rounded - applied) * 100) / 100;

  return {
    by, sub, base, disc:d, net, roundAdj:adj, total:rounded,
    creditable, creditApplied:applied, balanceDue:due
  };
}

/* What the customer is told about the discount's reach.

   It names what the discount DOES cover, which is what a customer wants to
   check, and it stays silent when there is nothing to clarify. Three shapes,
   in order of preference:

     - covers everything chargeable  → no note at all
     - lines up with whole categories → name those ("treatments only")
     - anything else                  → name the items, or count them once
                                        naming them would run long */
export function discScopeNote(bill){
  if (!bill.discAmt) return "";

  const items = (bill.items || []).filter((i) => i.p * i.q > 0);
  const covered = items.filter((i) => eligibleForDiscount(i, bill.disc));
  const left = items.filter((i) => !eligibleForDiscount(i, bill.disc));

  if (!covered.length) return "";
  if (!left.length) return "";          /* everything is covered — say nothing */

  const cats = {};
  items.forEach((i) => {
    cats[i.c] = cats[i.c] || { in:0, out:0 };
    if (eligibleForDiscount(i, bill.disc)) cats[i.c].in++;
    else cats[i.c].out++;
  });
  const alignsWithCategories = Object.keys(cats).every((c) => cats[c].in === 0 || cats[c].out === 0);

  if (alignsWithCategories){
    const words = Object.keys(cats).filter((c) => cats[c].in > 0).map((c) => CAT_WORDS[c]);
    return "Discount applies to " + joinWords(words) + " only.";
  }

  const names = covered.map((i) => i.n);
  if (names.length <= 3) return "Discount applies to " + joinWords(names) + " only.";
  return "Discount applies to " + covered.length + " of " + items.length + " items.";
}

/* A compact phrasing of the discount for a spreadsheet column: what came
   off, and what it came off. Empty when there was no discount. */
export function discountSummary(bill){
  if (!bill.discAmt) return "";
  const amount = (bill.disc && bill.disc.m === "pct")
    ? bill.disc.v + "%"
    : "RM " + (Math.round(bill.discAmt * 100) / 100).toFixed(2);
  return amount + " off " + discountTargets(bill);
}

/* Names what the discount covered, in as few words as stay true. */
export function discountTargets(bill){
  const items = (bill.items || []).filter((i) => i.p * i.q > 0);
  const covered = items.filter((i) => eligibleForDiscount(i, bill.disc));
  const left = items.filter((i) => !eligibleForDiscount(i, bill.disc));
  if (!covered.length) return "nothing";
  if (!left.length) return "everything";

  const cats = {};
  items.forEach((i) => {
    cats[i.c] = cats[i.c] || { in:0, out:0 };
    if (eligibleForDiscount(i, bill.disc)) cats[i.c].in++;
    else cats[i.c].out++;
  });
  if (Object.keys(cats).every((c) => cats[c].in === 0 || cats[c].out === 0)){
    return joinWords(Object.keys(cats).filter((c) => cats[c].in > 0).map((c) => CAT_WORDS[c]));
  }
  const names = covered.map((i) => i.n);
  if (names.length <= 3) return joinWords(names);
  return covered.length + " of " + items.length + " items";
}

function joinWords(list){
  if (list.length <= 1) return list[0] || "";
  if (list.length === 2) return list[0] + " and " + list[1];
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

/* What a line is worth once the bill's discount is spread across the lines
   it covers. Used by the CSV so the per-line figures sum correctly. */
export function lineSubtotal(b, item){
  const lineTotal = item.p * item.q;
  if (!b.discAmt) return lineTotal;
  if (!eligibleForDiscount(item, b.disc)) return lineTotal;
  let base = 0;
  b.items.forEach((z) => { if (eligibleForDiscount(z, b.disc)) base += z.p * z.q; });
  if (base <= 0) return lineTotal;
  return Math.round((lineTotal - b.discAmt * lineTotal / base) * 100) / 100;
}

export const CREDIT_LABEL = "Package Credit";

/* How a bill was settled, as a person would say it.

   Credit is derived rather than stored: the bill already records how much
   came off a package, and writing it into the payment field would put a
   value in there that the picker has no option for. A bill part-paid in
   credit names both. */
export function paymentLabel(bill){
  const credit = bill.creditApplied || 0;
  const due = typeof bill.balanceDue === "number" ? bill.balanceDue : bill.total;
  if (credit <= 0) return bill.pay || "";
  if (due <= 0) return CREDIT_LABEL;
  return bill.pay ? CREDIT_LABEL + " + " + bill.pay : CREDIT_LABEL;
}

/* True when nothing is left for her to collect, so there is no cash method
   to choose and the picker should not be asking for one. */
export function settledByCredit(bill){
  const credit = bill.creditApplied || 0;
  const due = typeof bill.balanceDue === "number" ? bill.balanceDue : bill.total;
  return credit > 0 && due <= 0;
}

export function isVoid(b){ return b.status === "void"; }
export function live(list){ return list.filter((b) => !isVoid(b)); }

/* Cash actually taken for a bill. A fully-redeemed bill contributes nothing;
   a package sale contributes what she was paid for it. */
export function cashTaken(b){
  if (isVoid(b)) return 0;
  return typeof b.balanceDue === "number" ? b.balanceDue : b.total;
}
export function creditUsed(b){
  if (isVoid(b)) return 0;
  return b.creditApplied || 0;
}

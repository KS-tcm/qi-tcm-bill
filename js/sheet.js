/* The full-screen bill and estimate, and the canvas version that goes out
   over WhatsApp. Both renderers show the same thing; keep them in step. */

import { $, esc, money, fmtDate, fmtTime, toast, emit, LOGO, LOGO_SRC } from "./util.js";
import { S } from "./state.js";
import { isVoid, discScopeNote } from "./money.js";
import * as packages from "./packages.js";
import { openQr, qrKeyFor, anyQrConfigured, initQr, QR_METHODS } from "./qr.js";

/* What the customer actually hands over. */
function billDue(bill){
  return typeof bill.balanceDue === "number" ? bill.balanceDue : bill.total;
}

/* After a redemption, the customer wants to know what is left on the card —
   and after buying one, what they just got. Both go under the total. */
function packageFooter(bill){
  const lines = [];

  (bill.items || []).forEach((i) => {
    if (i.c !== "package") return;
    const made = S.packages.filter((p) => p.billId === bill.id);
    made.forEach((p) => {
      lines.push(money(p.credit) + " credit added · " + esc(p.no)
        + " · valid to " + fmtDate(p.expiresAt));
    });
    if (!made.length){
      lines.push(money((i.cr || 0) * i.q) + " credit · valid " + (i.mo || 12) + " months");
    }
  });

  if (bill.creditApplied > 0 && bill.creditOwnerId){
    const held = S.packages.filter((p) => p.patientId === bill.creditOwnerId && p.status !== "void");
    const left = held.reduce((t,p) => t + Math.max(0, (p.credit || 0) - (p.used || 0)), 0);
    const soonest = held
      .filter((p) => packages.statusOf(p) === "active")
      .sort((a,b) => String(a.expiresAt || "9999").localeCompare(String(b.expiresAt || "9999")))[0];
    lines.push("Package balance remaining: " + money(left)
      + (soonest ? " · expires " + fmtDate(soonest.expiresAt) : ""));
  }

  if (!lines.length) return "";
  return "<div class='sh-pkg'>" + lines.map((l) => "<div>" + l + "</div>").join("") + "</div>";
}

export function billHtml(bill, animate){
  const st = S.settings;
  const backdated = bill.mode === "backdated";
  const voided = isVoid(bill);
  const stampSrc = bill.issuedAt || bill.date;

  const rows = bill.items.map((i) =>
    "<tr><td>" + esc(i.n) + (i.d ? "<small>" + esc(i.d) + "</small>" : "") + "</td>"
    + "<td class='qtycol'>×" + i.q + "</td>"
    + "<td class='r'>" + money(i.p * i.q) + "</td></tr>"
  ).join("");

  const meta = [st.addr, st.phone, st.reg].filter(Boolean).map(esc).join("<br>");

  const adj = bill.roundAdj || 0;
  const credit = bill.creditApplied || 0;
  let discRow = "";
  if (bill.discAmt > 0 || adj > 0 || credit > 0){
    discRow += "<div class='sh-sub'><span>Subtotal</span><span>" + money(bill.sub) + "</span></div>";
    if (bill.discAmt > 0){
      discRow += "<div class='sh-sub cut'><span>Discount"
               + (bill.disc.m === "pct" ? " (" + bill.disc.v + "%)" : "")
               + "</span><span>−" + money(bill.discAmt) + "</span></div>";
    }
    if (adj > 0){
      discRow += "<div class='sh-sub cut'><span>Rounded down</span><span>−" + money(adj) + "</span></div>";
    }
    if (credit > 0){
      discRow += "<div class='sh-sub cut'><span>Paid from package</span><span>−" + money(credit) + "</span></div>";
    }
    const note = discScopeNote(bill);
    if (note) discRow += "<div class='sh-discnote'>" + esc(note) + "</div>";
  }

  let infoRows = "";
  if (bill.combined){
    infoRows += "<tr><th>Bills</th><td>" + esc((bill.sourceNos || []).join(", ")) + "</td></tr>";
  }
  if (bill.no && st.showBillNo !== false){
    infoRows += "<tr><th>Bill no.</th><td>" + esc(bill.no) + "</td></tr>";
  }
  infoRows += "<tr><th>" + (bill.combined ? "For" : bill.no ? "Bill to" : "Customer")
            + "</th><td>" + esc(bill.name || "—") + "</td></tr>";
  if (backdated){
    infoRows += "<tr><th>Visit</th><td>" + fmtDate(bill.date) + "<br>" + fmtTime(bill.date) + "</td></tr>"
              + "<tr><th>Bill issued</th><td>" + fmtDate(stampSrc) + "</td></tr>";
  } else {
    infoRows += "<tr><th>Date</th><td>" + fmtDate(bill.date) + "</td></tr>";
  }

  let seal = "";
  if (bill.no && voided){
    seal = "<div class='seal voided'><em>VOID</em><small>" + fmtDate(bill.voidedAt || stampSrc) + "</small></div>";
  } else if (bill.no){
    seal = "<div class='seal" + (animate ? " press" : "") + "'><em>" + esc(st.seal || "Qi") + "</em>"
         + "<small>" + fmtDate(stampSrc) + "</small><small>" + fmtTime(stampSrc) + "</small></div>";
  }

  return (voided ? "<div class='sh-void'>Voided" + (bill.voidReason ? " — " + esc(bill.voidReason) : "") + "</div>" : "")
    + "<div class='sh-top'>"
      + "<div class='sh-brand'>"
        + "<img class='sh-logo' src='" + LOGO_SRC + "' alt='" + esc(st.name) + "'>"
        + (meta ? "<div class='sh-meta'>" + meta + "</div>" : "")
      + "</div>"
      + "<div class='sh-info'>"
        + "<div class='sh-kind'>" + (bill.combined ? "Combined" : bill.no ? "Bill" : "Estimate") + "</div>"
        + "<table class='sh-info-t'>" + infoRows + "</table>"
      + "</div>"
    + "</div>"
    + "<table class='sh'><thead><tr><th>Item</th><th class='qtycol'>Qty</th><th class='r'>Amount</th></tr></thead>"
    + "<tbody>" + rows + "</tbody></table>"
    + discRow
    + "<div class='sh-total'><span>"
      + (bill.combined ? "Total to pay"
         : credit > 0 ? "Balance due"
         : bill.no ? "Total" : "Estimated total")
      + "</span><b>" + money(billDue(bill)) + "</b></div>"
    + (bill.combined
        ? "<div class='sh-pkg'><div>Combined from " + (bill.sourceNos || []).length
          + " bills for one payment. Each is recorded separately.</div></div>"
        : packageFooter(bill))
    + (st.foot ? "<div class='sh-foot'>" + esc(st.foot) + "</div>" : "")
    + seal;
}

export function renderSheet(bill, animate){
  const voided = isVoid(bill);
  $("sheet").innerHTML = billHtml(bill, animate);

  const canVoid = !!bill.no && !voided && S.bills.indexOf(bill) !== -1;
  const combined = !!bill.combined;
  $("btnVoid").hidden = !canVoid;

  /* One tap from the bill to the QR, which is the moment she needs it: the
     customer has just seen what they owe. If a payment method was picked
     while billing the button goes straight to that QR; if not, it opens the
     one that is set up and offers the other. */
  const qrBtn = $("btnSheetQr");
  const qrBtn2 = $("btnSheetQr2");
  const payKey = qrKeyFor(bill.pay);
  let showQrBtn = !voided && (payKey || anyQrConfigured());
  qrBtn2.hidden = true;

  if (combined){
    /* The whole point of this view is taking one payment, so both ways are
       always offered rather than hidden behind a switcher. If an image has
       not been uploaded the overlay says so, which is clearer than a button
       that silently is not there. */
    showQrBtn = true;
    qrBtn.textContent = qrButtonLabel(QR_METHODS[0].pay);
    qrBtn.dataset.method = QR_METHODS[0].pay;
    qrBtn2.hidden = false;
    qrBtn2.textContent = qrButtonLabel(QR_METHODS[1].pay);
    qrBtn2.dataset.method = QR_METHODS[1].pay;
  } else if (showQrBtn){
    qrBtn.textContent = payKey ? qrButtonLabel(bill.pay) : "Show QR";
    qrBtn.dataset.method = payKey ? bill.pay : firstConfigured();
  }
  qrBtn.hidden = !showQrBtn;

  /* An estimate can be turned into a bill without going back, which is the
     order things actually happen in: show the price, they agree, they pay,
     it is billed. */
  const isEstimate = !bill.no && !combined;
  $("btnSheetIssue").hidden = !isEstimate;

  const shown_ = 2 + (canVoid ? 1 : 0) + (showQrBtn ? 1 : 0)
               + (qrBtn2.hidden ? 0 : 1) + (isEstimate ? 1 : 0);
  const bar = $("sheetBar");
  bar.classList.toggle("three", shown_ === 3);
  bar.classList.toggle("four", shown_ >= 4);

  S.shown = bill;
  $("sheetWrap").hidden = false;
  document.body.classList.add("locked");
}

export function closeSheet(){
  $("sheetWrap").hidden = true;
  document.body.classList.remove("locked");
  S.shown = null;
}

function canvasPackageLines(bill){
  const out = [];
  (bill.items || []).forEach((i) => {
    if (i.c !== "package") return;
    const made = S.packages.filter((p) => p.billId === bill.id);
    made.forEach((p) => {
      out.push(money(p.credit) + " credit added \u00b7 " + p.no + " \u00b7 valid to " + fmtDate(p.expiresAt));
    });
    if (!made.length){
      out.push(money((i.cr || 0) * i.q) + " credit \u00b7 valid " + (i.mo || 12) + " months");
    }
  });
  if (bill.creditApplied > 0 && bill.creditOwnerId){
    const held = S.packages.filter((p) => p.patientId === bill.creditOwnerId && p.status !== "void");
    const left = held.reduce((t,p) => t + Math.max(0, (p.credit || 0) - (p.used || 0)), 0);
    const soonest = held
      .filter((p) => packages.statusOf(p) === "active")
      .sort((a,b) => String(a.expiresAt || "9999").localeCompare(String(b.expiresAt || "9999")))[0];
    out.push("Package balance remaining: " + money(left)
      + (soonest ? " \u00b7 expires " + fmtDate(soonest.expiresAt) : ""));
  }
  return out;
}

export function drawBill(bill){
  const st = S.settings;
  const W = 780, pad = 48, S2 = 2;
  const SERIF = 'Georgia, "Noto Serif", serif';
  const SANS  = 'system-ui, Roboto, sans-serif';
  const logoW = 150;
  const logoH = (LOGO.naturalWidth && LOGO.naturalHeight)
    ? Math.round(logoW * LOGO.naturalHeight / LOGO.naturalWidth) : 160;

  const metaLines = [st.addr, st.phone, st.reg].filter(Boolean);
  const descCount = bill.items.filter((i) => i.d).length;

  const c = document.createElement("canvas");
  const x = c.getContext("2d");

  /* wrap the customer name to the width available in the right half */
  function wrap(text, font, maxW){
    x.font = font;
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = "";
    words.forEach((w) => {
      const test = cur ? cur + " " + w : w;
      if (x.measureText(test).width <= maxW || !cur) cur = test;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }

  const VAL_FONT = "600 15px " + SANS;
  const backdated = bill.mode === "backdated";
  const voided = isVoid(bill);
  const stampSrc = bill.issuedAt || bill.date;

  const nameLines = wrap(bill.name || "—", VAL_FONT, 205);
  const infoRows = [];
  if (bill.no && st.showBillNo !== false) infoRows.push({ label:"BILL NO.", lines:[bill.no] });
  infoRows.push({ label: bill.no ? "BILL TO" : "CUSTOMER", lines: nameLines });
  if (backdated){
    infoRows.push({ label:"VISIT", lines:[fmtDate(bill.date), fmtTime(bill.date)] });
    infoRows.push({ label:"BILL ISSUED", lines:[fmtDate(stampSrc)] });
  } else {
    infoRows.push({ label:"DATE", lines:[fmtDate(bill.date)] });
  }

  let rowsH = 0;
  infoRows.forEach((r, n) => { rowsH += 24 + (r.lines.length - 1) * 20 + (n < infoRows.length - 1 ? 2 : 0); });

  const logoBlockH = logoH + (metaLines.length ? 9 + metaLines.length * 19 : 0);
  const infoBlockH = 24 + rowsH;
  const headerTop = 46 + (voided ? 44 : 0);
  const headerH = Math.max(logoBlockH, infoBlockH);

  const cCredit = bill.creditApplied || 0;
  const pkgLines = canvasPackageLines(bill);
  const H = 118 + headerTop + headerH + bill.items.length * 42 + descCount * 18
        + ((bill.discAmt > 0 || (bill.roundAdj || 0) > 0 || cCredit > 0)
             ? 32 + (bill.discAmt > 0 ? 24 : 0) + ((bill.roundAdj || 0) > 0 ? 24 : 0)
                  + (cCredit > 0 ? 24 : 0)
                  + (discScopeNote(bill) ? 22 : 0)
             : 0)
        + (pkgLines.length ? 14 + pkgLines.length * 19 : 0)
        + (st.foot ? 56 : 0) + (bill.no ? 60 : 0);

  c.width = W * S2; c.height = H * S2;
  x.scale(S2, S2);

  x.fillStyle = "#FFF8E5"; x.fillRect(0, 0, W, H);

  /* left half: logo centred both ways */
  const leftCx = (pad + W / 2) / 2;
  const logoTop = headerTop + (headerH - logoBlockH) / 2;
  if (LOGO.complete && LOGO.naturalWidth) x.drawImage(LOGO, leftCx - logoW / 2, logoTop, logoW, logoH);
  if (metaLines.length){
    let my = logoTop + logoH + 9 + 13;
    x.fillStyle = "#8F8154"; x.font = "13px " + SANS; x.textAlign = "center";
    metaLines.forEach((l) => { x.fillText(l, leftCx, my); my += 19; });
    x.textAlign = "left";
  }

  /* right half: details block, flush right and sitting on the rule */
  const rx = W - pad;
  const bottom = headerTop + headerH;
  const labelX = rx - 250;
  let ry = bottom - rowsH;

  x.textAlign = "right";
  x.fillStyle = "#A8322D"; x.font = "700 12px " + SANS;
  x.fillText(bill.no ? "BILL" : "ESTIMATE", rx, ry - 12);

  infoRows.forEach((row, n) => {
    ry += 15;
    x.textAlign = "left";
    x.fillStyle = "#8F8154"; x.font = "600 10px " + SANS;
    x.fillText(row.label, labelX, ry);
    x.textAlign = "right";
    x.fillStyle = "#1C2321"; x.font = VAL_FONT;
    row.lines.forEach((l, k) => { x.fillText(l, rx, ry + k * 20); });
    ry += (row.lines.length - 1) * 20 + 9;
    if (n < infoRows.length - 1){
      x.strokeStyle = "#EADDB8"; x.lineWidth = 1;
      x.beginPath(); x.moveTo(labelX, ry); x.lineTo(rx, ry); x.stroke();
      ry += 2;
    }
  });
  x.textAlign = "left";

  if (voided){
    x.strokeStyle = "#A8322D"; x.lineWidth = 1;
    x.strokeRect(pad, 34, W - pad * 2, 30);
    x.fillStyle = "#A8322D"; x.font = "700 12px " + SANS; x.textAlign = "center";
    x.fillText("VOIDED" + (bill.voidReason ? " — " + bill.voidReason.toUpperCase() : ""), W / 2, 53);
    x.textAlign = "left";
  }

  let y = bottom + 16;
  x.strokeStyle = "#1C2321"; x.lineWidth = 2;
  x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();

  y += 40;
  x.fillStyle = "#8F8154"; x.font = "11px " + SANS;
  x.fillText("ITEM", pad, y);
  x.textAlign = "right"; x.fillText("AMOUNT", W - pad, y); x.textAlign = "left";
  y += 10;
  x.strokeStyle = "#EADDB8"; x.lineWidth = 1;
  x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();

  bill.items.forEach((i) => {
    y += 27;
    x.fillStyle = "#1C2321"; x.font = "16px " + SERIF;
    x.fillText(i.n + (i.q > 1 ? "  ×" + i.q : ""), pad, y);
    x.textAlign = "right"; x.fillText(money(i.p * i.q), W - pad, y); x.textAlign = "left";
    if (i.d){ y += 17; x.fillStyle = "#8F8154"; x.font = "12px " + SANS; x.fillText(i.d, pad, y); }
    y += 14;
    x.strokeStyle = "#EADDB8";
    x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();
  });

  const cAdj = bill.roundAdj || 0;
  if (bill.discAmt > 0 || cAdj > 0 || cCredit > 0){
    y += 24; x.fillStyle = "#8F8154"; x.font = "14px " + SANS;
    x.fillText("Subtotal", pad, y);
    x.textAlign = "right"; x.fillText(money(bill.sub), W - pad, y); x.textAlign = "left";

    if (bill.discAmt > 0){
      y += 24; x.fillStyle = "#A8322D"; x.font = "14px " + SANS;
      x.fillText("Discount" + (bill.disc.m === "pct" ? " (" + bill.disc.v + "%)" : ""), pad, y);
      x.textAlign = "right"; x.fillText("−" + money(bill.discAmt), W - pad, y); x.textAlign = "left";
    }
    if (cAdj > 0){
      y += 24; x.fillStyle = "#A8322D"; x.font = "14px " + SANS;
      x.fillText("Rounded down", pad, y);
      x.textAlign = "right"; x.fillText("−" + money(cAdj), W - pad, y); x.textAlign = "left";
    }
    if (cCredit > 0){
      y += 24; x.fillStyle = "#A8322D"; x.font = "14px " + SANS;
      x.fillText("Paid from package", pad, y);
      x.textAlign = "right"; x.fillText("−" + money(cCredit), W - pad, y); x.textAlign = "left";
    }
    const dnote = discScopeNote(bill);
    if (dnote){
      y += 20; x.fillStyle = "#8F8154"; x.font = "11.5px " + SANS;
      x.textAlign = "right"; x.fillText(dnote, W - pad, y); x.textAlign = "left";
    }
  }

  y += 26;
  x.strokeStyle = "#1C2321"; x.lineWidth = 2;
  x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();

  y += 34;
  x.fillStyle = "#8F8154"; x.font = "12px " + SANS;
  x.fillText(cCredit > 0 ? "BALANCE DUE" : (bill.no ? "TOTAL" : "ESTIMATED TOTAL"), pad, y);
  x.fillStyle = "#1C2321"; x.font = "700 32px " + SERIF;
  x.textAlign = "right"; x.fillText(money(billDue(bill)), W - pad, y + 4); x.textAlign = "left";

  if (pkgLines.length){
    y += 30; x.fillStyle = "#8F8154"; x.font = "12.5px " + SANS;
    pkgLines.forEach((l) => { x.fillText(l, pad, y); y += 19; });
    y -= 19;
  }

  if (st.foot){
    y += 46; x.fillStyle = "#8F8154"; x.font = "13px " + SANS;
    x.fillText(st.foot, pad, y);
  }

  if (bill.no){
    const ink = voided ? "#8A8F8C" : "#A8322D";
    x.save();
    x.translate(W - pad - 50, H - 78);
    x.rotate(-7 * Math.PI / 180);
    x.strokeStyle = ink; x.lineWidth = 3.5;
    x.strokeRect(-48, -48, 96, 96);
    x.fillStyle = ink; x.textAlign = "center";
    if (voided){
      x.font = "700 20px " + SERIF;
      x.fillText("VOID", 0, -4);
      x.font = "10.5px " + SANS;
      x.fillText(fmtDate(bill.voidedAt || stampSrc), 0, 20);
    } else {
      x.font = "700 26px " + SERIF;
      x.fillText(st.seal || "Qi", 0, -8);
      x.font = "10.5px " + SANS;
      x.fillText(fmtDate(stampSrc), 0, 15);
      x.fillText(fmtTime(stampSrc), 0, 31);
    }
    x.restore();
  }
  return c;
}

function qrButtonLabel(pay){
  return pay + " QR";
}

function firstConfigured(){
  const hit = QR_METHODS.filter((m) => S.qr && S.qr[m.key])[0];
  return hit ? hit.pay : QR_METHODS[0].pay;
}

export function initSheet(){
  initQr();
  [$("btnSheetQr"), $("btnSheetQr2")].forEach((b) => {
    b.addEventListener("click", () => {
      openQr(b.dataset.method, S.shown ? billHtml(S.shown, false) : "");
    });
  });
  /* billing.js owns issuing; going through the bus keeps sheet.js from
     importing it, which would close a cycle since billing imports this. */
  $("btnSheetIssue").addEventListener("click", () => emit("issue-from-estimate"));
  $("btnClose").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("sheetWrap").hidden) closeSheet();
  });

  $("btnVoid").addEventListener("click", async () => {
    const b = S.shown;
    if (!b || !b.no || isVoid(b)) return;

    /* Refusing beats half-undoing: if the package this bill sold has
       already been spent against, voiding would claw back credit the
       customer has used. */
    const blocked = packages.voidBlockedReason(b);
    if (blocked){ alert("This bill can't be voided.\n\n" + blocked); return; }

    const red = packages.redemptionsForBill(b.id);
    const givingBack = red.reduce((t,r) => t + r.amount, 0);
    const sells = S.packages.filter((p) => p.billId === b.id && p.status !== "void");

    let extra = "";
    if (givingBack > 0) extra = "\n\n" + money(givingBack) + " of package credit goes back onto the customer's balance.";
    else if (sells.length) extra = "\n\nThe package sold on this bill (" + sells[0].no + ") is cancelled with it.";

    if (!confirm("Void bill " + b.no + "?\n\nIt stays in your records, marked void and excluded from all totals. It can't be un-voided \u2014 you issue a new bill instead." + extra)) return;
    const why = prompt("Reason (optional) \u2014 e.g. wrong name, wrong treatment:", "");
    if (why === null) return;

    const out = await packages.voidBill(b, why);
    renderSheet(b, false);
    emit("bills-changed");
    emit("packages-changed");

    if (out.restored && out.expiredRestore){
      toast("Bill voided. Credit returned — note that package has expired.");
    } else if (out.restored){
      toast("Bill voided. " + money(givingBack) + " of credit returned.");
    } else if (out.cancelled){
      toast("Bill voided and the package cancelled.");
    } else {
      toast("Bill voided.");
    }
  });

  $("btnShare").addEventListener("click", () => {
    const bill = S.shown;
    if (!bill) return;
    const fname = (bill.no ? "bill-" + bill.no : "estimate-" + Date.now()) + ".png";
    drawBill(bill).toBlob((blob) => {
      if (!blob){ toast("Couldn't create the image."); return; }
      const file = new File([blob], fname, { type:"image/png" });
      if (navigator.canShare && navigator.canShare({ files:[file] })){
        navigator.share({ files:[file] }).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = fname; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast("Saved to your downloads.");
      }
    }, "image/png");
  });
}

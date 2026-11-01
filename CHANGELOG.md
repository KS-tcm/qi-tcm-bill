# Changelog

All notable changes to Qi TCM. The version number shown at the
bottom of the Setup tab matches the newest entry here.

## Unreleased — in-house, still v2.1

### Fixed
- **A bill paid from package credit showed no payment method at all.** The
  row was tagged Credit but the picker sat empty, as though she had
  forgotten to answer it. A fully-settled bill now states **Package Credit**
  in place of the picker, because there is nothing left to collect and so
  nothing to choose. A part-paid bill reads "Package Credit + Cash" and
  keeps its picker for the rest.
  - The label is derived from what the bill already records, not written
    into the payment field — putting it there would store a value the picker
    has no option for.
- **"Show DuitNow QR QR".** The method was named "DuitNow QR" and the app
  appends "QR" to it. It is now just **DuitNow** everywhere; the QR is the
  thing you show, not part of the name. Bills already written on the tablet
  carry the old wording and are brought forward on load, so they keep
  matching an option in the picker instead of going blank.

### Changed
- `payment_method` in both CSV exports now says how the bill was actually
  settled, Package Credit included. `bill_total` is unchanged: it is what
  the bill came to, which is what the customer paid for that visit however
  it was settled.

### Fixed
- **A selected bill row was being crushed.** `.picked` was already the
  patient picker's class, and its `.picked button { width:38px }` rule
  reached into the Records list and squashed the selected row's button from
  992px to 38px, overlapping everything in it. The row class is now
  `chosen`, and every picker rule is scoped to `.picker` so it cannot leak
  again. A test now compares a selected row against an unselected one —
  the earlier checks only compared normal against selecting and never
  measured a selected row, which is why this got through twice.

### Changed
- **Tick boxes are gone; a selected bill is shown in colour** — jade tint
  with an edge bar, which costs no width at any screen size. In selection
  mode the row itself is the target. Measured identical in height and in
  field widths between normal and selection at every width from 500px to
  1440px.
- The payment dropdown stays visible during selection, since there is no
  longer a box competing for the space. Clicks on it never reach the row.

### Added
- **Summary CSV** in Records: one row per issued bill — bill number, date,
  customer, patient number, all items in a single cell, what the discount
  came off, total and payment method. Voided bills are left out. The
  existing Download CSV, with a row per line item, is unchanged.

## v2.1 — 1 November 2026

### Fixed
- **Ticking bills no longer squeezes the row.** The tick box is positioned
  out of the flow so turning selection on cannot reflow anything, and the
  payment dropdown steps aside while picking — choosing bills to combine and
  setting a payment method are different jobs, and the dropdown was taking
  114px the name and date needed. The name column comes out wider during
  selection than before it.
- **The bill row was already cramped on a narrow screen**, before any of
  this: below 620px the payment picker now takes its own line instead of
  truncating the patient's name to nothing.

### Changed
- **Nothing is discounted by default.** Treatments used to arrive already
  inside the discount, which is a discount given without being decided on.
  Every line now starts outside it and she taps the ones she means. The four
  presets are unchanged.
- **Select bills stays Select bills until something is ticked**, and pressing
  it again puts the boxes away. It only becomes Combine once there is
  something to combine.
- **The combined view always ends in four buttons** — TnG QR, DuitNow QR,
  Close, Send — rather than hiding a payment method behind a switcher. Both
  are offered even if only one image has been uploaded; the overlay says
  plainly when a picture is missing, which beats a button that is absent for
  reasons she cannot see.

### Added
- **The bill sits beside the QR.** Opening a payment QR now splits the
  screen — bill on the left, QR on the right — so the customer can see what
  they owe while they scan instead of having to remember it.
- **Combine bills.** Select bills puts a tick box on every live bill; once
  two or more are picked the button becomes Combine and shows them as a
  single total, with both payment QRs one tap away. For a family paying
  together.
  - Combining is only a **view**. Nothing is created, nothing is changed:
    each bill keeps its own number, stays its own record, and Sales is
    untouched. The combined sheet says so on its face.
  - Identical lines merge, so three of the same treatment read as one row of
    three. Voided bills cannot be picked. Clear is muted until something is
    selected, and leaving the tab puts the selection away.
- **The new-patient form shows the number the patient will get**, and holds
  it, so the screen and the saved record can never disagree.

### Fixed
- **Setup showed a stale next-patient number.** The field was filled once at
  launch and never again, so it still read whatever it was when the app was
  opened. Both counters now follow what has actually been issued, and a
  field being typed into is left alone.

### Changed
- **Consultation items always read first** on the draft and on the bill,
  whatever order they were tapped in. Treatments, combos and packages follow.
- **Visits sorts both ways** — most first, then fewest, then off — matching
  how the Patients control already behaved.
- Ticking a bill updates that row and the buttons rather than redrawing the
  whole list, which was replacing the box under her finger.

## v2.0.1 — 30 October 2026

A data-loss fix. Anyone on v2.0 should update before entering anything else.

### Fixed
- **Settings, the price list and the migration marker were silently reset to
  defaults every time the app was reopened.** The kv store returns its rows
  as `{ k, v }` records, which `loadFromIdb` turned into a map — and then
  overwrote with the raw array, because the spread of the other stores came
  after it in the returned object. Every later read of `loaded.kv.settings`
  was `undefined`, so the defaults won.

  The damage ran in a chain. Losing the marker meant the next thing to write
  `meta` — the link-old-bills screen's Done button does exactly that — saved
  it without the marker. On the launch after that the app believed it had
  never migrated from v1.5, re-ran the one-time import, emptied the patient
  list and rewrote every bill from the old localStorage copy. Three launches
  from upgrading to losing the lot.

  Patient records were never actually deleted from the database; they stopped
  being read. Updating brings them back.

### Changed
- **The one-time v1.5 import now only runs against a genuinely empty
  database**, and never when the read failed. A failed read used to be
  indistinguishable from a fresh install, which was the second way the same
  import could have destroyed real records.
- **Work saved while the database was unavailable is no longer stranded.** A
  session that falls back to simpler storage writes patients there; if the
  database opens cleanly later, that work is adopted into it rather than
  being invisible. Only when there is nothing in the database to contradict,
  so nothing is ever resurrected over newer data.
- A database that cannot be read now says so plainly and tells her not to
  enter anything, rather than showing an empty app as if it were new.

### Tests
- A new suite covers the second and third launch. Every existing suite booted
  the app exactly once, which is precisely why a bug that only appears on
  reopening got through. 410 assertions now.

## v2.0 — released 30 October 2026

Everything below ships to the clinic together as v2.0. The dated sections are
the order it was built in, kept so the reasoning behind each piece is still
on the record.

### 30 October 2026 (final)

#### Changed
- **Deleting a patient leaves the name on their bills.** The bills keep the
  name they were issued under and stay in Records exactly as they were; what
  goes is the patient number and the record behind it. They are also marked,
  so the link-old-bills screen does not turn round and offer to recreate the
  patient who has just been deleted.
- **Deletion stays refused** while the patient holds unspent package credit,
  naming the package and the amount.
- **The patient number is now the unique identifier.** No two records can
  carry the same one.
  - Saving a patient with a number someone else holds is refused, and says so.
  - Import rejects a row whose number is already issued, and a row whose
    number repeats one earlier in the same file. Rows with no number given
    are numbered automatically, past the highest one the file brought in.
  - Setup still lets the next-number counter be moved by hand; it now walks
    past any number already in use rather than handing out a duplicate.

#### Removed
- **Export CSV.** The encrypted export could not be opened in a spreadsheet,
  which made it a second backup rather than an export. Import and the CSV
  template are unchanged.

### 30 October 2026 (later)

#### Added
- **Visit history as a calendar.** A List / Calendar switch on the patient
  page. The calendar shows a month at a time with a dot per visit; the
  month's visits are listed underneath with the treatment and bill number,
  and tapping a day highlights its row. Cells are too narrow on a phone to
  carry treatment names, so the text lives under the grid rather than being
  squeezed into it.
- **Export CSV** on the Patients tab, encrypted with the same passphrase as
  the backups. The list carries IC and phone numbers off the tablet, so it
  does not leave in the clear. Import reads the encrypted file straight back.
  The trade-off is deliberate and worth knowing: the export cannot be opened
  in Excel.
- **A patient-number column, leftmost, in all three CSVs** — template, export
  and import. Supply a number on import and the patient keeps it, which is
  what makes continuing a half-finished list possible. The next-number
  counter in Setup moves past whatever was imported so the next new patient
  never collides.
- **A Patients control** at the top of the list showing the total; tapping it
  sorts by patient number, oldest first, then newest, then back to normal.

#### Changed
- **Package and Credit are now two different signs.** A bill that *sold* a
  package is tagged **Package**; a bill *paid from* existing credit is tagged
  **Credit**. Two different events deserve two different words.
- The patient list row now shows **number, name, last visit and visit count**.
  The phone number has gone from the row — it is still searchable and still
  on the patient's own page.
- **Delete replaces Archive** on the patient page, which now has only Edit
  and Delete. Bill this patient and the per-patient export are gone.
  - Deleting unlinks the patient's bills rather than removing them: the bills
    keep the name they were issued under and stay in Records, so the money
    record is never damaged by tidying up the patient list.
  - Deleting is **refused** while the patient holds unspent package credit,
    naming the package and the amount. Deleting then would erase the record
    of services already paid for.
- Masked amounts now read **[RM ****]** rather than dots.

### 30 October 2026 (earlier)

#### Added
- **Show the QR from an estimate too**, not only from an issued bill. The
  real order of events is: show the price, they agree, they pay, it is
  billed — so the QR has to be reachable before the bill exists.
- **Issue bill straight from the estimate screen.** No going back to the Bill
  tab to do what the customer has just agreed to.
- **Two figures at the top of the patient list**, which also work as
  controls: Unredeemed credit narrows the list to the people holding it,
  Visits sorts by who comes most. Tapping either again clears it.
- **Bill numbers in a patient's visit history**, so a row on screen can be
  matched to a bill in Records or to a paper copy.
- **Hide amounts in Records**, behind an eye button. Hidden every time the
  tab is opened, not just the first — the tablet sits on a counter with
  patients on the other side of it, and the safe state should be the one you
  get without thinking about it. Counts stay visible; only money is masked.

##### Changed
- Patient numbers are now **SI-0001** rather than P-0001.
- A bill settled with package credit is marked **Package** in both the
  Records list and the patient's visit history, rather than the two
  different wordings it used before.

### 26 October 2026

#### Added
- **Show the QR straight from the bill.** The bill screen gains a QR button
  beside Void, Close and Send, so the flow is one tap: show the customer what
  they owe, then show them where to pay. If a payment method was picked while
  billing it opens that QR directly; if not, it opens whichever is set up and
  offers to switch. It stays hidden on estimates, on voided bills, and when
  no QR has been uploaded.

#### Changed
- **The discount note on a bill now names what the discount covers**, rather
  than what it misses — that is what a customer wants to check. It stays
  silent when the discount covers everything chargeable, names the category
  when the selection lines up with whole categories ("Discount applies to
  treatments only"), names the items when it does not, and falls back to a
  count once naming them would run long.
- The QR overlay moved into `js/qr.js`, shared by the Bill tab and the bill
  screen. Added to `ASSETS` in `sw.js`.

### 24 October 2026

Prepaid packages, and four changes to how billing works day to day.

#### Added
- **Prepaid value-credit packages.** She sells RM600 of credit for RM500. Two
  tiers ship as a starting point (RM500 → RM600 over 9 months, RM800 →
  RM1,000 over 12); both are editable in Setup, where each tier is three
  numbers: what she is paid, the credit it grants, and how long it lasts.
  Selling one is the same gesture as adding a treatment.
- **Credit is a payment method, not a price change.** Line items keep their
  real prices and the bill arithmetic is untouched. Credit comes off after
  rounding, so the deduction is a clean figure and the customer keeps the
  rounding benefit.
- **She taps to spend credit — it is never applied automatically.** Spending
  someone's balance without either of them deciding to is not a convenience,
  and there are good reasons to pay cash and keep the credit for later.
- **Partial redemption**, so a RM120 treatment against RM80 of credit leaves
  RM40 in cash. Credit is drawn from the package expiring soonest, which
  minimises forfeiture.
- **Family use.** Credit is transferable: "Use someone else's package" names
  the owner and confirms the amount before taking it. The record keeps both
  who was treated and whose credit paid.
- **Expired credit is never silently forfeited.** The package stops being
  spendable, the balance stays visible, and Extend gives it more time with a
  dated note of why. Months are counted from today when it has already
  lapsed, so extending always buys usable time.
- **Unredeemed credit** in Records: the total still owed in services, what is
  expiring within 60 days, and the balance per customer.
- **Sales now counts cash received**, with **Credit redeemed** beside it. A
  package sale counts on the day she is paid; a bill settled from credit
  counts nothing. Each ringgit is counted exactly once and the two figures
  reconcile.
- **Payment QR codes.** Upload the TnG and DuitNow QR images in Setup, and
  picking either method while billing shows a Show QR button that fills the
  screen. Images are scaled to 512px before saving so they don't bloat every
  backup. If you would rather keep them in the repo, drop `qr-tng.png` and
  `qr-duitnow.png` beside index.html and the app falls back to those.
- **CSV template** on the Patients tab — the exact columns the importer
  expects, with two example rows, so the format can be seen rather than
  guessed at.

#### Changed
- **The discount is now chosen per item.** Every line carries a `%` toggle;
  the four presets (Treatments, Treatments + consultation, Everything,
  Nothing) set them in one tap. Bills written before this release have no
  per-line flag and fall back to their stored category scope, so their
  totals, their printed notes and the CSV's per-line apportionment all stay
  exactly as they were.
- A discount typed against nothing selected now says so plainly instead of
  showing a row of zeros.
- **The bill number is printed on the bill**, as its first line. There is a
  Setup switch to turn it off. Estimates still carry no number, because
  nothing has been issued.
- Packages are never discountable and cannot be bought with credit — their
  toggle shows a dash rather than a control that would do nothing.
- Voiding is package-aware, in three cases: a bill that spent credit gives it
  back (even if that package has since expired); a bill that sold a package
  nothing has been spent from cancels it; and a bill that sold a package
  whose credit has already been spent **is refused**, naming the package and
  the amount, because voiding it would claw back credit the customer has
  used. All of it writes in one transaction.
- A fully-redeemed bill reads "credit" in the visit history rather than
  RM 0.00, which looks like a mistake.
- CSV export gains `line_in_discount`, `credit_applied` and `balance_due`,
  and drops `discount_applies_to` now that scope is per line.

#### Release checklist
Unchanged: `APP_VERSION` in `js/util.js`, `VERSION` in `sw.js`, and the
number in `version.json`. `js/packages.js` has been added to `ASSETS`.

### 17 October 2026

The app stops being only a bill book: a rebuild of how data is stored, and
the first features built on top of it.

#### Added
- **Patient records.** A Patients tab with search across name, phone and IC.
  Each patient carries the same fields as the Google Form intake — Name,
  IC No., Phone No., Gender, Address, Email — plus two it has no reason to
  hold: free-text **Alerts**, and a **Guardian** that appears by itself when
  the patient works out to be under 18.
- **IC numbers fill in the date of birth and gender.** Tab out of the IC field
  and both appear, as editable values rather than locked text. Anything that
  isn't a Malaysian IC — a passport, a foreign ID — is kept exactly as typed
  and derives nothing.
- **IC is masked everywhere except the patient's own screen**, shown as
  ••••••-••-5128 in lists and on bills.
- **Patient picker on the Bill tab.** Type to search, tap to attach. A walk-in
  with no record is still billed by typing a name, exactly as before.
- **Alerts appear before anything is charged** — on the patient's screen and
  again on the Bill tab the moment they're selected.
- **Visit history** on each patient: every bill, with voided ones struck
  through and left in place rather than hidden.
- **Link old bills.** Bills written before this release carry only a typed
  name. A one-time screen groups them by name and links each group to a
  patient, or makes a patient from one. Anything skipped stays as it is, and
  an unlinked bill is still a perfectly good bill.
- **CSV import** of the Google Form response sheet, with a preview that
  unticks anyone who already matches on IC or phone. Consent date comes from
  the form's own timestamp.
- **Encrypted backups.** AES-GCM with a passphrase set once in Setup. The
  backup now leaves the tablet with names, IC and phone numbers in it, so it
  is encrypted by default. A lost passphrase cannot be recovered.
- **Save backup now offers the share sheet**, which is how it reaches Drive in
  two taps, and Records shows how many days it has been.
- **Rolling local snapshots.** The last 14 daily states are kept on the tablet
  by the app itself, restorable from Setup. They protect against a bad edit;
  only a saved backup protects against losing the tablet.
- **Export this patient's record** — one file with their details and bills.
- Consent is recorded per patient as a date and a source (intake form, or
  recorded in person). The app never shows consent wording to anyone; this
  screen is hers, not the patient's.

#### Changed
- **Storage moved from localStorage to IndexedDB.** The old `cfg2`, `tx2` and
  `bills2` keys are read once on first launch and then deliberately left
  where they are, as a safety net, for a few releases.
- **The single file is now ES modules.** `index.html` carries only markup;
  styles live in `app.css` and the code in `js/*.js`. No build step.
- **The logo is a real file.** It was 195KB of base64 on one line, which was
  three quarters of the source and the main reason the file was unreadable.
- If IndexedDB can't be opened at all, the app falls back to the old storage
  so it never fails to take a bill. If the tablet has used IndexedDB before,
  it says plainly that the records on screen are an older copy and to stop
  entering bills — rather than quietly letting the two diverge.
- **Erase all bills no longer touches patients**, the price list or settings,
  and says so.
- CSV export gains `patient_no` and `patient_ic_last4`.
- Next patient number is settable in Setup, beside the bill number.

#### Release checklist
Unchanged, still three files: `APP_VERSION` in `js/util.js`, `VERSION` in
`sw.js`, and the number in `version.json`. `sw.js` now lists every module in
`ASSETS` — add to that list when a new module is added.

## v1.5 — 8 August 2026

### Added
- **Variable Treatments** as its own Setup category, with an "Add variable
  treatment" button. These work like Herbal Medicine: no fixed price, an
  adjustable price box on the Bill page, and a description line printed under
  the item on the bill. Herbal Medicine has moved into this category.
  They remain ordinary treatments everywhere else — same chip section when
  billing, same discount treatment, not separated on the estimate or bill.

### Changed
- The customer row on an issued bill is now labelled **Bill to**. Estimates keep
  **Customer**, since nothing is being billed yet.

## v1.4 — 8 August 2026

### Added
- **Update prompt.** The app checks a small `version.json` on launch, whenever
  it's brought back to the foreground, and every half hour. When a newer build
  has been published it shows a bar offering to reload, with a Later option. It
  warns before discarding a visit that's part-way entered, and it sits behind
  the bill overlay so it never appears while a customer is looking at a bill.

### Changed
- `sw.js` now derives its cache name from a single `VERSION` constant — bump
  that one line each release. `version.json` is excluded from caching so the
  update check always reflects what's actually published.

### Release checklist
Every upload should change three things together: `APP_VERSION` in
`index.html`, `VERSION` in `sw.js`, and the number in `version.json`.

## v1.3 — 8 August 2026

### Added
- **Whole-ringgit rounding.** Every total is rounded down to the nearest ringgit
  so there is never any change in coins to hand back. When rounding applies, the
  bill shows a "Rounded down" line beneath the subtotal, and the entry screen
  notes it above the total. Rounding is always in the customer's favour and
  never exceeds RM0.99.

### Changed
- CSV export gains a `bill_rounding` column. Note that `line_subtotal` values sum
  to `bill_subtotal` minus `bill_discount` — the rounding is a bill-level
  adjustment applied after that, not spread across the lines.
- Service worker cache stays at `qi-tcm-v2`; ships together with v1.1 and v1.2,
  neither of which was published.

## v1.2 — 8 August 2026

### Added
- **Payment method.** Cash, TnG, or DuitNow QR. Optional during billing, and
  settable afterwards from the Records list — which matches the real flow, where
  payment is agreed after the bill has been shown. Shown on the right of every
  row in Records for a glance-check, and exported as `payment_method`.

### Changed
- **Discount note now only names what's on the bill.** If a discount covers
  everything charged, no note appears at all. If consultation is charged but
  combos aren't, the note mentions consultation only.
- Service worker cache stays at `qi-tcm-v2`.

## v1.1 — 7 August 2026

### Added
- **Voiding.** An issued bill can be voided from its own screen. It stays in
  Records marked VOID, is excluded from every sales figure, and keeps its bill
  number. An optional reason is stored with it. Bills still cannot be edited —
  void and re-issue instead.
- **Backdated bills show both dates.** When a bill is entered after the fact,
  the header shows the visit date and time as well as the date the bill was
  issued, and the seal carries the issue date rather than the visit date.
- **Reporting periods in Records.** Today, this week (Monday start), this month,
  all time, or a custom date range. Sales, bill count, and voided count all
  follow the selected period, as does the list of bills.
- **Discount scope printed on the bill.**
- **Version number** shown at the bottom of Setup.

### Changed
- CSV export gains `status`, `voided_at`, and `void_reason` columns.
- Service worker cache bumped to `qi-tcm-v2`.

## v1.0 — August 2026

First deployed version. Tap-to-bill entry across consultation, treatments, and
combos; variable per-day pricing for herbal medicine; two-scope discounts;
estimates and sealed bills; backdating; WhatsApp image sharing; CSV export and
JSON backup; installable as an offline app.

# Warrant-source HTML fixtures

Raw, byte-exact results-page captures for the multi-source warrant-puller parsers.
Captured **2026-06-02** with a Chrome desktop User-Agent. Both sources are
**fetch-friendly** (server-rendered HTML obtainable with `curl` — no headless
browser, no CAPTCHA, no JS-injection of results).

Each capture is a two-step ASP.NET WebForms flow:
1. `GET` the search page → scrape `__VIEWSTATE`, `__VIEWSTATEGENERATOR`,
   `__EVENTVALIDATION` (and for Natrona `__SCROLLPOSITIONX/Y`,
   `__VIEWSTATEENCRYPTED`) out of the hidden inputs, keeping the response cookies.
2. `POST` those tokens back with the last name `SMITH` + the postback trigger,
   reusing the cookie jar.

> The `__VIEWSTATE` / `__EVENTVALIDATION` tokens are **single-use and
> session-bound** — they are baked into these fixtures only as a record of the
> capture. A live puller must always GET a fresh page first to mint new tokens;
> replaying these will fail validation.

---

## `ada-county.html`

- **Source URL:** https://apps.adacounty.id.gov/sheriff/reports/warrants.aspx
- **Method / params:** `POST` (full ASP.NET postback) with
  - `__EVENTTARGET=ctl00$ContentPlaceHolder1$btnFilter`
  - `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION` (from the prior GET)
  - `ctl00$ContentPlaceHolder1$txtLastName=SMITH`
  - `ctl00$ContentPlaceHolder1$txtFirstName=` (empty), `ctl00$ContentPlaceHolder1$txtPersonID=` (empty)
- **Capture:** 99 person records for last name SMITH (~1.25 MB).
- **Result-row structure:** one block per person.
  - **Name:** `<div class="myNameTitle"><strong>Last, First M</strong></div>`
  - **Demographics:** a following `<div class="info">` containing `Age: NN`.
  - **Mugshot:** inline base64 `<img class="img-rounded mugshot">`.
  - **Warrants:** a `<table class="charge table table-condensed table-responsive">`
    with a header row `Warrant #` | `Issued` | `Severity` | `Bond Amount`,
    then per-warrant `<tr class=" bg-warning">` whose four `<td class="...newChargeWarrantLine">`
    hold case number (e.g. `CR-MD-2007-1359-2`), issue date (`M/D/YYYY`),
    severity (`M`/`F`), and bond (`$3,000.00`). A trailing
    `<td colspan="4">` row carries the charge description(s) in an `<ul><li>`.
  - NOTE: each person block is duplicated for responsive layouts —
    a `.hidden-xs` desktop `<table>` and a `.visible-xs` mobile variant. Parse the
    `charge table table-condensed table-responsive` (desktop) form.

## `natrona.html`

- **Source URL:** https://warrants.natronacounty-wy.gov/
- **Method / params:** `POST` (full ASP.NET postback, image-button trigger) with
  - `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`,
    `__SCROLLPOSITIONX=0`, `__SCROLLPOSITIONY=0`, `__VIEWSTATEENCRYPTED=` (from the prior GET)
  - `ctl00$MainContent$txtNameSearch=SMITH`
  - `ctl00$MainContent$btnSearch2.x=10` & `ctl00$MainContent$btnSearch2.y=10`
    (image-button coordinate pair — this is what fires the search postback)
- **Capture:** "Found 18 Warrants containing the name 'SMITH'" (~28 KB).
- **Result-row structure:** a Bootstrap-grid listview, NOT a `<table>`.
  - **Result count banner:** `<span id="lblSearch">Found N Warrants containing the name '…'</span>`.
  - **Last updated:** `<span id="lblDate">M/D/YYYY h:mm:ss AM</span>`.
  - **Header row** `id="Tr1"` with column labels: `Name` | `Race` | `Gender` | `Age`.
  - **Each result row:** `<div class="row myrow listview_backcolor1|2 …">` containing four
    `<span>`s — `id="Label4"` = full name (`First Last`), `id="Label2"` = race,
    `id="Label9"` = sex, `id="Label14"` = age. The IDs repeat per row (ASP.NET
    ListView item template), so a parser must iterate rows, not match by id alone.
  - The listview container carries `d-none` (CSS-hidden until JS toggles display),
    but the row data is fully present in the server response bytes.
  - NOTE: this page lists matched **persons** with demographics only; per-warrant
    detail (charge / warrant # / bond) is reached via a per-person detail action,
    not present in this list view.

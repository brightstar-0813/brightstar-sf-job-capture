# Config, filters, and Sheets

Config loads via `dotenv` from project-root `.env` in `src/config.js`. Template: `.env.example`.

## Env groups

| Area | Keys |
|------|------|
| Runtime | `PORT`, `DATA_DIR`, `STORE_FILE`, `CSV_LATEST_FILE`, `HEADLESS`, `DELAY_MS`, `CRON_SCHEDULE` |
| Search | `SEARCH_Q`, `SEARCH_QUERIES`, `MAX_PAGES`, `SEARCH_EXTRA_PAGES`, `PAGE_SIZE`, `RECENT_DAYS`, `ROLE_TITLES`, `ROLE_PAGES`, `JOBRIGHT_TITLES`, `JOBRIGHT_MAX_PAGES`, `JOBICY_TAGS` |
| Source toggles | `CAPTURE_*` for every wired board |
| API keys | `USAJOBS_API_KEY`, `USAJOBS_USER_EMAIL`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `SERPAPI_KEY` |
| ATS boards | `GREENHOUSE_BOARDS`, `LEVER_BOARDS`, `ASHBY_BOARDS` (comma-separated tokens) |
| Auth paths | `JOBRIGHT_AUTH_PATH`, `DICE_AUTH_PATH`, `INDEED_AUTH_PATH`, `INDEED_PROFILE_DIR`, `INDEED_HEADED` |
| Bid-tracker | `EXCLUDE_BID_TRACKING_SHEET`, `BID_TRACKING_SHEET_URL`, `BID_TRACKING_SHEET_GID` |
| Warehouse | `SYNC_JOBS_SHEET`, `JOBS_SHEET_WEBAPP_URL`, `JOBS_SHEET_URL`, `JOBS_SHEET_NAME` |
| Slack | `SLACK_WEBHOOK_URL` |

### Search seeds

- `SEARCH_QUERIES` — Dice / Remotive / Himalayas / product-query feeds (Salesforce, Health Cloud, Data Cloud, …).
- `ROLE_TITLES` — Built In, Jobspresso, JobRight seeds (role titles, not bare "Salesforce").
- `JOBRIGHT_TITLES` — optional override; else JobRight uses `ROLE_TITLES`.
- First search query uses `MAX_PAGES`; extra queries use `SEARCH_EXTRA_PAGES`.

## Filter rules (`src/filter.js`)

Final gate: `captureRuleReason(job)` — returns a skip reason or `null` to keep.

**Keep when all pass:**

- Salesforce-ecosystem relevance (`containsSalesforce`) — title/product keywords or primary SF skill; a single CRM name-drop in a generic JD is not enough.
- Remote arrangement (`isRemoteArrangement`) — not hybrid/on-site.
- US-friendly location (`isUsFriendlyLocation`) — not Canada-only / EMEA / LATAM-only.
- Not a LinkedIn URL (`isLinkedinLink`).
- Posted within `RECENT_DAYS` (store prune + source-side freshness).

**Skip:**

- Employer is Salesforce-the-company or ICF (and variants).
- Sales titles (AE, AM, sales rep, sales force effectiveness, …) even when title also says Salesforce.
- Expired / no-longer-available banners; JobRight `isDeleted` / `hiddenJob`.
- Jobs whose Link/id is already on the bid-tracking sheet (capture path only).

Feeds also pre-filter via `keepFeedJob` in `src/feeds/keep.js`.

## Gotchas

- `bool(name, fallback)` — only the string `"false"` (case-insensitive) is false; `0`, `no`, empty-after-set quirks: any other non-empty value is **true**.
- `RECENT_DAYS` code default is **3**; `.env.example` suggests **7**. Set explicitly in `.env`.
- `/api/ingest` does **not** call sheet append or bid-tracker exclude.
- Cloudflare can empty ZipRecruiter / Monster / Indeed; keep fragile boards off unless debugging.
- Bid-tracker sheet must be shared **Anyone with the link can view** for CSV export exclude to work.

## Google Sheets

Three distinct paths:

### 1. Bid-tracker exclude (`src/sheet-exclude.js`)

- Public `export?format=csv` of the bid-tracker tab.
- Builds URL / board-id sets.
- Capture skips matching jobs and removes already-stored matches after the run.

### 2. Warehouse mirror (`src/sheet-append.js`)

- After every Node capture, `replaceJobsSheet(csvRows)` runs on the full `jobs_latest.csv`:
  1. `replaceWarehouse` (`rows: []`) clears the tab and writes headers.
  2. `appendWarehouse` POSTs each CSV row as `text/plain` JSON:
     `{ action: "appendWarehouse", spreadsheetId, sheetName, jobTitle, companyName, jobLink, jd, salary }`
- Columns: **Role | Company | Link | JD | Salary** (no Ready / Auto bid).
- Skipped (tab untouched) when the CSV is empty. Not run when the reset fails.
- Soft-fail with retries; ~400ms between rows. Clear-then-refill takes about 1–2 minutes for ~100 rows.
- `appendJobsToSheet` (append-only, link-deduped) is still used by `npm run sheet:sync`.

### 3. Bulk CSV sync (`src/sheet-sync-csv.js`)

```bash
npm run sheet:sync              # append from jobs_latest.csv
npm run sheet:replace           # replaceWarehouse then append with force
# or: node src/sheet-sync-csv.js --csv path/to/file.csv --replace
```

### Apps Script (`apps-script/Code.gs`)

- Bid-tracker actions: `append`, `markApplied`, `listLinks`, …
- Warehouse: `appendWarehouse`, `replaceWarehouse`
- After any `Code.gs` change: **Deploy → Manage deployments → Edit → New version** (see `apps-script/README.md`).
- Update `JOBS_SHEET_WEBAPP_URL` if the deployment URL changes.

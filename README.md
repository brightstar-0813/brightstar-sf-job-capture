# Salesforce Job Capture (multi-source)

Capture **remote Salesforce-ecosystem** jobs from **public APIs first** (Greenhouse / Lever / Ashby boards, Remotive, Jobicy, Remote OK, We Work Remotely, Working Nomads, Himalayas, Jobgether, Arbeitnow, USAJOBS, Adzuna, **Indeed mobile API**), plus Dice, JobRight, Built In, **SimplyHired** (Python helper), and optional Google Jobs (SerpAPI) **at 5 AM and 5 PM**. **ZipRecruiter / Monster / CareerBuilder / The Muse** are bot-blocked for headless Node and are **off by default** — use the Chrome extension for those.

Each run ends with a **source health** summary (`ok` / `empty` / `degraded` / `blocked` / `auth` / `error`). Unhealthy sources are flagged in the console, the Slack message, and `GET /api/status` (`sourceHealth`).

## What gets saved

Each run overwrites **one** combined CSV with the latest qualifying jobs from all sources:

- `download/jobs_latest.csv` — all sources together (`source` column marks Dice / JobRight / Built In / …). Sorted by **posting date newest first**, then **source priority** when the date matches; jobs without a date appear at the bottom. Each row has a `seq` number (1…n).
- `download/NN_{source}_jobs_latest.csv` — **one numbered CSV per source** (e.g. `01_builtin_…`, `02_himalayas_…`, `03_greenhouse_…`, `04_dice_…`) so files sort in apply-yield order; each file is newest-first
- `download/07_workday_jobs_latest.csv` — jobs whose apply URL is Workday (often from JobRight), any capture source
- `download/store.json` — shared dedupe history

**Source priority (fetch, CSV order, same title+company):** Built In → Himalayas → Greenhouse → Dice → Lever/Ashby → other boards → JobRight. **LinkedIn is not scraped.** JobRight listings whose apply/original URL is LinkedIn are **skipped** (not kept with a JobRight page URL either). LinkedIn URLs from any board are excluded from the store/CSV. JobRight apply URLs keep required query params (Indeed `jk=`, Greenhouse `token`/`gh_jid`); incomplete ATS shells fall back to the JobRight job page; Lever `…/apply` is stored as the posting page. JDs are built from JobRight summary + responsibilities + qualifications.

Filter (applied to all sources):

- **Keep:** the job is a **Salesforce-ecosystem** role — title or JD matches product keywords such as `Salesforce`, `Health Cloud`, `Data Cloud`, `Marketing Cloud`, `Service Cloud`, `Agentforce`, `OmniStudio`, `SFMC`, `NPSP`, `MuleSoft`, and similar — the job is **remote only** (not hybrid/on-site), location is US/worldwide (not Canada-only or EMEA/LATAM-only), and it was **posted within the last `RECENT_DAYS` days** (default 3 in code; use 7 in `.env` for apply-now freshness).
- A single passing CRM name-drop in a generic JD (`experience with Salesforce, HubSpot, or Dynamics`) is **not** enough; Salesforce must be in the title, a named product must appear, or Salesforce must be a primary skill.
- **Skip:** jobs at the **Salesforce** company itself, **ICF** (and ICF International / Consulting Group), **hybrid/on-site** roles, **sales titles** (account executive, account manager, sales representative, sales force effectiveness, sales force management, regional sales) even when the title also says Salesforce, **expired / no-longer-available** postings (Dice banner text; JobRight `isDeleted`/`hiddenJob`), and postings **older than `RECENT_DAYS`** (they also age out of the store/CSVs on each run).
- **Skip (already applied / resume built):** jobs whose **Link** is already on the bid-tracking Google Sheet (`BID_TRACKING_SHEET_URL`) — matched by URL / board job id.

## How automation is split (recommended)

| Source | How it runs | Notes |
|--------|-------------|-------|
| **Dice** | Windows Task Scheduler | Anonymous Playwright scrape (no login). Searches `SEARCH_QUERIES` (Salesforce, Health Cloud, Data Cloud, …) |
| **JobRight** | Scheduler + `/swan` API, anonymous fallback | Saved login (`npm run jobright:login`): seeds `ROLE_TITLES` (or `JOBRIGHT_TITLES`), `count=20`, pages up to `JOBRIGHT_MAX_PAGES`. No/expired session: public search pages, newest ~20 per title (health `degraded`) |
| **Built In** | Scheduler (Playwright) | Remote search of `ROLE_TITLES` with `allLocations=true` (otherwise Built In scopes "remote" to the requester's IP country), `ROLE_PAGES` each (default 2). Non-US "Hiring Remotely in …" roles are dropped |
| **Indeed** | Scheduler (mobile GraphQL API) | No browser or login. `SEARCH_QUERIES` (multi-word phrase-quoted), location Remote, last `RECENT_DAYS`, 100 per page up to `INDEED_MAX_PAGES` (default 5). `INDEED_MODE=browser` restores the old Playwright scrape |
| **SimplyHired** | Scheduler (Python `curl_cffi` helper) | Node/Playwright get a Cloudflare 403; the helper's Safari-iOS TLS fingerprint passes. Searches `ROLE_TITLES` (or `SIMPLYHIRED_QUERIES`), `SIMPLYHIRED_PAGES` each. Needs `npm run py:setup` once |
| **Greenhouse / Lever / Ashby** | Scheduler (public company-board APIs) | Direct from employer career sites — Salesforce ISVs, partners, and companies that hire SF admins/devs (`GREENHOUSE_BOARDS`, `LEVER_BOARDS`, `ASHBY_BOARDS`) |
| **Remotive / Jobicy / Remote OK / We Work Remotely / Working Nomads / Jobspresso / SkipTheDrive / Arc.dev** | Scheduler (public JSON, RSS, or listing pages) | No browser. Jobspresso searches `ROLE_TITLES` (`ROLE_PAGES` each). SkipTheDrive and Arc.dev read public search pages for `SEARCH_QUERIES` |
| **Himalayas / Jobgether / Arbeitnow** | Scheduler (public JSON APIs) | No browser. Jobgether’s offer API; Himalayas remote search. Arbeitnow is EU-heavy so few US hits. |
| **USAJOBS / Adzuna** | Scheduler (public APIs, optional keys) | Federal remote roles (USAJOBS) and US aggregator (Adzuna). Free keys at [developer.usajobs.gov](https://developer.usajobs.gov) and [developer.adzuna.com](https://developer.adzuna.com). Skipped until keys are set. |
| **Google Jobs** | Scheduler (SerpAPI, optional) | Google has no free Jobs API. Set `SERPAPI_KEY` to enable. |
| **ZipRecruiter / Monster / CareerBuilder** | Chrome extension (Playwright adapters kept) | **Off by default** — Cloudflare (Zip) and DataDome (Monster, CareerBuilder) block headless Node, including their JSON APIs. |
| **The Muse** | — | **Off by default** — public API returns 404 / Cloudflare. |

Glassdoor (Cloudflare-blocked) and other JobSpy-only niche remotes are **not scraped** (legacy `source` labels may still appear in `store.json` / CSV from older runs).

### Indeed (mobile API)

`CAPTURE_INDEED=true` + `INDEED_MODE=api` (defaults) query `apis.indeed.com/graphql` — the endpoint the Indeed iOS app (and python-jobspy) uses. No browser, login, or Cloudflare. Set `INDEED_MODE=browser` to use the legacy Playwright scraper (`npm run indeed:login` once).

### JobRight (login + anonymous fallback)

1. Run `npm run jobright:login` once — a browser opens; sign in, then press Enter. Cookies are saved to `JOBRIGHT_AUTH_PATH` (the session lasts ~60 days).
2. Each run calls **`POST /swan/recommend/search`** with those cookies (remote + recency filters, pages of 20 up to `JOBRIGHT_MAX_PAGES`).
3. If the session is missing or rejected (HTTP 401 / `errorCode` 41001), capture **warns** and falls back to JobRight's public search pages: newest ~20 jobs per title, no filters or paging, about 30 titles per run before JobRight's rate-limit challenge. Remote / Salesforce / recency filters still apply locally. Health shows `degraded` — re-run `npm run jobright:login`.

### SimplyHired (Python helper)

Run `npm run py:setup` once (creates/repairs `.venv-jobspy` and installs `curl_cffi`). Capture spawns `scripts/simplyhired_fetch.py` with `PYTHON_BIN` (default `.venv-jobspy/Scripts/python.exe`). If Python is missing the source reports `error` and the rest of the run continues.

Export CSV from `download/jobs_latest.csv`, numbered per-source files like `download/05_dice_jobs_latest.csv`, or `http://127.0.0.1:3847/api/export.csv` (optional `?source=dice`). Full multi-board capture still runs from Task Scheduler / `npm run capture`.

## Fully automatic — 5 AM and 5 PM (Windows)

Install **both** scheduled tasks (Dice capture + API at logon):

```bash
npm run schedule:install
```

| Task | What it does |
|------|----------------|
| `DiceJobCapture_5am5pm` | Runs capture at **5 AM and 5 PM** local, every day |
| `DiceJobCapture_API_AtLogon` | Starts `node src/server.js` when you log in (local API + cron) |

You do **not** need to open Cursor or type `npm start` after that.

Optional checks:

```powershell
Get-ScheduledTask -TaskName DiceJobCapture_5am5pm, DiceJobCapture_API_AtLogon
Start-ScheduledTask -TaskName DiceJobCapture_API_AtLogon
Start-ScheduledTask -TaskName DiceJobCapture_5am5pm
```

Individual installs: `npm run schedule:dice` or `npm run schedule:api`.

## Manual run

```bash
npm run capture
```

## Local API + extension (two parallel paths)

```bash
npm start
```

Then load `extension/` unpacked in Chrome (`chrome://extensions` → Developer mode → Load unpacked → `extension/`).

| Path | What it does | How you choose it |
|------|----------------|-------------------|
| **Node API / Playwright / feeds** | Scheduled `npm run capture`, cron, `POST /api/run` | `.env` `CAPTURE_*` flags — unchanged |
| **Extension DOM** | Logged-in Chrome scrapes Indeed / ZipRecruiter / Monster / CareerBuilder (+ optional JobRight `/swan` in-page) | Extension popup source checkboxes, Options, or `POST /api/extension/capture` |

Running one path does **not** disable the other. Prefer the extension for Zip / Monster / CareerBuilder when you are signed in (Node has those off by default). Indeed is covered by the Node mobile-API adapter.

Popup: select sources → **Start** / **Stop** / **Resume**. On CAPTCHA / login / Cloudflare the badge shows `!` — complete the challenge, then **Resume**. Offline ingest batches buffer in extension storage and retry (**Flush buffer**). Options: queries, pages, schedule hours, dry-run, bid-tracker exclude.

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Last run, CSV paths, `sourceHealth` from the last capture |
| `GET /api/jobs?status=new` | New jobs |
| `POST /api/run` | Trigger Node capture |
| `POST /api/ingest` | Extension posts jobs (`source`, `trusted`, `excludeBidTracking`) |
| `POST /api/extension/capture` | Queue extension sources (`indeed`, `ziprecruiter`, `monster`, `careerbuilder`, `jobright`) |
| `GET /api/extension/poll` | Extension polls for queued work |
| `GET /api/extension/status` | Allowed extension sources + queue |
| `GET /api/export.csv` | Download the combined CSV |

## Env highlights

| Key | Meaning |
|-----|---------|
| `CAPTURE_DICE` | `true`/`false` |
| `CAPTURE_JOBRIGHT` | JobRight via `/swan` API with saved login, anonymous fallback (`true` by default) |
| `CAPTURE_INDEED` / `INDEED_MODE` / `INDEED_MAX_PAGES` | Indeed mobile GraphQL (`true`, `api`, `5`); `browser` = legacy Playwright |
| `CAPTURE_SIMPLYHIRED` / `PYTHON_BIN` / `SIMPLYHIRED_QUERIES` / `SIMPLYHIRED_PAGES` | SimplyHired via the Python `curl_cffi` helper (`true`; venv python; `ROLE_TITLES`; `1`) |
| `CAPTURE_REMOTIVE` / `CAPTURE_JOBICY` / `CAPTURE_REMOTEOK` / `CAPTURE_WWR` | Public JSON/RSS (`true` by default) |
| `CAPTURE_THEMUSE` | `false` by default (API discontinued / blocked) |
| `CAPTURE_HIMALAYAS` / `CAPTURE_JOBGETHER` / `CAPTURE_ARBEITNOW` | Extra public JSON APIs (`true` by default) |
| `CAPTURE_GOOGLEJOBS` / `SERPAPI_KEY` | Google Jobs via SerpAPI (skipped until a key is set) |
| `CAPTURE_LEVER` / `CAPTURE_ASHBY` | Company career boards on Lever / Ashby (`true` by default) |
| `GREENHOUSE_BOARDS` / `LEVER_BOARDS` / `ASHBY_BOARDS` | Comma-separated company board tokens to poll |
| `CAPTURE_ZIPRECRUITER` / `CAPTURE_MONSTER` / `CAPTURE_CAREERBUILDER` | Playwright boards — off by default (bot-blocked); use the extension |
| `JOBICY_TAGS` | Jobicy API tags (default `salesforce,crm,mulesoft,apex`) |
| `SEARCH_QUERIES` | Comma-separated Dice/Remotive/Himalayas product searches (default includes Health Cloud, Data Cloud, Marketing Cloud, Service Cloud, Agentforce, OmniStudio, Salesforce CPQ). Built In and Jobspresso use `ROLE_TITLES` instead |
| `ROLE_TITLES` | Comma-separated role seeds for Built In, Jobspresso, and JobRight (32 Salesforce role titles by default). A bare "Salesforce" query is not used on those boards |
| `ROLE_PAGES` | Pages per role title on Built In and Jobspresso (default `2`) |
| `JOBRIGHT_TITLES` | Optional override of the JobRight seed list. When unset, JobRight uses `ROLE_TITLES` |
| `JOBRIGHT_MAX_PAGES` | JobRight pages per seed title, 20 results each (default `5`) |
| `EXCLUDE_BID_TRACKING_SHEET` / `BID_TRACKING_SHEET_URL` | Skip jobs whose Link is already on the bid-tracking sheet |
| `SYNC_JOBS_SHEET` / `JOBS_SHEET_WEBAPP_URL` / `JOBS_SHEET_URL` / `JOBS_SHEET_NAME` | After each Node capture, **mirror** `jobs_latest.csv` to the `US-SF-Jobs` warehouse tab (`Role`, `Company`, `Link`, `JD`, `Salary`): clear the tab, then append every CSV row. Older jobs drop off the tab. Skipped when the CSV is empty. No Ready/Auto bid. Redeploy [`apps-script/Code.gs`](apps-script/Code.gs) so `replaceWarehouse` / `appendWarehouse` are live |
| `CSV_PREFIX_DICE` / `CSV_PREFIX_JOBRIGHT` | Dated filename prefixes (legacy) |
| Per-source latest CSVs | `download/NN_{source}_jobs_latest.csv` (fixed sequence) plus Workday URL view; each file has a `seq` column |
| `DATA_DIR` | Output folder (`download`) |
| `CRON_SCHEDULE` | Used by `npm start` only (default `0 5,17 * * *` = 5 AM and 5 PM) |

## Notes

- Personal job-hunting use; polite delays / page caps.
- LinkedIn is not scraped; JobRight listings that apply via LinkedIn are skipped; LinkedIn URLs from any board are excluded from the store/CSV.

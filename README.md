# Salesforce Job Capture (multi-source)

Capture **remote Salesforce-ecosystem** jobs from Dice, JobRight, Built In, company career boards (Greenhouse / Lever / Ashby), Remotive, Jobicy, Remote OK, We Work Remotely, Himalayas, Jobgether, Arbeitnow, ZipRecruiter, Monster, CareerBuilder, and optional Google Jobs **every 8 hours**, append/dedupe locally, update one combined CSV, and Slack-notify on new jobs.

## What gets saved

Each run overwrites **one** combined CSV with the latest qualifying jobs from all sources:

- `download/jobs_latest.csv` — all sources together (`source` column marks Dice / JobRight / Built In / …). Rows posted in the last **24 hours** are sorted to the top (newest first); then by preferred source. Each row has a `seq` number (1…n).
- `download/NN_{source}_jobs_latest.csv` — **one numbered CSV per source** (e.g. `01_greenhouse_…`, `05_dice_…`, `09_jobright_…`) so files sort in a fixed sequence
- `download/04_workday_jobs_latest.csv` — jobs whose apply URL is Workday (often from JobRight), any capture source
- `download/store.json` — shared dedupe history

**Source priority (same title+company):** Greenhouse/Lever/Ashby → Indeed → Dice → ZipRecruiter → Glassdoor → Built In → other aggregators → JobRight. **LinkedIn is not scraped.** JobRight listings whose apply/original URL is LinkedIn are **skipped** (not kept with a JobRight page URL either). LinkedIn URLs from any board are excluded from the store/CSV. JobRight apply URLs keep required query params (Indeed `jk=`, Greenhouse `token`/`gh_jid`); incomplete ATS shells fall back to the JobRight job page; Lever `…/apply` is stored as the posting page. JDs are built from JobRight summary + responsibilities + qualifications.

Filter (applied to all sources):

- **Keep:** the job is a **Salesforce-ecosystem** role — title or JD matches product keywords such as `Salesforce`, `Health Cloud`, `Data Cloud`, `Marketing Cloud`, `Service Cloud`, `Agentforce`, `OmniStudio`, `SFMC`, `NPSP`, `MuleSoft`, and similar — the job is **remote only** (not hybrid/on-site), location is US/worldwide (not Canada-only or EMEA/LATAM-only), and it was **posted within the last `RECENT_DAYS` days** (default 3 in code; use 7 in `.env` for apply-now freshness).
- A single passing CRM name-drop in a generic JD (`experience with Salesforce, HubSpot, or Dynamics`) is **not** enough; Salesforce must be in the title, a named product must appear, or Salesforce must be a primary skill.
- **Skip:** jobs at the **Salesforce** company itself, **hybrid/on-site** roles, **expired / no-longer-available** postings (Dice banner text; JobRight `isDeleted`/`hiddenJob`), and postings **older than `RECENT_DAYS`** (they also age out of the store/CSVs on each run).
- **Skip (already applied / resume built):** jobs whose **Link** is already on the bid-tracking Google Sheet (`BID_TRACKING_SHEET_URL`) — matched by URL / board job id — plus jobs you've already applied to on JobRight / Dice.

## How automation is split (recommended)

| Source | How it runs | Notes |
|--------|-------------|-------|
| **Dice** | Windows Task Scheduler | Optional login for applied-job exclusion. Searches `SEARCH_QUERIES` (Salesforce, Health Cloud, Data Cloud, …) |
| **JobRight** | Scheduler + `/swan` API (saved login) | `npm run jobright:login` once — **no Chrome extension or JobRight UI tabs** during capture |
| **Built In** | Scheduler (Playwright) | Remote + keyword search; skips listings whose titles aren't Salesforce-related |
| **Greenhouse / Lever / Ashby** | Scheduler (public company-board APIs) | Direct from employer career sites — Salesforce ISVs, partners, and companies that hire SF admins/devs (`GREENHOUSE_BOARDS`, `LEVER_BOARDS`, `ASHBY_BOARDS`) |
| **Remotive / Jobicy / Remote OK / We Work Remotely** | Scheduler (public JSON/RSS) | No browser; not Cloudflare-gated — extra recent remote listings |
| **Himalayas / Jobgether / Arbeitnow** | Scheduler (public JSON APIs) | No browser. Jobgether’s offer API; Himalayas remote search. Arbeitnow is EU-heavy so few US hits. |
| **Google Jobs** | Scheduler (SerpAPI, optional) | Google has no free Jobs API. Set `SERPAPI_KEY` to enable. |
| **ZipRecruiter / Monster / CareerBuilder** | Scheduler (Playwright) | Often Cloudflare/bot-blocked in headless — may return 0; expired listings are skipped. **Indeed is off by default** (`CAPTURE_INDEED=false`) |

### Optional: skip already-applied Dice jobs

Dice capture works logged-out, but to also **exclude jobs you've already applied to on Dice**, save a one-time session:

```bash
npm run dice:login
```

A browser opens — sign in, land on your dashboard, press Enter. The session is saved to `download/dice-auth.json` and reused on every run. When it expires you'll get a Slack alert to re-run `npm run dice:login` (Dice capture keeps working meanwhile, just without applied-job exclusion).

### Indeed (disabled by default)

Indeed scraping is **off** (`CAPTURE_INDEED=false`). To re-enable: set `CAPTURE_INDEED=true`, run `npm run indeed:login` once (Cloudflare), then capture. JobRight apply links that point at Indeed are still kept when complete.

### JobRight (API-only — recommended)

JobRight is fetched via **`POST /swan/recommend/search`** using cookies saved by a one-time login. No Chrome extension and no JobRight search pages are opened during scheduled capture.

```bash
npm run jobright:login
```

Sign in once in the browser window, press Enter. Cookies are saved to `download/jobright-auth.json` and reused on every run. Re-run when capture logs say the session expired.

Set `CAPTURE_JOBRIGHT=true` (default). The Chrome extension under `extension/` is **optional** legacy — you do not need it for JobRight.

### Chrome extension (optional)

The extension can still post JobRight jobs using your Chrome cookies if you prefer that path. **LinkedIn is not fetched.** Most users should use API-only JobRight above instead.

1. Stay signed in to [jobright.ai](https://jobright.ai) in Chrome
2. API auto-starts at Windows logon (`npm run schedule:api`)
3. Load `extension/` unpacked in Chrome if you want extension-based JobRight

Export CSV from `download/jobs_latest.csv`, numbered per-source files like `download/05_dice_jobs_latest.csv`, or `http://127.0.0.1:3847/api/export.csv` (optional `?source=dice`). Full multi-board capture still runs from Task Scheduler / `npm run capture`.

## Fully automatic — every 8 hours (Windows)

Install **both** scheduled tasks (Dice capture + API at logon):

```bash
npm run schedule:install
```

| Task | What it does |
|------|----------------|
| `DiceJobCapture_Every8Hours` | Runs capture every **8 hours** (12 AM, 8 AM, 4 PM local) |
| `DiceJobCapture_API_AtLogon` | Starts `node src/server.js` when you log in (local API + cron) |

You do **not** need to open Cursor or type `npm start` after that — run `npm run jobright:login` once for JobRight. Chrome extension is optional.

Optional checks:

```powershell
Get-ScheduledTask -TaskName DiceJobCapture_Every8Hours, DiceJobCapture_API_AtLogon
Start-ScheduledTask -TaskName DiceJobCapture_API_AtLogon
Start-ScheduledTask -TaskName DiceJobCapture_Every8Hours
```

Individual installs: `npm run schedule:dice` or `npm run schedule:api`.

## Manual run

```bash
npm run capture
```

## Local API + extension

```bash
npm start
```

Then load `extension/` unpacked in Chrome.

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Last run, CSV paths |
| `GET /api/jobs?status=new` | New jobs |
| `POST /api/run` | Trigger Dice capture (Node) |
| `POST /api/ingest` | Extension posts JobRight jobs |
| `GET /api/export.csv` | Download the combined CSV |

## Env highlights

| Key | Meaning |
|-----|---------|
| `CAPTURE_DICE` | `true`/`false` |
| `CAPTURE_JOBRIGHT` | JobRight via `/swan` API + `jobright-auth.json` (`true` by default). Extension not required |
| `CAPTURE_REMOTIVE` / `CAPTURE_JOBICY` / `CAPTURE_REMOTEOK` / `CAPTURE_WWR` | Extra JSON/RSS sources (`true` by default) |
| `CAPTURE_HIMALAYAS` / `CAPTURE_JOBGETHER` / `CAPTURE_ARBEITNOW` | Extra public JSON APIs (`true` by default) |
| `CAPTURE_GOOGLEJOBS` / `SERPAPI_KEY` | Google Jobs via SerpAPI (skipped until a key is set) |
| `CAPTURE_LEVER` / `CAPTURE_ASHBY` | Company career boards on Lever / Ashby (`true` by default) |
| `GREENHOUSE_BOARDS` / `LEVER_BOARDS` / `ASHBY_BOARDS` | Comma-separated company board tokens to poll |
| `CAPTURE_INDEED` / `CAPTURE_CAREERBUILDER` | Extra Playwright boards. Indeed defaults **off**; CareerBuilder defaults on |
| `SEARCH_QUERIES` | Comma-separated Dice/Built In/Remotive searches (default includes Health Cloud, Data Cloud, Marketing Cloud, Service Cloud, Agentforce, OmniStudio, Salesforce CPQ) |
| `EXCLUDE_BID_TRACKING_SHEET` / `BID_TRACKING_SHEET_URL` | Skip jobs whose Link is already on the bid-tracking sheet |
| `JOBRIGHT_AUTH_PATH` | Playwright login state |
| `CSV_PREFIX_DICE` / `CSV_PREFIX_JOBRIGHT` | Dated filename prefixes (legacy) |
| Per-source latest CSVs | `download/NN_{source}_jobs_latest.csv` (fixed sequence) plus Workday URL view; each file has a `seq` column |
| `DATA_DIR` | Output folder (`download`) |
| `CRON_SCHEDULE` | Used by `npm start` only (default `0 */8 * * *` = every 8 hours) |

## Notes

- Personal job-hunting use; polite delays / page caps.
- After JobRight UI changes, re-run `npm run jobright:login` if autofill jobs stop appearing.
- LinkedIn is not scraped; JobRight listings that apply via LinkedIn are skipped; LinkedIn URLs from any board are excluded from the store/CSV.

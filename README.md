# Salesforce Job Capture (multi-source)

Capture **remote Salesforce-ecosystem** jobs from Dice, JobRight, Built In, company career boards (Greenhouse / Lever / Ashby), Remotive, Jobicy, Remote OK, We Work Remotely, Himalayas, Jobgether, Arbeitnow, ZipRecruiter, Monster, Indeed, CareerBuilder, and optional Google Jobs **twice daily (5:00 AM and 5:00 PM local time)**, append/dedupe locally, update one combined CSV, and Slack-notify on new jobs.

## What gets saved

Each run overwrites **one** combined CSV with the latest qualifying jobs from all sources:

- `download/jobs_latest.csv` — all sources together (`source` column marks Dice / JobRight / Built In / …). Rows posted in the last **24 hours** are sorted to the top (newest first); then by preferred source.
- `download/store.json` — shared dedupe history

**Source priority (same title+company):** Greenhouse/Lever/Ashby → Indeed → Dice → ZipRecruiter → Glassdoor → Built In → other aggregators → JobRight. **LinkedIn is not scraped.** JobRight listings whose apply/original URL is LinkedIn are **skipped** (not kept with a JobRight page URL either). LinkedIn URLs from any board are excluded from the store/CSV.

Filter (applied to all sources):

- **Keep:** the job is a **Salesforce-ecosystem** role — title or JD matches product keywords such as `Salesforce`, `Health Cloud`, `Data Cloud`, `Marketing Cloud`, `Service Cloud`, `Agentforce`, `OmniStudio`, `SFMC`, `NPSP`, `MuleSoft`, and similar — the job is **remote only** (not hybrid/on-site), location is US/worldwide (not Canada-only or EMEA/LATAM-only), and it was **posted within the last `RECENT_DAYS` days** (default 3 in code; use 7 in `.env` for apply-now freshness).
- A single passing CRM name-drop in a generic JD (`experience with Salesforce, HubSpot, or Dynamics`) is **not** enough; Salesforce must be in the title, a named product must appear, or Salesforce must be a primary skill.
- **Skip:** jobs at the **Salesforce** company itself, **hybrid/on-site** roles, **expired / no-longer-available** postings (Dice banner text; JobRight `isDeleted`/`hiddenJob`), and postings **older than `RECENT_DAYS`** (they also age out of the store/CSVs on each run).
- **Skip (already applied / resume built):** jobs whose **Link** is already on the bid-tracking Google Sheet (`BID_TRACKING_SHEET_URL`) — matched by URL / board job id — plus jobs you've already applied to on JobRight / Dice.

## How automation is split (recommended)

| Source | How it runs | Notes |
|--------|-------------|-------|
| **Dice** | Windows Task Scheduler | Optional login for applied-job exclusion. Searches `SEARCH_QUERIES` (Salesforce, Health Cloud, Data Cloud, …) |
| **JobRight** | Scheduler + saved Playwright login (or Chrome extension) | Needs `npm run jobright:login` (or use the logged-in extension) |
| **Built In** | Scheduler (Playwright) | Remote + keyword search; skips listings whose titles aren't Salesforce-related |
| **Greenhouse / Lever / Ashby** | Scheduler (public company-board APIs) | Direct from employer career sites — Salesforce ISVs, partners, and companies that hire SF admins/devs (`GREENHOUSE_BOARDS`, `LEVER_BOARDS`, `ASHBY_BOARDS`) |
| **Remotive / Jobicy / Remote OK / We Work Remotely** | Scheduler (public JSON/RSS) | No browser; not Cloudflare-gated — extra recent remote listings |
| **Himalayas / Jobgether / Arbeitnow** | Scheduler (public JSON APIs) | No browser. Jobgether’s offer API; Himalayas remote search. Arbeitnow is EU-heavy so few US hits. |
| **Google Jobs** | Scheduler (SerpAPI, optional) | Google has no free Jobs API. Set `SERPAPI_KEY` to enable. |
| **ZipRecruiter / Monster / Indeed / CareerBuilder** | Scheduler (Playwright) | Often Cloudflare/bot-blocked in headless — may return 0; expired listings are skipped. Indeed searches all `SEARCH_QUERIES` (deep pages on first query) after `npm run indeed:login` |

### Optional: skip already-applied Dice jobs

Dice capture works logged-out, but to also **exclude jobs you've already applied to on Dice**, save a one-time session:

```bash
npm run dice:login
```

A browser opens — sign in, land on your dashboard, press Enter. The session is saved to `download/dice-auth.json` and reused on every run. When it expires you'll get a Slack alert to re-run `npm run dice:login` (Dice capture keeps working meanwhile, just without applied-job exclusion).

### Indeed (Cloudflare)

Indeed blocks headless Chrome until you complete their check once:

```bash
npm run indeed:login
```

A Chrome window opens. Pass the verification (sign in if asked) until Salesforce job cards are visible, then press Enter. Capture reuses `download/indeed-profile`. Re-run login when the log says Cloudflare challenge.

### Logged-in Chrome extension (JobRight)

The extension opens temporary background tabs using **your existing Chrome cookies** and posts qualifying JobRight jobs to the local API (JobRight `/swan/…`). **LinkedIn is not fetched.** JobRight jobs that redirect/apply via LinkedIn are skipped.

**Requirements for extension auto-capture:**

1. Stay signed in to [jobright.ai](https://jobright.ai) in Chrome
2. API auto-starts at Windows logon (`npm run schedule:api`) — no manual `npm start`
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repo’s `extension/` folder
4. After code updates, click **Reload** on the extension
5. Optional: click the toolbar icon once to run JobRight now (badge shows `OK` / `!`). There is no popup UI — capture is scheduled at 5 AM and 5 PM while Chrome is open.

Export CSV from `download/jobs_latest.csv` or `http://127.0.0.1:3847/api/export.csv`. Full multi-board capture still runs from Task Scheduler / `npm run capture`.

## Fully automatic — daily at 5 AM and 5 PM (Windows)

Install **both** scheduled tasks (Dice capture + API at logon):

```bash
npm run schedule:install
```

| Task | What it does |
|------|----------------|
| `DiceJobCapture_5am5pm` | Runs capture daily at **5:00 AM** and **5:00 PM** (local time) |
| `DiceJobCapture_API_AtLogon` | Starts `node src/server.js` when you log in (so extension sources can ingest) |

You do **not** need to open Cursor or type `npm start` after that — just reboot/login once, stay signed in to JobRight in Chrome, and keep the extension loaded.

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
| `CAPTURE_JOBRIGHT` | Playwright JobRight (`false` = use extension) |
| `CAPTURE_REMOTIVE` / `CAPTURE_JOBICY` / `CAPTURE_REMOTEOK` / `CAPTURE_WWR` | Extra JSON/RSS sources (`true` by default) |
| `CAPTURE_HIMALAYAS` / `CAPTURE_JOBGETHER` / `CAPTURE_ARBEITNOW` | Extra public JSON APIs (`true` by default) |
| `CAPTURE_GOOGLEJOBS` / `SERPAPI_KEY` | Google Jobs via SerpAPI (skipped until a key is set) |
| `CAPTURE_LEVER` / `CAPTURE_ASHBY` | Company career boards on Lever / Ashby (`true` by default) |
| `GREENHOUSE_BOARDS` / `LEVER_BOARDS` / `ASHBY_BOARDS` | Comma-separated company board tokens to poll |
| `CAPTURE_INDEED` / `CAPTURE_CAREERBUILDER` | Extra Playwright boards (`true` by default). Indeed needs `npm run indeed:login` |
| `SEARCH_QUERIES` | Comma-separated Dice/Built In/Remotive searches (default includes Health Cloud, Data Cloud, Marketing Cloud, Service Cloud, Agentforce, OmniStudio, Salesforce CPQ) |
| `EXCLUDE_BID_TRACKING_SHEET` / `BID_TRACKING_SHEET_URL` | Skip jobs whose Link is already on the bid-tracking sheet |
| `JOBRIGHT_AUTH_PATH` | Playwright login state |
| `CSV_PREFIX_DICE` / `CSV_PREFIX_JOBRIGHT` | Dated filename prefixes |
| `DATA_DIR` | Output folder (`download`) |
| `CRON_SCHEDULE` | Used by `npm start` only |

## Notes

- Personal job-hunting use; polite delays / page caps.
- After JobRight UI changes, re-run `npm run jobright:login` if autofill jobs stop appearing.
- LinkedIn is not scraped; JobRight listings that apply via LinkedIn are skipped; LinkedIn URLs from any board are excluded from the store/CSV.

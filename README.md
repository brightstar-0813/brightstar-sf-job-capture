# Salesforce Job Capture (multi-source)

Capture **remote Salesforce** jobs from Dice, JobRight, Built In, Greenhouse, ZipRecruiter, and Monster every 8 hours, append/dedupe locally, write **dated CSVs**, and Slack-notify on new jobs.

## What gets saved

Each run overwrites **one** combined CSV with the latest qualifying jobs from all sources:

- `download/jobs_latest.csv` — all sources together (`source` column marks Dice / JobRight / Built In / …)
- `download/store.json` — shared dedupe history

Filter (applied to all sources):

- **Keep:** title or JD contains the word `Salesforce`, the job is **remote only** (not hybrid/on-site), and it was **posted within the last `RECENT_DAYS` days** (default 3).
- **Skip:** jobs at the **Salesforce** company itself, **hybrid/on-site** roles, **LinkedIn** apply/redirect links, **expired / no-longer-available** postings (Dice banner text; JobRight `isDeleted`/`hiddenJob`), and postings **older than `RECENT_DAYS`** (they also age out of the store/CSVs on each run).
- **Skip (already applied):** jobs you've **already applied to** — JobRight via `POST /swan/job/applied/jobs-v3`, and **Dice** via the *My Jobs → Applied* tab (needs a saved Dice login, see below). Applied jobs are skipped during capture and removed from the local store each run.

## How automation is split (recommended)

| Source | How it runs | Notes |
|--------|-------------|-------|
| **Dice** | Windows Task Scheduler | Optional login for applied-job exclusion |
| **JobRight** | Scheduler + saved Playwright login (or Chrome extension) | Needs `npm run jobright:login` |
| **Built In** | Scheduler (Playwright) | Reliable; remote + keyword search |
| **Greenhouse** | Scheduler (public board API) | No login; polls curated company boards (`GREENHOUSE_BOARDS`) |
| **ZipRecruiter** | Scheduler (Playwright) | Often Cloudflare-blocked in headless — may return 0 |
| **Monster** | Scheduler (Playwright) | Often empty/blocked in headless — may return 0 |

### Optional: skip already-applied Dice jobs

Dice capture works logged-out, but to also **exclude jobs you've already applied to on Dice**, save a one-time session:

```bash
npm run dice:login
```

A browser opens — sign in, land on your dashboard, press Enter. The session is saved to `download/dice-auth.json` and reused on every run. When it expires you'll get a Slack alert to re-run `npm run dice:login` (Dice capture keeps working meanwhile, just without applied-job exclusion).

### Why the extension for JobRight?

Autofill buttons only show when you are signed in. The extension opens JobRight in a background tab using **your existing Chrome cookies**, scrapes autofill jobs, and posts them to the local API. No `jobright:login` / Playwright auth file needed.

**Requirements for JobRight auto-capture:**

1. Stay signed in to [jobright.ai](https://jobright.ai) in Chrome  
2. API auto-starts at Windows logon (`npm run schedule:api`) — no manual `npm start`  
3. Load this repo’s `extension/` (unpacked)  
4. Click **Capture JobRight** once to verify

## Fully automatic every 8 hours (Windows)

Install **both** scheduled tasks (Dice capture + API at logon):

```bash
npm run schedule:install
```

| Task | What it does |
|------|----------------|
| `DiceJobCapture_Every8Hours` | Runs Dice capture every 8 hours |
| `DiceJobCapture_API_AtLogon` | Starts `node src/server.js` when you log in (so JobRight extension can ingest) |

You do **not** need to open Cursor or type `npm start` after that — just reboot/login once, stay signed in to JobRight in Chrome, and keep the extension loaded.

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
| `GET /api/export.csv?source=dice` | Download Dice CSV |
| `GET /api/export.csv?source=jobright` | Download JobRight CSV |

## Env highlights

| Key | Meaning |
|-----|---------|
| `CAPTURE_DICE` | `true`/`false` |
| `CAPTURE_JOBRIGHT` | Playwright JobRight (`false` = use extension) |
| `JOBRIGHT_AUTH_PATH` | Playwright login state |
| `CSV_PREFIX_DICE` / `CSV_PREFIX_JOBRIGHT` | Dated filename prefixes |
| `DATA_DIR` | Output folder (`download`) |
| `CRON_SCHEDULE` | Used by `npm start` only |

## Notes

- Personal job-hunting use; polite delays / page caps.
- After JobRight UI changes, re-run `npm run jobright:login` if autofill jobs stop appearing.

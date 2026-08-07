# Dice + JobRight Salesforce Job Capture

Capture **Salesforce** jobs from Dice and JobRight every 8 hours, append/dedupe locally, write a **dated CSV**, and Slack-notify on new jobs.

## What gets saved

Each run writes **separate** files per source:

- `download/dice_sf_jobs_YYYY-MM-DD_HHmmss.csv`
- `download/dice_jobs_latest.csv`
- `download/jobright_sf_jobs_YYYY-MM-DD_HHmmss.csv`
- `download/jobright_jobs_latest.csv`
- `download/store.json` — shared dedupe history

Filter: title or JD must contain the word `Salesforce`.

### JobRight rule (from your screenshot)

- **Keep:** jobs with **APPLY WITH AUTOFILL**  
- **Skip:** **APPLY NOW** (usually LinkedIn redirect)

## How automation is split (recommended)

| Source | How it runs automatically |
|--------|---------------------------|
| **Dice** | Windows Task Scheduler (`npm run schedule:install`) — no login needed |
| **JobRight** | **Chrome extension** in your logged-in browser — every 8 hours while Chrome is open |

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

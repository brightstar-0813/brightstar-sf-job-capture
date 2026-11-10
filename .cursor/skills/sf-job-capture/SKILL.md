---
name: sf-job-capture
description: >-
  Operates and maintains the sf-job-capture multi-source Salesforce remote job
  fetch bot (capture pipeline, filters, adapters, CSV, Google Sheets, Slack,
  schedules, local API). Use when the user mentions sf-job-capture, job capture,
  fetch bot, npm run capture, sheet sync, adding a job source, capture filters,
  JobRight, Dice, Greenhouse, Lever, Ashby, or scheduled 5 AM/5 PM capture.
disable-model-invocation: true
---

# SF Job Capture (Fetch Bot)

Repo: `D:\Work\JobHunting\Prompts\Bots\sf-job-capture` (package name `dice-job-capture`).

Personal bot that polls many public boards/APIs (plus a few Playwright scrapers), keeps **remote US-friendly Salesforce-ecosystem** jobs posted within `RECENT_DAYS`, dedupes into `download/store.json`, overwrites combined + per-source CSVs, optionally appends **new** jobs to a Google Sheets warehouse, and can Slack-notify.

## Pipeline (one page)

`runCapture()` in `src/capture.js`:

1. `beginRun` → load bid-tracker exclusions (`sheet-exclude.js`)
2. Parallel: HTTP/JSON/RSS feeds (`collectFeedJobs`) ∥ Playwright boards (Built In → Dice → Zip/Monster/Indeed/CareerBuilder)
3. JobRight last via HTTP `POST /swan/recommend/search` (browser arg unused)
4. Per job: sheet exclude → `captureRuleReason` → `upsertJob`
5. Repair JobRight URLs → prune store → remove sheet matches
6. `syncCsv` → `appendJobsToSheet(newJobs)` → Slack → `finishRun`

Alt path: Chrome extension → `POST /api/ingest` (`src/ingest.js`) — same store/CSV/Slack; **no** sheet append or bid-tracker exclude.

## Operate commands

| Command | Role |
|---------|------|
| `npm run capture` | Full multi-source capture |
| `npm start` | Local Express API + cron (`PORT` default 3847) |
| `npm run sheet:sync` | Append local CSV → warehouse |
| `npm run sheet:replace` | Clear warehouse tab + refill |
| `npm run schedule:install` | Windows tasks: 5 AM/5 PM capture + API at logon |
| `npm run indeed:login` | Save Indeed Playwright session (if enabling Indeed) |

Details: [operate.md](operate.md)

## Maintain map

| Change | Edit |
|--------|------|
| New source | `src/<name>/search.js` + wire in `capture.js` / `config.js` / `SOURCE_*` — [sources.md](sources.md) |
| Keep/skip rules | `src/filter.js` (+ feed pre-filter `src/feeds/keep.js`) — [config-and-sheets.md](config-and-sheets.md) |
| Env / toggles / ATS boards | `src/config.js`, `.env.example`, `.env` |
| Warehouse / bid-tracker | `src/sheet-append.js`, `src/sheet-exclude.js`, `apps-script/Code.gs` |
| Dedupe / CSV shape | `src/store.js`, `CSV_HEADERS` / `SOURCE_PRIORITY` / `CSV_EXPORT_ORDER` in `config.js` |
| Local API / extension | `src/server.js`, `extension/` |

Architecture detail: [architecture.md](architecture.md)

## Hard rules

- **LinkedIn never kept** — any LinkedIn URL is excluded; JobRight LinkedIn apply skipped.
- Prefer **public API/JSON/RSS** over Playwright; leave Monster / CareerBuilder / Indeed off unless explicitly enabling.
- Sources are **not** auto-discovered — register manually in `capture.js`, `config.js` (`CAPTURE_*`), and `SOURCE_IDS` / `SOURCE_PRIORITY` / `CSV_EXPORT_ORDER`.
- After changing `apps-script/Code.gs`, **redeploy** the Apps Script web app (new version) or warehouse actions stay stale.
- Do **not** commit `.env`, auth JSON, or secrets. Use `.env.example` patterns only.
- `bool()` in config treats any non-empty value except `"false"` as true (`CAPTURE_INDEED=0` is still true).
- Extension ingest ≠ full capture: no warehouse append / bid-tracker exclude on `/api/ingest`.

## Reference files

- [architecture.md](architecture.md) — modules, capture vs ingest, outputs
- [sources.md](sources.md) — boards, adapter contract, add-source checklist
- [config-and-sheets.md](config-and-sheets.md) — env, filters, Sheets gotchas
- [operate.md](operate.md) — run, schedule, API, diagnose

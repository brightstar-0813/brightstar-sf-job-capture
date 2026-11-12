# Operate

## Progress checklist

Copy and update when running or debugging:

```
SF Job Capture:
- [ ] 1. Confirm .env (RECENT_DAYS, CAPTURE_*, sheet/Slack URLs)
- [ ] 2. Run capture or trigger via API/scheduler
- [ ] 3. Check console: per-source counts, skipped reasons
- [ ] 4. Verify download/jobs_latest.csv + store.json
- [ ] 5. Confirm warehouse append / sheet:sync if needed
- [ ] 6. Optional: Slack summary / GET /api/status
```

## Manual capture

```bash
npm run capture
```

Writes under `DATA_DIR` (default `download/`):

- `jobs_latest.csv`
- `NN_{source}_jobs_latest.csv`
- `07_workday_jobs_latest.csv`
- `store.json`

## Local API

```bash
npm start
```

Useful checks:

```bash
curl http://127.0.0.1:3847/api/health
curl http://127.0.0.1:3847/api/status
curl -X POST http://127.0.0.1:3847/api/run
curl "http://127.0.0.1:3847/api/export.csv"
```

Cron inside the API process uses `CRON_SCHEDULE` (default `0 5,17 * * *` = 5 AM and 5 PM).

## Windows Task Scheduler

```bash
npm run schedule:install
```

| Task | Behavior |
|------|----------|
| `DiceJobCapture_5am5pm` | Capture at 5 AM and 5 PM local |
| `DiceJobCapture_API_AtLogon` | Starts `node src/server.js` at logon |

Individual: `npm run schedule:dice`, `npm run schedule:api`.

```powershell
Get-ScheduledTask -TaskName DiceJobCapture_5am5pm, DiceJobCapture_API_AtLogon
Start-ScheduledTask -TaskName DiceJobCapture_5am5pm
```

## Sheets sync

```bash
npm run sheet:sync       # append from latest CSV
npm run sheet:replace    # clear warehouse tab + refill
```

Requires live Apps Script deployment with `appendWarehouse` / `replaceWarehouse`.

## Indeed (optional)

1. Set `CAPTURE_INDEED=true` (literal `true` / non-`false` string — see bool gotcha).
2. `npm run indeed:login` once (headed Cloudflare).
3. `npm run capture`.

## Chrome extension DOM path (parallel to Node)

1. `npm start` (or scheduled API) on `127.0.0.1:3847`.
2. Load `extension/` unpacked in Chrome; stay signed in on the boards you enable.
3. Open the toolbar **popup** → check sources (Indeed / Zip / Monster / CareerBuilder / JobRight) → **Start**.
4. Options page: queries, max pages, schedule hours, dry-run, bid-tracker exclude.
5. On CAPTCHA / login / Cloudflare: badge `!` → finish challenge → **Resume**. Offline API → jobs buffer; use **Flush buffer**.
6. Or queue via `POST /api/extension/capture` `{ "sources": ["indeed","jobright"] }` (poll ~1 min).

Node scheduled capture (feeds / Playwright / JobRight `/swan`) is unchanged and independent. Prefer extension for login-gated boards; keep Node `CAPTURE_INDEED` / Monster / CB off if you only want the extension path for those.

## Diagnose empty / failing boards

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Source logs `0` jobs | Filters too strict / queries miss | Check `[filter] skip …` reasons; widen seeds temporarily |
| Playwright board empty + `(blocked)` | Cloudflare / bot detection | Keep off; prefer APIs; try headed login helpers if needed |
| USAJOBS / Adzuna / Google Jobs empty | Missing keys | Set keys in `.env`; confirm flag not `"false"` |
| JobRight empty | API shape / page caps | Check `JOBRIGHT_MAX_PAGES`, `ROLE_TITLES` / `JOBRIGHT_TITLES` |
| Good CSV but no sheet rows | Sync off / stale web app | `SYNC_JOBS_SHEET=true`; redeploy Apps Script; check `JOBS_SHEET_WEBAPP_URL` |
| Jobs already applied still appear | Bid-tracker exclude failed | Sheet must be link-viewable; check `BID_TRACKING_SHEET_URL` / GID |
| Capture says already running | Overlap | Wait; only one `runCapture` at a time |

## Safe update loop

1. Change adapter / filter / config.
2. Narrow `.env` toggles (disable unrelated `CAPTURE_*`) for a fast test.
3. `npm run capture`.
4. Inspect console skip reasons + `download/jobs_latest.csv` / `store.json`.
5. Re-enable sources; full capture; `npm run sheet:sync` only if warehouse needs a bulk catch-up (normal capture already appends **new** jobs).

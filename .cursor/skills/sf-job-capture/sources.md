# Sources

Registration is **manual** in `src/capture.js` (imports + `if (config.captureX)`). Not a plugin registry.

## Wired sources

| Source id | Module | Mechanism | Flag | Default |
|-----------|--------|-----------|------|---------|
| `builtin` | `src/builtin/search.js` | Playwright; `ROLE_TITLES` × `ROLE_PAGES` | `CAPTURE_BUILTIN` | on |
| `himalayas` | `src/himalayas/search.js` | Public JSON | `CAPTURE_HIMALAYAS` | on |
| `greenhouse` | `src/greenhouse/search.js` | boards-api; `GREENHOUSE_BOARDS` | `CAPTURE_GREENHOUSE` | on |
| `dice` | `src/dice/search.js` + `detail.js` | Playwright anonymous | `CAPTURE_DICE` | on |
| `lever` | `src/lever/search.js` | Lever API; `LEVER_BOARDS` | `CAPTURE_LEVER` | on |
| `ashby` | `src/ashby/search.js` | Ashby API; `ASHBY_BOARDS` | `CAPTURE_ASHBY` | on |
| `remotive` | `src/remotive/search.js` | Public API + `SEARCH_QUERIES` | `CAPTURE_REMOTIVE` | on |
| `jobicy` | `src/jobicy/search.js` | Public API + `JOBICY_TAGS` | `CAPTURE_JOBICY` | on |
| `remoteok` | `src/remoteok/search.js` | Public JSON | `CAPTURE_REMOTEOK` | on |
| `wwr` | `src/wwr/search.js` | RSS/listing | `CAPTURE_WWR` | on |
| `jobgether` | `src/jobgether/search.js` | Offer API | `CAPTURE_JOBGETHER` | on |
| `arbeitnow` | `src/arbeitnow/search.js` | Public JSON (EU-heavy) | `CAPTURE_ARBEITNOW` | on |
| `themuse` | `src/themuse/search.js` | Public API | `CAPTURE_THEMUSE` | on |
| `workingnomads` | `src/workingnomads/search.js` | Public JSON | `CAPTURE_WORKINGNOMADS` | on |
| `jobspresso` | `src/jobspresso/search.js` | Listing pages + `ROLE_TITLES` | `CAPTURE_JOBSPRESSO` | on |
| `skipthedrive` | `src/skipthedrive/search.js` | Public search pages | `CAPTURE_SKIPTHEDRIVE` | on |
| `arc` | `src/arc/search.js` | Public search pages | `CAPTURE_ARC` | on |
| `usajobs` | `src/usajobs/search.js` | API (needs keys) | `CAPTURE_USAJOBS` | on* |
| `adzuna` | `src/adzuna/search.js` | API (needs keys) | `CAPTURE_ADZUNA` | on* |
| `googlejobs` | `src/googlejobs/search.js` | SerpAPI (`SERPAPI_KEY`) | `CAPTURE_GOOGLEJOBS` | on* |
| `ziprecruiter` | `src/ziprecruiter/search.js` | Playwright | `CAPTURE_ZIPRECRUITER` | on |
| `monster` | `src/monster/search.js` | Playwright | `CAPTURE_MONSTER` | **off** |
| `indeed` | `src/indeed/search.js` | Playwright + auth/profile | `CAPTURE_INDEED` | **off** |
| `careerbuilder` | `src/careerbuilder/search.js` | Playwright | `CAPTURE_CAREERBUILDER` | **off** |
| `jobright` | `src/jobright/search.js` | HTTP `/swan/recommend/search` | `CAPTURE_JOBRIGHT` | on |

\* Flag defaults on, but adapters no-op until API keys are set.

### Invocation groups (`capture.js`)

- **Feeds** (`collectFeedJobs`): Himalayas, Greenhouse, Lever, Ashby, Remotive, Jobicy, Remote OK, WWR, Jobgether, Arbeitnow, The Muse, Working Nomads, Jobspresso, SkipTheDrive, Arc, USAJOBS, Adzuna, Google Jobs — `Promise.all`.
- **Playwright (sequential)**: Built In → Dice (+ detail) → ZipRecruiter → Monster → Indeed → CareerBuilder.
- **JobRight**: after feeds merge; lowest source priority.

## Extension DOM path (parallel)

Logged-in Chrome MV3 under `extension/` — does **not** replace Node adapters. User selects sources in the popup / Options / `POST /api/extension/capture`.

| Source id | Adapter | Mechanism |
|-----------|---------|-----------|
| `indeed` | `extension/adapters/indeed-content.js` | DOM mosaic/cards + detail pane; background paginates |
| `ziprecruiter` | `extension/adapters/ziprecruiter-content.js` | DOM listing + detail fetch; Cloudflare → need-user |
| `monster` | `extension/adapters/monster-content.js` | DOM listing + detail fetch |
| `careerbuilder` | `extension/adapters/careerbuilder-content.js` | DOM listing + detail fetch |
| `jobright` | `extension/adapters/jobright-content.js` | In-page `/swan` (same as before); optional alongside DOM boards |

Orchestrator: `extension/background.js`. Shared protocol/filter: `extension/lib/`. Final filter still `matchesCaptureRule` via `POST /api/ingest`.

## Not wired

- `src/jobspy/` — standalone; niche remotes are not scraped.
- Legacy ids still in `SOURCE_IDS` / `SOURCE_PRIORITY` for CSV/status compatibility (`glassdoor`, `wellfound`, …).
- LinkedIn — never scraped (API or extension).

## Adapter contract

Return `{ jobs: [...] }` (Playwright boards may also return `blocked`).

Each job should include:

- Stable `id` — prefer `{source}_{board?}_{id}` (e.g. `greenhouse_copado_123`, `jobright_abc`)
- `source` — matches a `SOURCE_IDS` entry
- Fields aligning with `CSV_HEADERS` in `src/config.js` (`title`, `organization`, `location`, `work_arrangement`, `url`, `description`, `date_posted`, salary fields, …)

Conventions:

- Feeds: pre-filter with `keepFeedJob` from `src/feeds/keep.js`; capture always re-filters with `captureRuleReason`.
- ATS (Greenhouse/Lever/Ashby): recency may use `last_seen_at` while still on board (`store.js` `ATS_SOURCES`).
- Same title+company fingerprint: higher `SOURCE_PRIORITY` wins (Built In → Himalayas → Greenhouse → Dice → … → JobRight).

## Add-source checklist

1. Add `src/<name>/search.js` exporting `searchXJobs()` → `{ jobs }` (HTTP feed or Playwright + `browser.js`).
2. Add `captureX: bool("CAPTURE_X", …)` in `src/config.js` and document in `.env.example`.
3. Import + gate in `src/capture.js`:
   - Feed → `collectFeedJobs` runners list + `enabledSources`
   - Browser → sequential Playwright block + `enabledSources`
4. Add id to `SOURCE_IDS`, `SOURCE_PRIORITY`, and `CSV_EXPORT_ORDER` (priority affects dedupe + CSV order).
5. Optionally expose the flag on `/api/status` in `src/server.js`.
6. Prefer public API; pre-filter with `keepFeedJob` / SF queries; leave `captureRuleReason` as the final gate.
7. Verify with a narrow run (toggle others off in `.env`) → check `download/jobs_latest.csv` and `store.json`.

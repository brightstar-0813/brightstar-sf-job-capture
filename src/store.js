import fs from "fs";
import path from "path";
import { config, CSV_HEADERS } from "./config.js";
import { writeCsv } from "./csv.js";
import { resolveTimestampedCsvPath } from "./paths.js";
import { matchesCaptureRule, isRecentJob } from "./filter.js";

/**
 * A job qualifies for the store/CSV output when it matches the capture rule
 * (remote Salesforce, non-Salesforce employer) AND was posted within the
 * configured recency window.
 */
function matchesOutputRule(job) {
  return matchesCaptureRule(job) && isRecentJob(job, config.recentDays);
}

/**
 * File-backed store (JSON) — no native deps.
 * Keeps jobs + run history for dedupe and CSV sync.
 */

function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

function storePath() {
  return config.storePath || path.join(config.dataDir, "store.json");
}

function defaultStore() {
  return {
    meta: {},
    nextRunId: 1,
    runs: [],
    jobs: {},
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  ensureDataDir();
  const p = storePath();
  if (!fs.existsSync(p)) {
    cache = defaultStore();
    save();
    return cache;
  }
  try {
    cache = { ...defaultStore(), ...JSON.parse(fs.readFileSync(p, "utf8")) };
    cache.meta = cache.meta || {};
    cache.jobs = cache.jobs || {};
    cache.runs = cache.runs || [];
    cache.nextRunId = cache.nextRunId || 1;
  } catch {
    cache = defaultStore();
  }
  return cache;
}

function save() {
  ensureDataDir();
  fs.writeFileSync(storePath(), JSON.stringify(cache, null, 2), "utf8");
}

// Keep dbPath config for compatibility; also mirror a marker file name
export function getMeta(key, fallback = null) {
  const s = load();
  return Object.prototype.hasOwnProperty.call(s.meta, key)
    ? s.meta[key]
    : fallback;
}

export function setMeta(key, value) {
  const s = load();
  s.meta[key] = String(value);
  save();
}

export function beginRun() {
  const s = load();
  const id = s.nextRunId++;
  s.runs.push({
    id,
    started_at: new Date().toISOString(),
    finished_at: null,
    new_count: 0,
    updated_count: 0,
    skipped_count: 0,
    error: null,
  });
  save();
  return id;
}

export function finishRun(runId, counts, error = null) {
  const s = load();
  const run = s.runs.find((r) => r.id === runId);
  if (!run) return;
  run.finished_at = new Date().toISOString();
  run.new_count = counts.newCount || 0;
  run.updated_count = counts.updatedCount || 0;
  run.skipped_count = counts.skippedCount || 0;
  run.error = error;
  save();
}

export function getLastRun() {
  const s = load();
  if (!s.runs.length) return null;
  return s.runs[s.runs.length - 1];
}

export function getStatus() {
  const s = load();
  const jobs = Object.values(s.jobs);
  const lastRun = getLastRun();
  const diceCount = jobs.filter((j) => j.source === "dice").length;
  const jrCount = jobs.filter((j) => j.source === "jobright").length;
  return {
    totalJobs: jobs.length,
    diceJobs: diceCount,
    jobrightJobs: jrCount,
    newJobs: jobs.filter((j) => j.status === "new").length,
    lastRun: lastRun || null,
    csvPathDice: getMeta("last_csv_path_dice"),
    csvPathJobright: getMeta("last_csv_path_jobright"),
    latestCsvDice: path.join(config.dataDir, config.csvLatestDice),
    latestCsvJobright: path.join(config.dataDir, config.csvLatestJobright),
    apiBase: config.apiBase,
  };
}

function jobFromRow(row) {
  if (!row) return null;
  const out = {};
  for (const h of CSV_HEADERS) {
    out[h] = row[h] ?? "";
  }
  return out;
}

export function getJob(id) {
  return jobFromRow(load().jobs[String(id)]);
}

export function listJobs({ status, source, limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  let rows = Object.values(load().jobs);
  if (status) {
    rows = rows.filter((j) => j.status === String(status));
  }
  if (source) {
    const src = String(source).toLowerCase();
    rows = rows.filter((j) => String(j.source || "").toLowerCase() === src);
  }
  rows.sort((a, b) =>
    String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))
  );
  return rows.slice(0, lim).map(jobFromRow);
}

export function allJobs() {
  return Object.values(load().jobs)
    .sort((a, b) =>
      String(a.first_seen_at || "").localeCompare(String(b.first_seen_at || ""))
    )
    .map(jobFromRow);
}

/**
 * Upsert a scraped job for the current run.
 * @returns {{ status: 'new'|'updated', job: object }}
 */
export function upsertJob(scraped, runId) {
  const s = load();
  const now = new Date().toISOString();
  const id = String(scraped.id);
  const existing = s.jobs[id];

  const base = {
    id,
    title: scraped.title || "",
    organization: scraped.organization || "",
    location: scraped.location || "",
    work_arrangement: scraped.work_arrangement || "",
    remote_restricted_to: scraped.remote_restricted_to || "",
    experience_level: scraped.experience_level || "",
    employment_type: scraped.employment_type || "",
    salary_min: scraped.salary_min ?? "",
    salary_max: scraped.salary_max ?? "",
    salary_currency: scraped.salary_currency || "USD",
    salary_unit: scraped.salary_unit || "",
    key_skills: scraped.key_skills || "",
    source: scraped.source || "dice",
    date_posted: scraped.date_posted || "",
    url: scraped.url || "",
    description: scraped.description || "",
  };

  if (!existing) {
    const job = {
      ...base,
      first_seen_run_id: runId,
      last_seen_run_id: runId,
      first_seen_at: now,
      last_seen_at: now,
      status: "new",
    };
    s.jobs[id] = job;
    save();
    return { status: "new", job };
  }

  const job = {
    ...base,
    first_seen_run_id: existing.first_seen_run_id,
    last_seen_run_id: runId,
    first_seen_at: existing.first_seen_at,
    last_seen_at: now,
    status: "updated",
  };
  s.jobs[id] = job;
  save();
  return { status: "updated", job };
}

export function jobsBySource(source) {
  const src = String(source || "").toLowerCase();
  return allJobs().filter((j) => String(j.source || "").toLowerCase() === src);
}

/**
 * Permanently remove stored jobs that no longer satisfy the output rule:
 * the capture rule (Salesforce-employer, hybrid/on-site, or no "Salesforce" in
 * title/desc) or the recency window (posted more than RECENT_DAYS ago). Used to
 * clean out legacy rows and age out stale postings.
 * @returns {{ removed: number, kept: number }}
 */
export function pruneStore() {
  const s = load();
  const ids = Object.keys(s.jobs);
  let removed = 0;
  for (const id of ids) {
    if (!matchesOutputRule(s.jobs[id])) {
      delete s.jobs[id];
      removed += 1;
    }
  }
  if (removed > 0) save();
  return { removed, kept: Object.keys(s.jobs).length };
}

/**
 * Permanently remove stored jobs by id (e.g. jobs the user has since applied
 * to on JobRight). Ignores ids that are not present.
 * @param {Iterable<string>} ids
 * @returns {{ removed: number, kept: number }}
 */
export function removeJobs(ids) {
  const s = load();
  let removed = 0;
  for (const id of ids || []) {
    const key = String(id);
    if (Object.prototype.hasOwnProperty.call(s.jobs, key)) {
      delete s.jobs[key];
      removed += 1;
    }
  }
  if (removed > 0) save();
  return { removed, kept: Object.keys(s.jobs).length };
}

/**
 * Write separate CSVs for Dice and JobRight (timestamped + latest).
 * @returns {{
 *   dice: { csvPath: string, latestPath: string },
 *   jobright: { csvPath: string, latestPath: string },
 *   sources: string[]
 * }}
 */
export function syncCsv(rows = null, { timestamped = true, source = null } = {}) {
  const writeOne = (src, list) => {
    // Safety net: never emit jobs that violate the capture rule or the recency
    // window, even if legacy rows linger in the store.
    const clean = (list || []).filter((j) => matchesOutputRule(j));
    const prefix =
      src === "jobright" ? config.csvPrefixJobright : config.csvPrefixDice;
    const latestName =
      src === "jobright" ? config.csvLatestJobright : config.csvLatestDice;
    const latestPath = path.join(config.dataDir, latestName);
    writeCsv(latestPath, clean);

    let csvPath = latestPath;
    if (timestamped) {
      csvPath = resolveTimestampedCsvPath(config.dataDir, prefix);
      writeCsv(csvPath, clean);
    }
    setMeta(`last_csv_path_${src}`, csvPath);
    setMeta(`last_csv_latest_path_${src}`, latestPath);
    return { csvPath, latestPath };
  };

  if (source) {
    const src = String(source).toLowerCase();
    const list = (rows || jobsBySource(src)).filter(
      (j) => String(j.source || "").toLowerCase() === src
    );
    const out = writeOne(src, list);
    return {
      [src]: out,
      sources: [src],
      csvPath: out.csvPath,
      latestPath: out.latestPath,
    };
  }

  const all = rows || allJobs();
  const dice = all.filter((j) => String(j.source || "").toLowerCase() === "dice");
  const jobright = all.filter(
    (j) => String(j.source || "").toLowerCase() === "jobright"
  );

  const diceOut = writeOne("dice", dice);
  const jrOut = writeOne("jobright", jobright);

  setMeta("last_csv_path", diceOut.csvPath);
  setMeta("last_csv_latest_path", diceOut.latestPath);

  return {
    dice: diceOut,
    jobright: jrOut,
    sources: ["dice", "jobright"],
    csvPath: diceOut.csvPath,
    latestPath: diceOut.latestPath,
  };
}

export function closeStore() {
  if (cache) save();
  cache = null;
}

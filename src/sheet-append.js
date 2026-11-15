/**
 * Append jobs to the jobs-warehouse Google Sheet tab (US-SF-Jobs) via the
 * Brightstar Apps Script web app. Capture syncs the full jobs_latest.csv after
 * each run; existing Links are skipped as duplicates on the sheet side.
 *
 * Warehouse columns: Role | Company | Link | JD | Salary
 * (no Status / Bid mode — those stay on bid-tracker profile tabs)
 *
 * POST action: "appendWarehouse"
 * Fields: jobTitle, companyName, jobLink, jd, salary
 */

import { config } from "./config.js";

const DEFAULT_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwH-J2wyqDDIio8Aue7Afq_WZkn1-SBcJ8l2RH2dzCbMk6hZelVXyREOm6fiE9Eujrl/exec";

/** Sheets cells max ~50k; keep headroom. */
const JD_MAX_CHARS = 45000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract spreadsheet id from a full Sheets URL or bare id. */
export function spreadsheetIdFromUrl(sheetUrlOrId) {
  const raw = String(sheetUrlOrId || "").trim();
  if (!raw) return "";
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9_-]+$/.test(raw)) return raw;
  return "";
}

function formatMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n || "").trim();
  return Math.round(num).toLocaleString("en-US");
}

/** Build a short human salary string from store salary_* fields. */
export function formatSalary(job) {
  const min = job?.salary_min;
  const max = job?.salary_max;
  const hasMin = min !== "" && min != null && Number.isFinite(Number(min));
  const hasMax = max !== "" && max != null && Number.isFinite(Number(max));
  if (!hasMin && !hasMax) {
    return String(job?.salary || "").trim();
  }
  const currency = String(job?.salary_currency || "USD").trim().toUpperCase();
  const unit = String(job?.salary_unit || "").trim().toUpperCase();
  const prefix = currency === "USD" || !currency ? "$" : `${currency} `;
  let range = "";
  if (hasMin && hasMax) {
    range =
      Number(min) === Number(max)
        ? `${prefix}${formatMoney(min)}`
        : `${prefix}${formatMoney(min)}-${prefix}${formatMoney(max)}`;
  } else if (hasMin) {
    range = `${prefix}${formatMoney(min)}+`;
  } else {
    range = `up to ${prefix}${formatMoney(max)}`;
  }
  if (unit === "HOUR" || unit === "HOURLY") return `${range}/hr`;
  if (unit === "MONTH" || unit === "MONTHLY") return `${range}/mo`;
  if (unit === "YEAR" || unit === "YEARLY" || unit === "ANNUAL") {
    return `${range}/yr`;
  }
  return range;
}

export function formatJd(job) {
  const raw = String(job?.description || job?.jd || "").trim();
  if (!raw) return "";
  if (raw.length <= JD_MAX_CHARS) return raw;
  return `${raw.slice(0, JD_MAX_CHARS - 1)}…`;
}

/** Warehouse payload — Role, Company, Link, JD, Salary. */
export function jobToSheetPayload(job) {
  return {
    jobTitle: String(job?.title || "").trim(),
    companyName: String(job?.organization || "").trim(),
    jobLink: String(job?.url || "").trim(),
    jd: formatJd(job),
    salary: formatSalary(job),
  };
}

async function postTextPlainJson(urlString, payload, { timeoutMs = 60000 } = {}) {
  const body = JSON.stringify(payload);
  const res = await fetch(urlString, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: text, json };
}

async function postWithRetry(urlString, payload, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await postTextPlainJson(urlString, payload);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      const waitMs = 1000 * 2 ** attempt;
      console.warn(
        `[sheet] fetch retry ${attempt + 1}/${retries} in ${waitMs}ms: ${err.message || err}`
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

/**
 * Clear US-SF-Jobs and write warehouse headers (Role|Company|Link|JD|Salary).
 * Requires Apps Script with action replaceWarehouse (redeploy Code.gs).
 */
export async function resetWarehouseSheet() {
  const webappUrl = String(config.jobsSheetWebappUrl || DEFAULT_WEBAPP_URL).trim();
  const spreadsheetId = spreadsheetIdFromUrl(config.jobsSheetUrl);
  const sheetName = String(config.jobsSheetName || "US-SF-Jobs").trim();
  if (!webappUrl || !spreadsheetId) {
    return {
      ok: false,
      error: !webappUrl
        ? "JOBS_SHEET_WEBAPP_URL is empty"
        : "Could not parse spreadsheetId from JOBS_SHEET_URL",
    };
  }
  try {
    const { status, body, json } = await postWithRetry(webappUrl, {
      action: "replaceWarehouse",
      spreadsheetId,
      sheetName,
      rows: [],
    });
    if (!json || json.ok === false) {
      const err =
        json?.error || (body && body.slice(0, 300)) || `HTTP ${status}`;
      return { ok: false, error: err, sheetName };
    }
    return {
      ok: true,
      sheetName: json.sheetName || sheetName,
      headers: json.headers || ["Role", "Company", "Link", "JD", "Salary"],
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err), sheetName };
  }
}

/**
 * Append jobs to the configured warehouse sheet tab. Soft-fails: never throws
 * for sheet/network errors; returns counts instead.
 * @param {object[]} jobs
 * @param {{ force?: boolean }} [opts] force=true ignores SYNC_JOBS_SHEET=false
 */
export async function appendJobsToSheet(jobs = [], opts = {}) {
  const list = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  const result = {
    ok: true,
    skipped: false,
    appended: 0,
    duplicate: 0,
    failed: 0,
    total: list.length,
    sheetName: config.jobsSheetName || "US-SF-Jobs",
    error: "",
  };

  if (!opts.force && !config.syncJobsSheet) {
    result.skipped = true;
    return result;
  }

  const webappUrl = String(config.jobsSheetWebappUrl || DEFAULT_WEBAPP_URL).trim();
  if (!webappUrl) {
    result.skipped = true;
    result.error = "JOBS_SHEET_WEBAPP_URL is empty";
    return result;
  }

  const spreadsheetId = spreadsheetIdFromUrl(config.jobsSheetUrl);
  if (!spreadsheetId) {
    result.ok = false;
    result.error = "Could not parse spreadsheetId from JOBS_SHEET_URL";
    return result;
  }

  if (!list.length) return result;

  const sheetName = String(config.jobsSheetName || "US-SF-Jobs").trim();
  result.sheetName = sheetName;

  for (let i = 0; i < list.length; i += 1) {
    const job = list[i];
    const fields = jobToSheetPayload(job);
    if (!fields.jobTitle && !fields.companyName && !fields.jobLink) {
      result.failed += 1;
      console.warn(`[sheet] skip empty job id=${job?.id || "?"}`);
      continue;
    }

    try {
      const { status, body, json } = await postWithRetry(webappUrl, {
        action: "appendWarehouse",
        spreadsheetId,
        sheetName,
        ...fields,
      });

      if (!json || json.ok === false) {
        result.failed += 1;
        const err =
          json?.error ||
          (body && body.slice(0, 200)) ||
          `HTTP ${status}`;
        console.warn(
          `[sheet] append failed id=${job?.id || "?"} title=${fields.jobTitle}: ${err}`
        );
      } else if (json.duplicate) {
        result.duplicate += 1;
      } else {
        result.appended += 1;
      }
    } catch (err) {
      result.failed += 1;
      console.warn(
        `[sheet] append error id=${job?.id || "?"}: ${err.message || err}`
      );
    }

    if ((i + 1) % 25 === 0 || i + 1 === list.length) {
      console.log(
        `[sheet] progress ${i + 1}/${list.length} appended=${result.appended} duplicate=${result.duplicate} failed=${result.failed}`
      );
    }

    if (i < list.length - 1) {
      await sleep(400);
    }
  }

  if (result.failed > 0 && result.appended === 0 && result.duplicate === 0) {
    result.ok = false;
    result.error = `All ${result.failed} append(s) failed`;
  }

  return result;
}

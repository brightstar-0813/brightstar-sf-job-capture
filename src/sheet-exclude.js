/**
 * Bid-tracking Google Sheet — jobs already applied to / resume-built.
 * Capture skips listings whose Link matches (normalized URL or id parsed from it).
 *
 * Sheet columns (Sheet1): No, Created Date, Title, Compay, Link, Salary, Apply Status
 */

import { getText } from "./http.js";
import { parseCsv } from "./csv.js";
import { config } from "./config.js";

function normalizeUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    u.hash = "";
    // Drop tracking params; keep identity params like jk / gh_jid when present.
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "iis",
      "iisn",
    ].forEach((k) => u.searchParams.delete(k));
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${path}${u.search}`.toLowerCase();
  } catch {
    return String(url || "")
      .trim()
      .toLowerCase()
      .split("#")[0]
      .replace(/\/+$/, "");
  }
}

function sheetRowField(row, ...names) {
  for (const name of names) {
    for (const [k, v] of Object.entries(row || {})) {
      if (String(k).trim().toLowerCase() === name.toLowerCase()) {
        return String(v || "").trim();
      }
    }
  }
  return "";
}

/** Stable ids we can derive from common job URLs. */
export function idsFromJobUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return [];
  const ids = [];
  const dice =
    raw.match(/dice\.com\/job-detail\/([a-f0-9-]{20,})/i) ||
    raw.match(/dice\.com\/jobs\/detail\/([a-f0-9-]{20,})/i);
  if (dice) {
    ids.push(dice[1]);
    ids.push(`dice_${dice[1]}`);
  }
  const jr = raw.match(/jobright\.ai\/jobs\/info\/([a-z0-9]+)/i);
  if (jr) ids.push(`jobright_${jr[1]}`);
  const gh = raw.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (gh) ids.push(`greenhouse_${gh[1]}_${gh[2]}`);
  const ghJid = raw.match(/[?&]gh_jid=(\d+)/i);
  if (ghJid) ids.push(`ghjid_${ghJid[1]}`);
  const builtin = raw.match(/builtin\.com\/job\/[^/]+\/(\d+)/i);
  if (builtin) ids.push(`builtin_${builtin[1]}`);
  const jobgether = raw.match(/jobgether\.com\/offer\/([a-f0-9]+)/i);
  if (jobgether) ids.push(`jobgether_${jobgether[1]}`);
  return ids;
}

function exportCsvUrl(sheetUrlOrId, gid = 0) {
  const raw = String(sheetUrlOrId || "").trim();
  if (!raw) return "";
  let id = raw;
  let sheetGid = String(gid);
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (idMatch) id = idMatch[1];
  const gidMatch = raw.match(/[?#&]gid=(\d+)/);
  if (gidMatch) sheetGid = gidMatch[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${sheetGid}`;
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   count: number,
 *   urls: Set<string>,
 *   ids: Set<string>,
 *   rows: Array<{ title: string, organization: string, url: string }>,
 *   error?: string
 * }>}
 */
export async function loadBidTrackingExclusions() {
  const sheet = config.bidTrackingSheetUrl || config.bidTrackingSheetId;
  if (!sheet) {
    return {
      ok: false,
      count: 0,
      urls: new Set(),
      ids: new Set(),
      rows: [],
      error: "no BID_TRACKING_SHEET_URL configured",
    };
  }

  const csvUrl = exportCsvUrl(sheet, config.bidTrackingSheetGid || 0);
  console.log(`[sheet] loading bid tracker: ${csvUrl}`);
  let text;
  try {
    text = await getText(csvUrl, { timeoutMs: 30000 });
  } catch (err) {
    console.warn(`[sheet] fetch failed: ${err.message}`);
    return {
      ok: false,
      count: 0,
      urls: new Set(),
      ids: new Set(),
      rows: [],
      error: err.message,
    };
  }

  if (
    /<!DOCTYPE html|/i.test(text.slice(0, 200)) &&
    /sign in|accounts\.google/i.test(text)
  ) {
    return {
      ok: false,
      count: 0,
      urls: new Set(),
      ids: new Set(),
      rows: [],
      error: "sheet is not publicly readable (sign-in HTML returned)",
    };
  }

  const { rows: parsed } = parseCsv(text);
  const urls = new Set();
  const ids = new Set();
  const rows = [];

  for (const row of parsed) {
    const title = sheetRowField(row, "Title");
    const organization = sheetRowField(
      row,
      "Compay",
      "Company",
      "Organization"
    );
    const url = sheetRowField(row, "Link", "URL", "Url");
    if (!url) continue;

    rows.push({ title, organization, url });
    urls.add(normalizeUrl(url));
    for (const id of idsFromJobUrl(url)) ids.add(String(id).toLowerCase());
  }

  console.log(
    `[sheet] loaded ${rows.length} tracked job links` +
      ` (urls=${urls.size}, ids=${ids.size})`
  );

  return { ok: true, count: rows.length, urls, ids, rows };
}

/**
 * True when a captured job's link matches a bid-tracker Link
 * (same URL, or same board id parsed from the URL).
 */
export function isExcludedBySheet(job, exclusions) {
  if (!job || !exclusions?.ok) return false;

  const id = String(job.id || "").toLowerCase();
  if (id && exclusions.ids.has(id)) return true;
  // Greenhouse career-site links often only expose ?gh_jid=12345
  const ghjid = id.match(/^greenhouse_[^_]+_(\d+)$/);
  if (ghjid && exclusions.ids.has(`ghjid_${ghjid[1]}`)) return true;

  const url = String(job.url || "").trim();
  if (!url) return false;

  const norm = normalizeUrl(url);
  if (exclusions.urls.has(norm)) return true;

  for (const sid of idsFromJobUrl(url)) {
    if (exclusions.ids.has(String(sid).toLowerCase())) return true;
  }

  // Soft match when one listing URL clearly contains the other path.
  if (norm.length >= 40) {
    for (const u of exclusions.urls) {
      if (u.length >= 40 && (norm.includes(u) || u.includes(norm))) return true;
    }
  }

  return false;
}

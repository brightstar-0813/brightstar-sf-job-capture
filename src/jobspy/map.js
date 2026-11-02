/**
 * Map salesforce_jobs / JobSpy export rows into sf-job-capture job objects.
 */

import { createHash } from "crypto";
import { JOBSPY_SITE_TO_SOURCE } from "./sites.js";

const ATS_SOURCES = new Set(["greenhouse", "lever", "ashby", "workday"]);

function slugPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
}

function shortHash(value) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function dateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : text;
}

/**
 * Prefer ATS board names so greenhouse/lever/ashby get Node ATS retention
 * and higher CSV priority. Fall back to JobSpy site mapping.
 * @param {object} row
 */
export function mapJobspySource(row) {
  const ats = String(row?.ats || "").toLowerCase();
  if (ATS_SOURCES.has(ats)) return ats;

  const site = String(row?.site || "").toLowerCase();
  if (JOBSPY_SITE_TO_SOURCE[site]) return JOBSPY_SITE_TO_SOURCE[site];

  const sources = String(row?.sources || "")
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const src of sources) {
    if (ATS_SOURCES.has(src)) return src;
    if (JOBSPY_SITE_TO_SOURCE[src]) return JOBSPY_SITE_TO_SOURCE[src];
  }

  if (site) return site.replace(/_/g, "");
  return "jobspy";
}

/**
 * @param {object} row
 * @returns {object | null}
 */
export function mapJobspyRow(row) {
  if (!row || typeof row !== "object") return null;

  const title = firstString(row.title);
  const organization = firstString(row.company, row.organization);
  const url = firstString(row.job_url_direct, row.job_url, row.url);
  if (!title || !url) return null;
  if (/linkedin\.com/i.test(url)) return null;

  const source = mapJobspySource(row);
  const jobId = firstString(row.job_id);
  const board = slugPart(row.employer_board || row.company || organization);
  const idSeed = jobId || shortHash(`${source}|${url}|${title}|${organization}`);
  const id =
    source === "greenhouse" || source === "lever" || source === "ashby"
      ? `${source}_${board || "board"}_${idSeed}`
      : `${source}_${idSeed}`;

  const remoteFlag =
    row.is_remote === true ||
    String(row.is_remote || "").toLowerCase() === "true" ||
    /remote/i.test(firstString(row.location, row.title, row.description));

  const skills = firstString(
    row.matched_skills,
    row.key_skills,
    row.role_category,
    row.focus_reason
  );

  return {
    id,
    title,
    organization: organization || "Unknown",
    location: firstString(row.location),
    work_arrangement: remoteFlag ? "remote" : firstString(row.workplace_type) || "",
    remote_restricted_to: firstString(row.eligible_countries),
    experience_level: "",
    employment_type: firstString(row.job_type, row.employment_category),
    salary_min: row.min_amount ?? row.salary_min ?? "",
    salary_max: row.max_amount ?? row.salary_max ?? "",
    salary_currency: firstString(row.currency, row.salary_currency),
    salary_unit: firstString(row.interval, row.salary_unit),
    key_skills: skills,
    source,
    date_posted: dateOnly(row.date_posted || row.first_seen),
    url,
    description: firstString(row.description),
    _jobspy: {
      site: row.site || "",
      relevance_reason: row.relevance_reason || "",
      remote_evidence: row.remote_evidence || "",
      us_evidence: row.us_evidence || "",
      matched_queries: row.matched_queries || "",
    },
  };
}

/**
 * @param {unknown} rows
 * @returns {object[]}
 */
export function mapJobspyRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  const seen = new Set();
  for (const row of list) {
    const job = mapJobspyRow(row);
    if (!job || seen.has(job.id)) continue;
    seen.add(job.id);
    out.push(job);
  }
  return out;
}

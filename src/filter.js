/**
 * Capture rule: keep a job when its title OR description contains the word
 * "Salesforce" (case-insensitive, word boundary), EXCEPT jobs whose employer is
 * Salesforce itself. The employer exclusion is what removes Salesforce-company
 * postings (whose "Salesforce is the #1 AI CRM…" boilerplate would otherwise
 * match on description); company name is never used as a positive match signal.
 */
const SALESFORCE_RE = /\bSalesforce\b/i;

// Matches the Salesforce company as an employer, e.g. "Salesforce",
// "Salesforce.com", "Salesforce, Inc." — but NOT staffing/consulting firms
// that merely have "Salesforce" as part of a longer name.
const SALESFORCE_EMPLOYER_RE = /^\s*salesforce(?:\.com|,?\s*inc\.?)?\s*$/i;

export function containsSalesforce(title, description) {
  const t = String(title || "");
  const d = String(description || "");
  return SALESFORCE_RE.test(t) || SALESFORCE_RE.test(d);
}

export function isSalesforceEmployer(organization) {
  return SALESFORCE_EMPLOYER_RE.test(String(organization || "").trim());
}

/**
 * Remote-only: keep fully remote roles, drop hybrid and on-site. An empty value
 * is treated as remote because the Dice search is already restricted to remote
 * (its detail pages don't expose a workplace-type field).
 */
export function isRemoteArrangement(workArrangement) {
  const w = String(workArrangement || "").toLowerCase();
  if (/hybrid/.test(w)) return false;
  if (/on[-\s]?site|onsite|in[-\s]?office|in[-\s]?person/.test(w)) return false;
  return true;
}

/**
 * Final capture decision for a job: title or description contains "Salesforce",
 * the employer is not Salesforce itself, and the role is remote (not hybrid or
 * on-site).
 * @param {{ title?: string, description?: string, organization?: string, work_arrangement?: string }} job
 */
export function matchesCaptureRule(job) {
  if (!job) return false;
  if (isSalesforceEmployer(job.organization)) return false;
  if (!isRemoteArrangement(job.work_arrangement)) return false;
  return containsSalesforce(job.title, job.description);
}

export function filterSalesforceJobs(jobs) {
  return (jobs || []).filter((j) => matchesCaptureRule(j));
}

export function isLinkedinLink(...links) {
  return links.some((l) => /linkedin\.com/i.test(String(l || "")));
}

/**
 * Parse a job's posted date into an absolute Date. Handles:
 * - epoch ms (13 digits) / epoch seconds (10 digits)
 * - ISO / RFC date strings (Date.parse)
 * - relative English ("today", "just posted", "yesterday",
 *   "3 days ago", "2 weeks ago", "1 month ago", "5 hours ago")
 * Relative strings are resolved against `now` (the scrape time), so callers
 * should normalize to an absolute value at capture time.
 * @returns {Date|null} null when the value can't be understood.
 */
export function parsePostedDate(value, now = new Date()) {
  if (value == null || value === "") return null;

  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = String(Math.trunc(n)).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const s = String(value).trim().toLowerCase();

  if (/(^|\b)(just posted|today|moments? ago|minutes? ago|hours? ago|<\s*1\s*day)/.test(s)) {
    return now;
  }
  if (/\byesterday\b/.test(s)) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  const rel = s.match(/(\d+)\+?\s*(hour|day|week|month|year)s?\s*ago/);
  if (rel) {
    const qty = Number(rel[1]);
    const unitMs = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    }[rel[2]];
    return new Date(now.getTime() - qty * unitMs);
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * True when `value` resolves to within the last `days` days; false when older;
 * null when the date can't be parsed (caller decides how to treat unknowns).
 */
export function isWithinRecentDays(value, days, now = new Date()) {
  const d = parsePostedDate(value, now);
  if (!d) return null;
  const ageMs = now.getTime() - d.getTime();
  if (ageMs < 0) return true; // future-dated (clock skew) — treat as fresh
  return ageMs <= days * 24 * 60 * 60 * 1000;
}

/**
 * Recency decision for a stored/scraped job. Uses date_posted; when that is
 * missing/unparseable, falls back to first_seen_at so legacy rows still age
 * out. Jobs with no usable date at all are kept (lenient).
 */
export function isRecentJob(job, days, now = new Date()) {
  if (!job) return false;
  const byPosted = isWithinRecentDays(job.date_posted, days, now);
  if (byPosted !== null) return byPosted;
  const bySeen = isWithinRecentDays(job.first_seen_at, days, now);
  if (bySeen !== null) return bySeen;
  return true;
}

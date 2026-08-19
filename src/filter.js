/**
 * Salesforce-ecosystem product / platform names (title or JD).
 * Includes common typos so "Salesfoce Developer" still matches.
 */
const SF_PRODUCT_RE = new RegExp(
  [
    "salesforce",
    "salesfoce",
    "salseforce",
    "health\\s*cloud",
    "healthcloud",
    "salesforce\\s+data\\s*cloud",
    "datacloud",
    "marketing\\s*cloud",
    "service\\s*cloud",
    "commerce\\s*cloud",
    "experience\\s*cloud",
    "community\\s*cloud",
    "revenue\\s*cloud",
    "sales\\s*cloud",
    "industry\\s*cloud",
    "financial\\s*services\\s*cloud",
    "nonprofit\\s*cloud",
    "education\\s*cloud",
    "manufacturing\\s*cloud",
    "consumer\\s*goods\\s*cloud",
    "public\\s*sector\\s*cloud",
    "communications\\s*cloud",
    "\\bnpsp\\b",
    "agentforce",
    "omnistudio",
    "vlocity",
    "\\bsfmc\\b",
    "\\bsfcc\\b",
    "pardot",
    "account\\s+engagement",
    "lightning\\s+web\\s+components",
    "\\blwc\\b",
    "steelbrick",
    "salesforce\\s+cpq",
    "salesforce\\s+flow",
    "\\bsoql\\b",
    "\\bsosl\\b",
    "\\bmulesoft\\b",
    "einstein\\s+(gpt|copilot|analytics|for\\s+sales|for\\s+service)",
    "apex\\s+(class(?:es)?|trigger(?:s)?|code|developer|programming)",
  ].join("|"),
  "i"
);

/** Product names that are stronger than a passing "Salesforce" CRM mention. */
const SF_STRONG_JD_RE = new RegExp(
  [
    "health\\s*cloud",
    "healthcloud",
    "salesforce\\s+data\\s*cloud",
    "datacloud",
    "marketing\\s*cloud",
    "service\\s*cloud",
    "commerce\\s*cloud",
    "experience\\s*cloud",
    "community\\s*cloud",
    "revenue\\s*cloud",
    "sales\\s*cloud",
    "financial\\s*services\\s*cloud",
    "nonprofit\\s*cloud",
    "\\bnpsp\\b",
    "agentforce",
    "omnistudio",
    "vlocity",
    "\\bsfmc\\b",
    "\\bsfcc\\b",
    "pardot",
    "account\\s+engagement",
    "lightning\\s+web\\s+components",
    "\\blwc\\b",
    "steelbrick",
    "salesforce\\s+cpq",
    "\\bsoql\\b",
    "\\bsosl\\b",
    "\\bmulesoft\\b",
    "apex\\s+(class(?:es)?|trigger(?:s)?|code|developer|programming)",
  ].join("|"),
  "i"
);

const SF_ROLE_IN_JD_RE =
  /\bsalesforce\s+(admin(?:istrator)?|developer|architect|consultant|engineer|platform|cpq|commerce|flow|lightning|certified|experience|marketing\s+cloud|service\s+cloud|health\s+cloud|data\s+cloud)/i;

const OTHER_CRM_RE =
  /hubspot|microsoft\s*dynamics|dynamics\s*365|zoho|pipedrive|oracle\s*(crm|sales)?|sap\s*crm|freshsales|sugarcrm|zendesk|servicenow|veeva|salesloft/i;

const COMPETING_PLATFORM_RE =
  /\b(magento|shopify|woocommerce|servicenow|workday|veeva|hubspot|salesloft|docusign|sap\b|oracle|epic\b|netsuite)\b/i;

// Matches the Salesforce company as an employer, e.g. "Salesforce",
// "Salesforce.com", "Salesforce, Inc." — but NOT staffing/consulting firms
// that merely have "Salesforce" as part of a longer name.
const SALESFORCE_EMPLOYER_RE = /^\s*salesforce(?:\.com|,?\s*inc\.?)?\s*$/i;

function isPassingCrmMention(description) {
  const d = String(description || "");
  if (/salesforce\s*[,;/|&]\s*/i.test(d) && OTHER_CRM_RE.test(d)) return true;
  if (OTHER_CRM_RE.test(d) && /[,;/|&]\s*salesforce\b/i.test(d)) return true;
  if (/(such as|including|e\.g\.|for example|like)\s+[^\n.]{0,60}salesforce/i.test(d)) {
    return true;
  }
  if (/salesforce\s+(or|and)\s+(similar|equivalent|other|hubspot|dynamics)/i.test(d)) {
    return true;
  }
  if (
    /(crms?|crm platforms?|crm tools?|crm systems?)\s*[:(\-]?[^\n.]{0,80}salesforce/i.test(d) &&
    OTHER_CRM_RE.test(d)
  ) {
    return true;
  }
  return false;
}

/**
 * Cheap listing-title check used to skip irrelevant detail scrapes.
 * CRM-titled roles are included unless they name a competing CRM.
 */
export function looksSalesforceTitle(title) {
  const t = String(title || "");
  if (!t.trim()) return true;
  if (SF_PRODUCT_RE.test(t)) return true;
  if (/\bcpq\b/i.test(t) && !/\b(oracle|sap)\b/i.test(t)) return true;
  if (COMPETING_PLATFORM_RE.test(t) && !SF_PRODUCT_RE.test(t)) return false;
  if (/\bcrm\b/i.test(t) && !OTHER_CRM_RE.test(t)) return true;
  return false;
}

/**
 * True when the job is a Salesforce-ecosystem role (product keywords in the
 * title, or a Salesforce product/role in the JD with a technical title) —
 * not a passing CRM name-drop.
 */
export function containsSalesforce(title, description) {
  const t = String(title || "");
  const d = String(description || "");
  if (SF_PRODUCT_RE.test(t)) return true;
  if (/\bcpq\b/i.test(t) && !/\b(oracle|sap)\b/i.test(t)) return true;
  if (COMPETING_PLATFORM_RE.test(t) && !SF_PRODUCT_RE.test(t)) return false;
  if (!t.trim()) {
    return (
      (SF_STRONG_JD_RE.test(d) || SF_ROLE_IN_JD_RE.test(d)) &&
      !isPassingCrmMention(d)
    );
  }
  if (!looksSalesforceTitle(t)) return false;
  if (isPassingCrmMention(d)) return false;
  return SF_STRONG_JD_RE.test(d) || SF_ROLE_IN_JD_RE.test(d);
}

export function isSalesforceEmployer(organization) {
  return SALESFORCE_EMPLOYER_RE.test(String(organization || "").trim());
}

const US_RE = /\b(united states|usa|u\.s\.a\.?|u\.s\.)\b/;
const CANADA_RE =
  /\b(canada|canadian|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|toronto|vancouver|montreal|ottawa|calgary|edmonton)\b/;
const OTHER_REGION_RE =
  /\b(uk|united kingdom|germany|france|india|emea|apac|australia|netherlands|spain|brazil|mexico|latam|latin america|poland|ireland)\b/;

/**
 * US remote only. Drop Canada-only and other-region-only postings.
 * "US or Canada" still counts as US-eligible. Empty location is kept
 * (Dice/JobRight searches are already US-scoped).
 */
export function isUsFriendlyLocation(location, title = "") {
  const s = `${location || ""} ${title || ""}`.toLowerCase().trim();
  if (!s) return true;
  const hasUs = US_RE.test(s);
  if (CANADA_RE.test(s) && !hasUs) return false;
  if (hasUs) return true;
  if (
    /\b(worldwide|anywhere|global|north america|americas)\b/.test(s) &&
    !/\b(emea|europe|india|uk[- ]only|latam)\b/.test(s)
  ) {
    return true;
  }
  if (/^remote\b/.test(s) && !/\b(emea|europe|india|uk|latam|apac)\b/.test(s)) {
    return true;
  }
  if (OTHER_REGION_RE.test(s)) return false;
  return true;
}

export function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Remote-only: keep fully remote roles, drop hybrid and on-site.
 * An empty value is treated as remote only because Dice search is already
 * restricted to Remote (detail pages often omit workplace type). Any explicit
 * hybrid / on-site / in-office label is rejected; otherwise the value must
 * mention "remote".
 */
export function isRemoteArrangement(workArrangement) {
  const w = String(workArrangement || "").toLowerCase().trim();
  if (!w) return true;
  if (/hybrid/.test(w)) return false;
  if (/on[-\s]?site|onsite|in[-\s]?office|in[-\s]?person/.test(w)) return false;
  return /\bremote\b/.test(w);
}

/** True when a listing page says the job is closed, filled, or gone. */
export function isExpiredPosting(text) {
  return /this job is no longer available|no longer accepting applications|this (job|position|posting) (has expired|is expired|has been filled|is closed)|job (posting )?(has )?expired|position has been filled|no longer posted|this posting is no longer/i.test(
    String(text || "")
  );
}

/**
 * Why a job is rejected, or null if it should be kept.
 * @param {{ title?: string, description?: string, organization?: string, work_arrangement?: string, location?: string }} job
 */
export function captureRuleReason(job) {
  if (!job) return "empty";
  if (isSalesforceEmployer(job.organization)) return "employer is Salesforce";
  if (!isRemoteArrangement(job.work_arrangement)) return "not remote";
  if (!isUsFriendlyLocation(job.location, job.title)) return "location not US";
  if (!containsSalesforce(job.title, job.description)) {
    return "low Salesforce relevance";
  }
  return null;
}

/**
 * Keep remote Salesforce-ecosystem roles (product keywords / primary skill),
 * excluding Salesforce-the-company and hybrid/on-site.
 * @param {{ title?: string, description?: string, organization?: string, work_arrangement?: string, location?: string }} job
 */
export function matchesCaptureRule(job) {
  return captureRuleReason(job) == null;
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

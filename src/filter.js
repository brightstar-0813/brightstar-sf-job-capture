/**
 * Capture rule: keep a job when its title OR description contains the word
 * "Salesforce" (case-insensitive, word boundary). The employer/company name is
 * NOT used as a match signal, and jobs posted by Salesforce itself are excluded
 * (we want Salesforce-skill roles, not roles at the Salesforce company).
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
 * Final capture decision for a job.
 * @param {{ title?: string, description?: string, organization?: string }} job
 */
export function matchesCaptureRule(job) {
  if (!job) return false;
  if (isSalesforceEmployer(job.organization)) return false;
  return containsSalesforce(job.title, job.description);
}

export function filterSalesforceJobs(jobs) {
  return (jobs || []).filter((j) => matchesCaptureRule(j));
}

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
 * Final capture decision for a job: title or description contains "Salesforce"
 * and the employer is not Salesforce itself.
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

export function isLinkedinLink(...links) {
  return links.some((l) => /linkedin\.com/i.test(String(l || "")));
}

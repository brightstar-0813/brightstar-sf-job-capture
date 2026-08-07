/**
 * Keep jobs where title or description contains the word Salesforce.
 * Case-insensitive word boundary.
 */
const SALESFORCE_RE = /\bSalesforce\b/i;

export function containsSalesforce(title, description) {
  const t = String(title || "");
  const d = String(description || "");
  return SALESFORCE_RE.test(t) || SALESFORCE_RE.test(d);
}

export function filterSalesforceJobs(jobs) {
  return (jobs || []).filter((j) =>
    containsSalesforce(j.title, j.description)
  );
}

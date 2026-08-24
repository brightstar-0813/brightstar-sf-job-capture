import { config } from "../config.js";
import {
  containsSalesforce,
  isSalesforceEmployer,
  isRemoteArrangement,
  isUsFriendlyLocation,
  isWithinRecentDays,
  parsePostedDate,
  isLinkedinLink,
  LINKEDIN_URL_RECENT_DAYS,
} from "../filter.js";

export function emptySkipCounts() {
  return { employer: 0, nonRemote: 0, location: 0, nonSf: 0, stale: 0 };
}

export function isoDate(value) {
  const d = parsePostedDate(value);
  return d ? d.toISOString().slice(0, 10) : String(value || "");
}

/**
 * Shared keep/drop for JSON/RSS feed jobs. Mutates `counts`.
 */
export function keepFeedJob(job, counts, { skipRecency = false } = {}) {
  if (isSalesforceEmployer(job.organization)) {
    counts.employer += 1;
    return false;
  }
  if (!isRemoteArrangement(job.work_arrangement)) {
    counts.nonRemote += 1;
    return false;
  }
  if (!isUsFriendlyLocation(job.location, job.title)) {
    counts.location += 1;
    return false;
  }
  if (!containsSalesforce(job.title, job.description)) {
    counts.nonSf += 1;
    return false;
  }
  const days = isLinkedinLink(job.url)
    ? LINKEDIN_URL_RECENT_DAYS
    : config.recentDays;
  if (!skipRecency && isWithinRecentDays(job.date_posted, days) === false) {
    counts.stale += 1;
    return false;
  }
  return true;
}

export function logKept(source, kept, scanned, counts) {
  console.log(
    `[${source}] kept ${kept} remote Salesforce jobs` +
      ` (scanned=${scanned}, skipped employer=${counts.employer},` +
      ` non-remote=${counts.nonRemote}, location=${counts.location},` +
      ` non-Salesforce=${counts.nonSf}, stale=${counts.stale})`
  );
}

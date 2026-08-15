/**
 * Jobicy public remote-jobs API (tag=salesforce).
 * https://jobicy.com/api/v2/remote-jobs
 */

import { getJson } from "../http.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

function mapJob(j) {
  return {
    id: `jobicy_${j.id || j.jobSlug}`,
    title: j.jobTitle || "",
    organization: j.companyName || "",
    location: j.jobGeo || "",
    work_arrangement: "Remote",
    remote_restricted_to: "",
    experience_level: j.jobLevel || "",
    employment_type: j.jobType || "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "jobicy",
    date_posted: isoDate(j.pubDate),
    url: j.url || "",
    description: stripHtml(j.jobDescription || j.jobExcerpt).slice(0, 20000),
  };
}

export async function searchJobicyJobs() {
  const url = "https://jobicy.com/api/v2/remote-jobs?count=100&tag=salesforce";
  console.log(`[jobicy] ${url}`);
  const json = await getJson(url);
  const list = Array.isArray(json?.jobs) ? json.jobs : [];
  const kept = [];
  const seen = new Set();
  const counts = emptySkipCounts();

  for (const raw of list) {
    const job = mapJob(raw);
    if (!job.id || seen.has(job.id)) continue;
    seen.add(job.id);
    if (keepFeedJob(job, counts)) kept.push(job);
  }

  logKept("jobicy", kept.length, list.length, counts);
  return { jobs: kept };
}

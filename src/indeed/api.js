/**
 * Indeed via the mobile-app GraphQL API (apis.indeed.com/graphql) — plain HTTP,
 * no browser, login, or Cloudflare. Same endpoint python-jobspy uses.
 * Remote is expressed as location "Remote"; the API rejects combining the
 * date filter with a composite (attribute) filter.
 */

import { config } from "../config.js";
import { stripHtml } from "../filter.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

const ENDPOINT = "https://apis.indeed.com/graphql";
const HEADERS = {
  "content-type": "application/json",
  accept: "application/json",
  "indeed-api-key":
    "161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8",
  "indeed-locale": "en-US",
  "indeed-co": "US",
  "accept-language": "en-US,en;q=0.9",
  "indeed-app-info":
    "appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone",
  "user-agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Indeed App 193.1",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildQuery(what, cursor) {
  const days = Math.max(1, config.recentDays);
  return `query GetJobData {
  jobSearch(
    what: ${JSON.stringify(what)}
    location: { where: "Remote", radius: 25, radiusUnit: MILES }
    limit: 100
    ${cursor ? `cursor: ${JSON.stringify(cursor)}` : ""}
    sort: DATE
    filters: { date: { field: "dateOnIndeed", start: "${days}d" } }
  ) {
    pageInfo { nextCursor }
    results {
      job {
        key
        title
        datePublished
        description { html }
        location { formatted { long } }
        employer { name }
        attributes { key label }
        compensation {
          baseSalary { unitOfWork range { ... on Range { min max } } }
          currencyCode
        }
      }
    }
  }
}`;
}

/** Multi-word seeds are phrase-quoted; unquoted "Service Cloud" matches any "service". */
function queries() {
  const list = config.searchQueries?.length
    ? config.searchQueries
    : [config.searchQ || "Salesforce"];
  return list.map((q) => (/\s/.test(q) && !q.includes('"') ? `"${q}"` : q));
}

function mapJob(job) {
  const location = job.location?.formatted?.long || "";
  const attrs = Array.isArray(job.attributes) ? job.attributes : [];
  const remote =
    /remote/i.test(location) || attrs.some((a) => /remote/i.test(a?.label || ""));
  const jobTypes = attrs
    .map((a) => a?.label || "")
    .filter((l) => /^(full-time|part-time|contract|temporary|internship)$/i.test(l));
  const range = job.compensation?.baseSalary?.range || {};
  const unit = String(job.compensation?.baseSalary?.unitOfWork || "");

  return {
    id: `indeed_${job.key}`,
    title: job.title || "",
    organization: job.employer?.name || "",
    location,
    work_arrangement: remote ? "Remote" : "Onsite",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: jobTypes.join(", "),
    salary_min: range.min != null ? String(Math.round(range.min)) : "",
    salary_max: range.max != null ? String(Math.round(range.max)) : "",
    salary_currency: job.compensation?.currencyCode || "USD",
    salary_unit: unit,
    key_skills: "",
    source: "indeed",
    date_posted: job.datePublished ? isoDate(new Date(job.datePublished)) : "",
    url: `https://www.indeed.com/viewjob?jk=${encodeURIComponent(job.key)}`,
    description: stripHtml(job.description?.html || "").slice(0, 20000),
  };
}

async function postQuery(what, cursor) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query: buildQuery(what, cursor) }),
    signal: AbortSignal.timeout(45000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** @returns {Promise<{ jobs: object[], status: string, note: string }>} */
export async function searchIndeedApiJobs() {
  const seen = new Set();
  const kept = [];
  const counts = emptySkipCounts();
  let scanned = 0;
  let okRequests = 0;
  let lastError = "";
  const maxPages = Math.max(1, config.indeedMaxPages);

  for (const q of queries()) {
    let cursor = null;
    for (let page = 1; page <= maxPages; page += 1) {
      let resp;
      try {
        resp = await postQuery(q, cursor);
      } catch (err) {
        lastError = err.message;
        console.warn(`[indeed] query "${q}" page ${page} failed: ${err.message}`);
        break;
      }
      const search = resp.json?.data?.jobSearch;
      if (resp.status !== 200 || !search) {
        lastError =
          `HTTP ${resp.status}` +
          (resp.json?.errors?.[0]?.message ? ` ${resp.json.errors[0].message}` : "");
        console.warn(`[indeed] query "${q}" page ${page}: ${lastError.slice(0, 200)}`);
        break;
      }
      okRequests += 1;
      const results = Array.isArray(search.results) ? search.results : [];
      console.log(`[indeed] q="${q}" page ${page}: ${results.length} results`);
      for (const r of results) {
        const job = r?.job;
        if (!job?.key || seen.has(job.key)) continue;
        seen.add(job.key);
        scanned += 1;
        const mapped = mapJob(job);
        if (keepFeedJob(mapped, counts)) kept.push(mapped);
      }
      cursor = search.pageInfo?.nextCursor;
      if (!cursor || results.length === 0) break;
      await sleep(300 + config.delayMs);
    }
  }

  logKept("indeed", kept.length, scanned, counts);
  let status = kept.length ? "ok" : "empty";
  if (okRequests === 0) status = /40[13]|429/.test(lastError) ? "blocked" : "error";
  return { jobs: kept, status, note: okRequests === 0 ? lastError : "" };
}

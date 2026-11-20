/**
 * JobRight.ai Salesforce search — remote US roles, no browser.
 * Auth mode: /swan/recommend/search with cookies from `npm run jobright:login`
 * (remote + recency filters, paging). Anonymous mode (no / expired session):
 * public SSR search page, newest ~20 jobs per title, filtered locally.
 */

import { config } from "../config.js";
import {
  containsSalesforce,
  isBlockedEmployer,
  isRemoteArrangement,
  parsePostedDate,
  isWithinRecentDays,
} from "../filter.js";
import {
  isLinkedinJobUrl,
  pickJobrightJobUrl,
  buildJobrightDescription,
} from "./url.js";
import {
  fetchRecommendSearch,
  hasJobrightSession,
  isJobrightAuthError,
} from "./client.js";
import { fetchJobrightSsr } from "./ssr.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function buildJobrightSearchUrl(page = 1, query = config.searchQ) {
  const taxonomy = encodeURIComponent(
    JSON.stringify([{ taxonomyId: "00-00-00", title: query }])
  );
  const value = encodeURIComponent(query);
  const start = Math.max(0, (page - 1) * config.pageSize);
  return (
    `https://jobright.ai/jobs/search?visit=search&value=${value}` +
    `&searchType=job_title&country=US&jobTaxonomyList=${taxonomy}` +
    `&startPos=${start}`
  );
}

function parseSalary(salaryDesc) {
  const s = String(salaryDesc || "");
  const nums = [...s.matchAll(/\$?\s*([\d.]+)\s*K/gi)].map((m) =>
    Math.round(Number(m[1]) * 1000)
  );
  if (nums.length >= 2) {
    return { min: String(nums[0]), max: String(nums[1]), unit: "YEAR" };
  }
  if (nums.length === 1) {
    return { min: String(nums[0]), max: "", unit: "YEAR" };
  }
  return { min: "", max: "", unit: "" };
}

function mapApiJob(item) {
  const jr = item?.jobResult || {};
  const company = item?.companyResult || {};
  const id = jr.jobId ? `jobright_${jr.jobId}` : null;
  if (!id) return null;

  const salary = parseSalary(jr.salaryDesc);
  const applyLink = String(jr.applyLink || jr.originalUrl || "").trim();
  const originalUrl = String(jr.originalUrl || "").trim();
  const redirectsToLinkedin =
    isLinkedinJobUrl(applyLink) || isLinkedinJobUrl(originalUrl);
  const url = pickJobrightJobUrl(jr);

  const postedAbs = parsePostedDate(jr.publishTime) || parsePostedDate(jr.publishTimeDesc);
  const datePosted = postedAbs
    ? postedAbs.toISOString().slice(0, 10)
    : String(jr.publishTime || jr.publishTimeDesc || "");

  const workArrangement =
    jr.workModel || (jr.isRemote === true ? "Remote" : "Onsite");

  return {
    id,
    title: jr.jobTitle || jr.jobNlpTitle || "",
    organization: company.companyName || "",
    location: jr.jobLocation || (jr.jobLocations || [])[0] || "",
    work_arrangement: workArrangement,
    remote_restricted_to: "",
    experience_level: jr.jobSeniority || "",
    employment_type: jr.employmentType || "",
    salary_min: salary.min || (jr.minSalary != null ? String(jr.minSalary) : ""),
    salary_max: salary.max || (jr.maxSalary != null ? String(jr.maxSalary) : ""),
    salary_currency: "USD",
    salary_unit: salary.unit || (jr.minSalary || jr.maxSalary ? "YEAR" : ""),
    key_skills: "",
    source: "jobright",
    date_posted: datePosted,
    url,
    description: buildJobrightDescription(jr),
    _easyApply: jr.jobtargetEasyapply === true,
    _applyLink: applyLink,
    _isCompanySite: jr.isCompanySiteLink === true,
    _linkedinApply: redirectsToLinkedin,
    _expired: jr.isDeleted === true || jr.hiddenJob === true,
  };
}

function isSalesforceJob(mapped) {
  if (isBlockedEmployer(mapped.organization)) return false;
  return containsSalesforce(mapped.title, mapped.description);
}

/**
 * Fetch remote Salesforce jobs from JobRight (auth API, else anonymous SSR).
 * @param {import('playwright').Browser} [_browser] ignored — kept for capture.js compat
 * @returns {Promise<{ jobs: object[], status: string, note: string }>}
 */
export async function searchJobrightJobs(_browser) {
  const authPath = config.jobrightAuthPath;
  let mode = hasJobrightSession(authPath) ? "auth" : "anonymous";
  let authNote = "";
  if (mode === "auth") {
    console.log(`[jobright] mode=auth (session: ${authPath})`);
  } else {
    authNote = `no valid session in ${authPath}`;
    console.warn(
      `[jobright] WARNING ${authNote} — using anonymous SSR (newest ~20 per title). Run: npm run jobright:login`
    );
  }

  const all = [];
  const seen = new Set();
  let employerSkipped = 0;
  let nonRemoteSkipped = 0;
  let nonSalesforceSkipped = 0;
  let staleSkipped = 0;
  let expiredSkipped = 0;
  let linkedinSkipped = 0;
  let apiCount = 0;
  let queryOkCount = 0;

  const titles =
    config.jobrightTitles && config.jobrightTitles.length
      ? config.jobrightTitles
      : [config.searchQ];
  const pageSize = 20;
  const pagesPerTitle = Math.max(1, config.jobrightMaxPages);
  let challenged = false;
  let fetchErrors = 0;

  /** One page of results for `query`; switches to anonymous on auth errors. */
  async function fetchPage(query, page) {
    if (mode === "auth") {
      const position = page * pageSize;
      const api = await fetchRecommendSearch(authPath, {
        count: pageSize,
        query,
        daysAgo: config.recentDays,
        position,
      });
      const list = Array.isArray(api.jobList) ? api.jobList : [];
      console.log(
        `[jobright] auth query="${query}" page=${page + 1}/${pagesPerTitle} jobs=${list.length} jobNum=${api.jobNum ?? "?"} ok=${api.ok}` +
          (api.errorMsg ? ` err=${api.errorMsg}` : "")
      );
      if (isJobrightAuthError(api)) {
        mode = "anonymous";
        authNote = `session rejected (${api.status} ${api.errorMsg || ""})`.trim();
        console.warn(
          `[jobright] WARNING ${authNote} — switching to anonymous SSR. Run: npm run jobright:login`
        );
        return fetchPage(query, 0);
      }
      return { ok: api.ok, list, more: list.length >= pageSize };
    }

    if (page > 0) return { ok: true, list: [], more: false };
    let ssr = await fetchJobrightSsr(query);
    if (ssr.challenged) {
      console.warn(`[jobright] anonymous rate-limit challenge — backing off 30s`);
      await sleep(30000);
      ssr = await fetchJobrightSsr(query);
    }
    console.log(
      `[jobright] anonymous query="${query}" jobs=${ssr.jobList.length} ok=${ssr.ok}` +
        (ssr.via ? ` via=${ssr.via}` : "") +
        (ssr.challenged ? " CHALLENGED" : ssr.ok ? "" : ` status=${ssr.status}`)
    );
    if (ssr.challenged) challenged = true;
    await sleep(400 + config.delayMs);
    return { ok: ssr.ok, list: ssr.jobList, more: false };
  }

  for (const query of titles) {
    if (challenged) break;
    let titleOk = false;
    for (let page = 0; page < pagesPerTitle; page += 1) {
      let res;
      try {
        res = await fetchPage(query, page);
      } catch (err) {
        fetchErrors += 1;
        console.warn(`[jobright] query="${query}" page=${page + 1} failed: ${err.message}`);
        break;
      }
      const list = res.list;
      apiCount += list.length;
      if (res.ok) titleOk = true;
      if (!res.ok || !list.length) break;

      for (const item of list) {
        const mapped = mapApiJob(item);
        if (!mapped) continue;

        if (seen.has(mapped.id)) continue;
        seen.add(mapped.id);

        if (mapped._expired) {
          expiredSkipped += 1;
          continue;
        }
        if (mapped._linkedinApply) {
          linkedinSkipped += 1;
          continue;
        }
        if (isBlockedEmployer(mapped.organization)) {
          employerSkipped += 1;
          continue;
        }
        if (!isRemoteArrangement(mapped.work_arrangement)) {
          nonRemoteSkipped += 1;
          continue;
        }
        if (!isSalesforceJob(mapped)) {
          nonSalesforceSkipped += 1;
          continue;
        }
        if (isWithinRecentDays(mapped.date_posted, config.recentDays) === false) {
          staleSkipped += 1;
          continue;
        }
        if (/linkedin\.com/i.test(mapped.url || "")) {
          linkedinSkipped += 1;
          continue;
        }

        delete mapped._easyApply;
        delete mapped._applyLink;
        delete mapped._isCompanySite;
        delete mapped._linkedinApply;
        delete mapped._expired;
        all.push(mapped);
      }

      if (!res.more) break;
    }
    if (titleOk) queryOkCount += 1;
  }

  console.log(
    `[jobright] mode=${mode} kept ${all.length} remote Salesforce jobs` +
      ` (titles=${titles.length}, api=${apiCount}, okQueries=${queryOkCount}/${titles.length},` +
      ` skipped blocked-employer=${employerSkipped},` +
      ` skipped non-remote=${nonRemoteSkipped}, skipped non-Salesforce=${nonSalesforceSkipped},` +
      ` skipped expired=${expiredSkipped},` +
      ` skipped LinkedIn-apply=${linkedinSkipped},` +
      ` skipped stale(>${config.recentDays}d)=${staleSkipped})`
  );

  let status = all.length ? "ok" : "empty";
  if (queryOkCount === 0 && titles.length) status = challenged ? "blocked" : "error";
  else if (mode === "anonymous") status = all.length ? "degraded" : "auth";
  const note = [
    `mode=${mode}`,
    authNote,
    challenged ? "anonymous search hit security challenge" : "",
    fetchErrors ? `${fetchErrors} request(s) failed` : "",
  ]
    .filter(Boolean)
    .join("; ");

  return { jobs: all, status, note };
}

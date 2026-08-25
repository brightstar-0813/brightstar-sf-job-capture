/**
 * JobRight.ai Salesforce search — remote US roles via recommend/search API only.
 * No browser tabs, no Chrome extension. Session from `npm run jobright:login`.
 */

import fs from "fs";
import { config } from "../config.js";
import {
  containsSalesforce,
  isSalesforceEmployer,
  isRemoteArrangement,
  parsePostedDate,
  isWithinRecentDays,
} from "../filter.js";
import {
  isLinkedinJobUrl,
  pickJobrightJobUrl,
  buildJobrightDescription,
} from "./url.js";
import { fetchRecommendSearch, fetchAppliedJobIds } from "./client.js";

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
  if (isSalesforceEmployer(mapped.organization)) return false;
  return containsSalesforce(mapped.title, mapped.description);
}

/**
 * Fetch remote Salesforce jobs from JobRight API (no browser).
 * @param {import('playwright').Browser} [_browser] ignored — kept for capture.js compat
 */
export async function searchJobrightJobs(_browser) {
  const authPath = config.jobrightAuthPath;
  const hasAuth = fs.existsSync(authPath);
  if (hasAuth) {
    console.log(`[jobright] API-only mode, auth: ${authPath}`);
  } else {
    console.warn(
      `[jobright] no auth at ${authPath} — run: npm run jobright:login`
    );
  }

  const all = [];
  const seen = new Set();
  let employerSkipped = 0;
  let nonRemoteSkipped = 0;
  let nonSalesforceSkipped = 0;
  let appliedSkipped = 0;
  let staleSkipped = 0;
  let expiredSkipped = 0;
  let linkedinSkipped = 0;
  let apiCount = 0;
  let queryOkCount = 0;
  let appliedIds = new Set();

  const titles =
    config.jobrightTitles && config.jobrightTitles.length
      ? config.jobrightTitles
      : [config.searchQ];
  const perTitle = Math.max(10, Math.min(100, config.pageSize * config.jobrightMaxPages));

  if (hasAuth && appliedIds.size === 0) {
    const applied = await fetchAppliedJobIds(authPath).catch(() => null);
    if (applied?.ok && applied.ids.length) {
      appliedIds = new Set(applied.ids);
      console.log(`[jobright] already-applied jobs to exclude: ${appliedIds.size}`);
    }
  }

  for (const query of titles) {
    console.log(`[jobright] API recommend/search query="${query}" count=${perTitle}`);
    const api = await fetchRecommendSearch(authPath, {
      count: perTitle,
      query,
      daysAgo: config.recentDays,
      position: 0,
    });
    const list = Array.isArray(api.jobList) ? api.jobList : [];
    apiCount += list.length;
    if (api.ok) queryOkCount += 1;
    console.log(
      `[jobright] query="${query}" api jobs=${list.length} jobNum=${api.jobNum ?? "?"} ok=${api.ok}`
    );

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
      if (appliedIds.has(mapped.id)) {
        appliedSkipped += 1;
        continue;
      }
      if (isSalesforceEmployer(mapped.organization)) {
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
  }

  const unauthenticated = !hasAuth || (titles.length > 0 && queryOkCount === 0);

  console.log(
    `[jobright] kept ${all.length} remote Salesforce jobs` +
      ` (titles=${titles.length}, api=${apiCount}, okQueries=${queryOkCount}/${titles.length},` +
      ` skipped Salesforce-employer=${employerSkipped},` +
      ` skipped non-remote=${nonRemoteSkipped}, skipped non-Salesforce=${nonSalesforceSkipped},` +
      ` skipped already-applied=${appliedSkipped}, skipped expired=${expiredSkipped},` +
      ` skipped LinkedIn-apply=${linkedinSkipped},` +
      ` skipped stale(>${config.recentDays}d)=${staleSkipped})`
  );
  if (unauthenticated) {
    console.warn(
      `[jobright] session unauthenticated (login missing or expired) — run: npm run jobright:login`
    );
  }

  return {
    jobs: all,
    appliedIds: Array.from(appliedIds),
    auth: {
      hadAuthFile: hasAuth,
      attempts: titles.length,
      okQueries: queryOkCount,
      unauthenticated,
    },
  };
}

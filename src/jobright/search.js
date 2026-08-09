/**
 * JobRight.ai Salesforce search — keep APPLY WITH AUTOFILL only
 * (skip APPLY NOW / LinkedIn redirects).
 *
 * Jobs load via POST /swan/recommend/search (not __NEXT_DATA__.jobList).
 */

import fs from "fs";
import { config } from "../config.js";
import {
  containsSalesforce,
  isSalesforceEmployer,
  isLinkedinLink,
} from "../filter.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function buildDescription(jr) {
  const parts = [];
  if (jr.jobSummary) parts.push(String(jr.jobSummary).trim());
  if (Array.isArray(jr.coreResponsibilities) && jr.coreResponsibilities.length) {
    parts.push("Responsibilities:\n- " + jr.coreResponsibilities.join("\n- "));
  }
  if (Array.isArray(jr.requirements) && jr.requirements.length) {
    parts.push("Requirements:\n- " + jr.requirements.join("\n- "));
  }
  return parts.join("\n\n").trim();
}

function mapApiJob(item) {
  const jr = item?.jobResult || {};
  const company = item?.companyResult || {};
  const id = jr.jobId ? `jobright_${jr.jobId}` : null;
  if (!id) return null;

  const salary = parseSalary(jr.salaryDesc);
  const url = (
    jr.url ||
    `https://jobright.ai/jobs/info/${jr.jobId}`
  ).split("?")[0];

  return {
    id,
    title: jr.jobTitle || jr.jobNlpTitle || "",
    organization: company.companyName || "",
    location: jr.jobLocation || (jr.jobLocations || [])[0] || "",
    work_arrangement: jr.workModel || (jr.isRemote ? "Remote" : ""),
    remote_restricted_to: "",
    experience_level: jr.jobSeniority || "",
    employment_type: jr.employmentType || "",
    salary_min: salary.min || (jr.minSalary != null ? String(jr.minSalary) : ""),
    salary_max: salary.max || (jr.maxSalary != null ? String(jr.maxSalary) : ""),
    salary_currency: "USD",
    salary_unit: salary.unit || (jr.minSalary || jr.maxSalary ? "YEAR" : ""),
    key_skills: "",
    source: "jobright",
    date_posted: jr.publishTime || jr.publishTimeDesc || "",
    url,
    description: buildDescription(jr),
    _easyApply: jr.jobtargetEasyapply === true,
    _applyLink: String(jr.applyLink || jr.originalUrl || ""),
    _isCompanySite: jr.isCompanySiteLink === true,
  };
}

function isSalesforceJob(mapped) {
  if (isSalesforceEmployer(mapped.organization)) return false;
  return containsSalesforce(mapped.title, mapped.description);
}

/**
 * Exclude jobs whose apply/job link points to LinkedIn (redirect applications
 * we don't want). Everything else from the API is accepted.
 */
function isLinkedinApply(mapped) {
  return isLinkedinLink(mapped._applyLink, mapped.url);
}

/**
 * Fetch job list via JobRight's recommend/search API (session cookies).
 * @param {import('playwright').Page} page
 */
async function fetchRecommendJobs(
  page,
  { count, position = 0, refresh = true, query = config.searchQ }
) {
  const value = query;
  return page.evaluate(
    async ({ value, count, position, refresh }) => {
      const body = {
        searchType: "job_title",
        value,
        jobTaxonomyList: [{ taxonomyId: "00-00-00", title: value }],
        country: "US",
        jobTypes: [],
        seniority: [],
        workModel: [],
        locations: [],
        companies: [],
        isH1BOnly: false,
        companyCategory: null,
        annualSalaryMinimum: null,
        roleType: null,
        companyStages: null,
        skills: [],
        excludedCompanies: [],
        excludedSkills: null,
        excludeStaffingAgency: false,
        minYearsOfExperienceRange: null,
        excludeCompanyCategory: [],
        excludeSecurityClearance: false,
        excludeUsCitizen: false,
        refresh,
        position,
        sortCondition: 0,
      };
      const url =
        `https://jobright.ai/swan/recommend/search?searchType=job_title` +
        `&refresh=${refresh ? "true" : "false"}&count=${count}` +
        `&position=${position}&sortCondition=0`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
        },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        return { ok: false, status: res.status, jobList: [] };
      }
      const json = await res.json();
      return {
        ok: !!json?.success,
        status: res.status,
        jobList: json?.result?.jobList || [],
        jobNum: json?.result?.jobNum,
      };
    },
    { value, count, position, refresh }
  );
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchJobrightJobs(browser) {
  const hasAuth = fs.existsSync(config.jobrightAuthPath);
  const contextOptions = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  };
  if (hasAuth) {
    contextOptions.storageState = config.jobrightAuthPath;
    console.log(`[jobright] using auth: ${config.jobrightAuthPath}`);
  } else {
    console.warn(
      `[jobright] no auth file at ${config.jobrightAuthPath} — APPLY WITH AUTOFILL may be hidden. Run: npm run jobright:login`
    );
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const all = [];
  const seen = new Set();
  let linkedinSkipped = 0;
  let employerSkipped = 0;
  let nonSalesforceSkipped = 0;
  let apiCount = 0;
  let queryOkCount = 0;

  const titles =
    config.jobrightTitles && config.jobrightTitles.length
      ? config.jobrightTitles
      : [config.searchQ];
  const perTitle = Math.max(10, Math.min(100, config.pageSize * config.jobrightMaxPages));

  try {
    for (const query of titles) {
      const url = buildJobrightSearchUrl(1, query);
      console.log(`[jobright] query="${query}" open: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500 + config.delayMs);

      console.log(
        `[jobright] fetching recommend/search query="${query}" count=${perTitle}`
      );
      const api = await fetchRecommendJobs(page, {
        count: perTitle,
        position: 0,
        refresh: true,
        query,
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

        if (isLinkedinApply(mapped)) {
          linkedinSkipped += 1;
          continue;
        }
        if (isSalesforceEmployer(mapped.organization)) {
          employerSkipped += 1;
          continue;
        }
        if (!isSalesforceJob(mapped)) {
          nonSalesforceSkipped += 1;
          continue;
        }

        delete mapped._easyApply;
        delete mapped._applyLink;
        delete mapped._isCompanySite;
        all.push(mapped);
      }
    }
  } finally {
    await context.close();
  }

  // Session is considered unauthenticated (login missing/expired) when there
  // was no auth file, or every recommend/search query failed (ok=false). A
  // valid session returns ok=true even when there are zero matching jobs.
  const unauthenticated = !hasAuth || (titles.length > 0 && queryOkCount === 0);

  console.log(
    `[jobright] kept ${all.length} Salesforce jobs` +
      ` (titles=${titles.length}, api=${apiCount}, okQueries=${queryOkCount}/${titles.length},` +
      ` skipped LinkedIn=${linkedinSkipped}, skipped Salesforce-employer=${employerSkipped},` +
      ` skipped non-Salesforce=${nonSalesforceSkipped})`
  );
  if (unauthenticated) {
    console.warn(
      `[jobright] session unauthenticated (login missing or expired) — run: npm run jobright:login`
    );
  }

  return {
    jobs: all,
    auth: {
      hadAuthFile: hasAuth,
      attempts: titles.length,
      okQueries: queryOkCount,
      unauthenticated,
    },
  };
}

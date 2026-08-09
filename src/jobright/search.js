/**
 * JobRight.ai Salesforce search — keep APPLY WITH AUTOFILL only
 * (skip APPLY NOW / LinkedIn redirects).
 *
 * Jobs load via POST /swan/recommend/search (not __NEXT_DATA__.jobList).
 */

import fs from "fs";
import { config } from "../config.js";
import { containsSalesforce, isSalesforceEmployer } from "../filter.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function buildJobrightSearchUrl(page = 1) {
  const taxonomy = encodeURIComponent(
    JSON.stringify([{ taxonomyId: "00-00-00", title: config.searchQ }])
  );
  const value = encodeURIComponent(config.searchQ);
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
 * Prefer DOM label; fall back to apply-link heuristics.
 * APPLY NOW ≈ LinkedIn redirect; AUTOFILL ≈ company ATS.
 */
function isAutofillJob(mapped, btnLabel) {
  const btn = String(btnLabel || "").toUpperCase();
  if (/APPLY NOW/.test(btn) && !/AUTOFILL/.test(btn)) return false;
  if (/AUTOFILL/.test(btn)) return true;
  if (mapped._easyApply) return true;
  const link = mapped._applyLink || "";
  if (/linkedin\.com/i.test(link)) return false;
  if (mapped._isCompanySite) return true;
  // Unknown apply type — skip (strict autofill preference)
  return false;
}

/**
 * Read apply button label near a job info link.
 * @param {import('playwright').Page} page
 */
async function readApplyButtons(page) {
  return page.evaluate(() => {
    const out = {};
    const links = Array.from(document.querySelectorAll('a[href*="/jobs/info/"]'));
    for (const a of links) {
      const href = (a.href || "").split("?")[0];
      const id = href.split("/").pop();
      if (!id) continue;
      let el = a;
      let label = "";
      for (let i = 0; i < 12 && el; i += 1) {
        const txt = el.innerText || "";
        const m = txt.match(/APPLY WITH AUTOFILL|APPLY NOW/i);
        if (m && txt.length < 2500) {
          label = m[0].toUpperCase();
          break;
        }
        el = el.parentElement;
      }
      if (label) out[id] = label;
    }
    return out;
  });
}

async function collectApplyButtons(page, scrolls = 10) {
  const buttons = {};
  for (let i = 0; i < scrolls; i += 1) {
    Object.assign(buttons, await readApplyButtons(page));
    await page.evaluate(() => window.scrollBy(0, 1400));
    await page.waitForTimeout(500);
  }
  Object.assign(buttons, await readApplyButtons(page));
  return buttons;
}

/**
 * Fetch job list via JobRight's recommend/search API (session cookies).
 * @param {import('playwright').Page} page
 */
async function fetchRecommendJobs(page, { count, position = 0, refresh = true }) {
  const value = config.searchQ;
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
  let autofillCount = 0;
  let applyNowSkipped = 0;
  let apiCount = 0;

  const pageCount = Math.max(1, config.jobrightMaxPages);
  const perPage = Math.max(10, Math.min(50, config.pageSize));
  const totalWanted = Math.min(100, perPage * pageCount);

  try {
    const url = buildJobrightSearchUrl(1);
    console.log(`[jobright] open: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500 + config.delayMs);

    // Ensure search value is applied
    const input = page
      .locator('input[placeholder*="Search" i], input[type="search"]')
      .first();
    try {
      if (await input.count()) {
        const current = await input.inputValue().catch(() => "");
        if (!new RegExp(config.searchQ, "i").test(current)) {
          await input.click({ timeout: 3000 });
          await input.fill(config.searchQ);
          await page.keyboard.press("Enter");
          await page.waitForTimeout(4000);
        }
      }
    } catch {
      /* ignore */
    }

    console.log(`[jobright] fetching recommend/search count=${totalWanted}`);
    const api = await fetchRecommendJobs(page, {
      count: totalWanted,
      position: 0,
      refresh: true,
    });
    const list = Array.isArray(api.jobList) ? api.jobList : [];
    apiCount = list.length;
    console.log(
      `[jobright] api jobs=${apiCount} jobNum=${api.jobNum ?? "?"} ok=${api.ok}`
    );

    const buttons = await collectApplyButtons(page, 12);
    console.log(
      `[jobright] dom apply labels=${Object.keys(buttons).length}` +
        ` autofill=${Object.values(buttons).filter((b) => /AUTOFILL/i.test(b)).length}` +
        ` applyNow=${Object.values(buttons).filter((b) => /^APPLY NOW$/i.test(b)).length}`
    );

    for (const item of list) {
      const mapped = mapApiJob(item);
      if (!mapped) continue;
      const rawId = mapped.id.replace(/^jobright_/, "");
      const btn = buttons[rawId] || "";

      if (!isAutofillJob(mapped, btn)) {
        applyNowSkipped += 1;
        continue;
      }
      autofillCount += 1;

      if (seen.has(mapped.id)) continue;
      seen.add(mapped.id);

      if (!isSalesforceJob(mapped)) continue;

      delete mapped._easyApply;
      delete mapped._applyLink;
      delete mapped._isCompanySite;
      all.push(mapped);
    }
  } finally {
    await context.close();
  }

  console.log(
    `[jobright] kept ${all.length} autofill Salesforce jobs` +
      ` (api=${apiCount}, skipped non-autofill≈${applyNowSkipped}, autofillSeen≈${autofillCount})`
  );
  return all;
}

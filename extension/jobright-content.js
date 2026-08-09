/**
 * JobRight content script — extract APPLY WITH AUTOFILL Salesforce jobs
 * via POST /swan/recommend/search + DOM apply labels.
 *
 * Wrapped in a guarded IIFE: this file is both a manifest content_script AND
 * injected on demand via chrome.scripting.executeScript. Without the guard the
 * second injection redeclares the top-level consts ("Identifier already
 * declared") and adds a duplicate message listener.
 */

(function () {
  if (window.__SF_JOBRIGHT_CS_LOADED__) return;
  window.__SF_JOBRIGHT_CS_LOADED__ = true;

const SALESFORCE_RE = /\bSalesforce\b/i;
// Salesforce as an employer (exclude), but not staffing firms whose name merely
// contains "Salesforce".
const SALESFORCE_EMPLOYER_RE = /^\s*salesforce(?:\.com|,?\s*inc\.?)?\s*$/i;

function containsSalesforce(title, description) {
  return (
    SALESFORCE_RE.test(String(title || "")) ||
    SALESFORCE_RE.test(String(description || ""))
  );
}

function isSalesforceEmployer(organization) {
  return SALESFORCE_EMPLOYER_RE.test(String(organization || "").trim());
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

function parseSalary(salaryDesc) {
  const s = String(salaryDesc || "");
  const nums = [...s.matchAll(/\$?\s*([\d.]+)\s*K/gi)].map((m) =>
    Math.round(Number(m[1]) * 1000)
  );
  if (nums.length >= 2) return { min: String(nums[0]), max: String(nums[1]), unit: "YEAR" };
  if (nums.length === 1) return { min: String(nums[0]), max: "", unit: "YEAR" };
  return { min: "", max: "", unit: "" };
}

function mapItem(item, applyLabel) {
  const jr = item?.jobResult || {};
  const company = item?.companyResult || {};
  if (!jr.jobId) return null;
  const salary = parseSalary(jr.salaryDesc);
  const url = (`https://jobright.ai/jobs/info/${jr.jobId}`).split("?")[0];
  return {
    id: `jobright_${jr.jobId}`,
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
    applyLabel,
    jobtargetEasyapply: jr.jobtargetEasyapply === true,
    _applyLink: String(jr.applyLink || jr.originalUrl || ""),
    _isCompanySite: jr.isCompanySiteLink === true,
  };
}

function isLinkedinApply(mapped) {
  const link = String(mapped._applyLink || "");
  const url = String(mapped.url || "");
  return /linkedin\.com/i.test(link) || /linkedin\.com/i.test(url);
}

function isSalesforceJob(mapped) {
  if (isSalesforceEmployer(mapped.organization)) return false;
  return containsSalesforce(mapped.title, mapped.description);
}

async function fetchRecommendJobs(query, count = 50) {
  const value = query || "Salesforce";
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
    refresh: true,
    position: 0,
    sortCondition: 0,
  };
  const url =
    `https://jobright.ai/swan/recommend/search?searchType=job_title` +
    `&refresh=true&count=${count}&position=0&sortCondition=0`;
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
    throw new Error(`recommend/search HTTP ${res.status}`);
  }
  const json = await res.json();
  return {
    list: json?.result?.jobList || [],
    jobNum: json?.result?.jobNum,
    success: !!json?.success,
  };
}

async function ensureSearch(query) {
  const q = query || "Salesforce";
  if (/value=/i.test(location.href)) return;
  const input = document.querySelector(
    'input[placeholder*="Search" i], input[type="search"]'
  );
  if (!input) return;
  input.focus();
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.value = q;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  );
  await new Promise((r) => setTimeout(r, 3500));
}

async function scrapeAutofillJobs(query) {
  await ensureSearch(query);

  const { list, jobNum, success } = await fetchRecommendJobs(query, 50);

  const kept = [];
  let skippedLinkedin = 0;

  for (const item of list) {
    const mapped = mapItem(item, "");
    if (!mapped) continue;

    if (isLinkedinApply(mapped)) {
      skippedLinkedin += 1;
      continue;
    }
    if (!isSalesforceJob(mapped)) continue;

    delete mapped._applyLink;
    delete mapped._isCompanySite;
    kept.push(mapped);
  }

  return {
    ok: true,
    jobs: kept,
    stats: {
      apiCount: list.length,
      jobNum: jobNum ?? null,
      apiOk: success,
      kept: kept.length,
      skippedLinkedin,
      href: location.href,
    },
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "SCRAPE_JOBRIGHT") return;
  scrapeAutofillJobs(msg.query || "Salesforce")
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: err.message, jobs: [] }));
  return true;
});
})();

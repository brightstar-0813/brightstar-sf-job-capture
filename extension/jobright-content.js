/**
 * JobRight content script — extract remote Salesforce jobs via
 * POST /swan/recommend/search (skip LinkedIn / applied / non-remote / expired).
 *
 * Wrapped in a guarded IIFE: this file is both a manifest content_script AND
 * injected on demand via chrome.scripting.executeScript. Without the guard the
 * second injection redeclares the top-level consts ("Identifier already
 * declared") and adds a duplicate message listener.
 */

(function () {
  // Bump when scrape/API body changes so executeScript can replace a stale
  // injection (old code used workModel: ["Remote"] → HTTP 400).
  const CS_VERSION = 6;
  if (window.__SF_JOBRIGHT_CS_VERSION__ === CS_VERSION) return;
  if (typeof window.__SF_JOBRIGHT_CS_LISTENER__ === "function") {
    try {
      chrome.runtime.onMessage.removeListener(window.__SF_JOBRIGHT_CS_LISTENER__);
    } catch {
      /* ignore */
    }
  }
  window.__SF_JOBRIGHT_CS_VERSION__ = CS_VERSION;
  window.__SF_JOBRIGHT_CS_LOADED__ = true;

const SF_PRODUCT_RE = /salesforce|salesfoce|salseforce|health\s*cloud|healthcloud|salesforce\s+data\s*cloud|datacloud|marketing\s*cloud|service\s*cloud|commerce\s*cloud|experience\s*cloud|community\s*cloud|revenue\s*cloud|sales\s*cloud|industry\s*cloud|financial\s*services\s*cloud|nonprofit\s*cloud|education\s*cloud|manufacturing\s*cloud|consumer\s*goods\s*cloud|public\s*sector\s*cloud|communications\s*cloud|\bnpsp\b|agentforce|omnistudio|vlocity|\bsfmc\b|\bsfcc\b|pardot|account\s+engagement|lightning\s+web\s+components|\blwc\b|steelbrick|salesforce\s+cpq|salesforce\s+flow|\bsoql\b|\bsosl\b|\bmulesoft\b|einstein\s+(gpt|copilot|analytics|for\s+sales|for\s+service)|apex\s+(class(?:es)?|trigger(?:s)?|code|developer|programming)/i;
const SF_STRONG_JD_RE = /health\s*cloud|healthcloud|salesforce\s+data\s*cloud|datacloud|marketing\s*cloud|service\s*cloud|commerce\s*cloud|experience\s*cloud|community\s*cloud|revenue\s*cloud|sales\s*cloud|financial\s*services\s*cloud|nonprofit\s*cloud|\bnpsp\b|agentforce|omnistudio|vlocity|\bsfmc\b|\bsfcc\b|pardot|account\s+engagement|lightning\s+web\s+components|\blwc\b|steelbrick|salesforce\s+cpq|\bsoql\b|\bsosl\b|\bmulesoft\b|apex\s+(class(?:es)?|trigger(?:s)?|code|developer|programming)/i;
const SF_ROLE_IN_JD_RE = /\bsalesforce\s+(admin(?:istrator)?|developer|architect|consultant|engineer|platform|cpq|commerce|flow|lightning|certified|experience|marketing\s+cloud|service\s+cloud|health\s+cloud|data\s+cloud)/i;
const OTHER_CRM_RE = /hubspot|microsoft\s*dynamics|dynamics\s*365|zoho|pipedrive|oracle\s*(crm|sales)?|sap\s*crm|freshsales|sugarcrm|zendesk|servicenow|veeva|salesloft/i;
const COMPETING_PLATFORM_RE = /\b(magento|shopify|woocommerce|servicenow|workday|veeva|hubspot|salesloft|docusign|sap\b|oracle|epic\b|netsuite)\b/i;
// Salesforce as an employer (exclude), but not staffing firms whose name merely
// contains "Salesforce".
const SALESFORCE_EMPLOYER_RE = /^\s*salesforce(?:\.com|,?\s*inc\.?)?\s*$/i;

function isPassingCrmMention(description) {
  const d = String(description || "");
  if (/salesforce\s*[,;/|&]\s*/i.test(d) && OTHER_CRM_RE.test(d)) return true;
  if (OTHER_CRM_RE.test(d) && /[,;/|&]\s*salesforce\b/i.test(d)) return true;
  if (/(such as|including|e\.g\.|for example|like)\s+[^\n.]{0,60}salesforce/i.test(d)) return true;
  if (/salesforce\s+(or|and)\s+(similar|equivalent|other|hubspot|dynamics)/i.test(d)) return true;
  return false;
}

function containsSalesforce(title, description) {
  const t = String(title || "");
  const d = String(description || "");
  if (SF_PRODUCT_RE.test(t) || (/\bcpq\b/i.test(t) && !/\b(oracle|sap)\b/i.test(t))) return true;
  if (COMPETING_PLATFORM_RE.test(t) && !SF_PRODUCT_RE.test(t)) return false;
  if (!t.trim()) {
    return (SF_STRONG_JD_RE.test(d) || SF_ROLE_IN_JD_RE.test(d)) && !isPassingCrmMention(d);
  }
  const titleLooksSf =
    SF_PRODUCT_RE.test(t) ||
    (/\bcpq\b/i.test(t) && !/\b(oracle|sap)\b/i.test(t)) ||
    (/\bcrm\b/i.test(t) && !OTHER_CRM_RE.test(t));
  if (!titleLooksSf) return false;
  if (isPassingCrmMention(d)) return false;
  return SF_STRONG_JD_RE.test(d) || SF_ROLE_IN_JD_RE.test(d);
}

function isSalesforceEmployer(organization) {
  return SALESFORCE_EMPLOYER_RE.test(String(organization || "").trim());
}

function isRemoteArrangement(workArrangement) {
  const w = String(workArrangement || "").toLowerCase().trim();
  if (!w) return true;
  if (/hybrid/.test(w)) return false;
  if (/on[-\s]?site|onsite|in[-\s]?office|in[-\s]?person/.test(w)) return false;
  return /\bremote\b/.test(w);
}

// Only keep jobs posted within this many days (mirror of RECENT_DAYS).
const RECENT_DAYS = 7;

function parsePostedDate(value, now) {
  now = now || new Date();
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = String(Math.trunc(n)).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim().toLowerCase();
  if (/(^|\b)(just posted|today|moments? ago|minutes? ago|hours? ago|<\s*1\s*day)/.test(s)) {
    return now;
  }
  if (/\byesterday\b/.test(s)) return new Date(now.getTime() - 864e5);
  const rel = s.match(/(\d+)\+?\s*(hour|day|week|month|year)s?\s*ago/);
  if (rel) {
    const unit = { hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[rel[2]];
    return new Date(now.getTime() - Number(rel[1]) * unit);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function isWithinRecentDays(value, days, now) {
  now = now || new Date();
  const d = parsePostedDate(value, now);
  if (!d) return null;
  const age = now.getTime() - d.getTime();
  if (age < 0) return true;
  return age <= days * 864e5;
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
  const applyLink = String(jr.applyLink || jr.originalUrl || "").trim();
  const fallbackUrl = (`https://jobright.ai/jobs/info/${jr.jobId}`).split("?")[0];
  const preferApply =
    applyLink &&
    !/linkedin\.com/i.test(applyLink) &&
    (jr.isCompanySiteLink === true ||
      /greenhouse\.io|jobs\.lever\.co|ashbyhq\.com|indeed\.com|dice\.com/i.test(
        applyLink
      ));
  const url = (preferApply ? applyLink : fallbackUrl).split("?")[0];
  const postedAbs =
    parsePostedDate(jr.publishTime) || parsePostedDate(jr.publishTimeDesc);
  const datePosted = postedAbs
    ? postedAbs.toISOString().slice(0, 10)
    : String(jr.publishTime || jr.publishTimeDesc || "");
  const workArrangement =
    jr.workModel || (jr.isRemote === true ? "Remote" : "Onsite");
  return {
    id: `jobright_${jr.jobId}`,
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
    description: buildDescription(jr),
    applyLabel,
    jobtargetEasyapply: jr.jobtargetEasyapply === true,
    _applyLink: applyLink,
    _isCompanySite: jr.isCompanySiteLink === true,
    _expired: jr.isDeleted === true || jr.hiddenJob === true,
  };
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
    // JobRight expects integer enums: 1=Onsite, 2=Remote, 3=Hybrid
    workModel: [2],
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
    daysAgo: RECENT_DAYS,
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
      "x-client-type": "web",
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

async function fetchAppliedJobIds() {
  const ids = new Set();
  let cursor = null;
  for (let i = 0; i < 20; i += 1) {
    let res;
    try {
      res = await fetch("https://jobright.ai/swan/job/applied/jobs-v3", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
          "x-client-type": "web",
        },
        body: JSON.stringify({ cursor, pageSize: 50, applyStatus: 0 }),
        credentials: "include",
      });
    } catch {
      break;
    }
    if (!res.ok) break;
    const json = await res.json().catch(() => null);
    const result = json?.result || {};
    const list = Array.isArray(result.list) ? result.list : [];
    for (const it of list) {
      const jobId = it?.jobResult?.jobId || it?.jobId;
      if (jobId) ids.add(`jobright_${jobId}`);
    }
    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }
  return ids;
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

async function scrapeJobrightJobs(titles) {
  const listTitles =
    Array.isArray(titles) && titles.length
      ? titles
      : ["Salesforce Administrator"];

  const byId = new Map();
  let apiCount = 0;
  let skippedApplied = 0;
  let skippedStale = 0;
  let skippedExpired = 0;
  let appliedTotal = 0;
  let okQueries = 0;

  // Applied list once per run (same session cookies).
  const appliedIds = await fetchAppliedJobIds();
  appliedTotal = appliedIds.size;

  for (const query of listTitles) {
    await ensureSearch(query);
    let list = [];
    let success = false;
    try {
      const api = await fetchRecommendJobs(query, 50);
      list = api.list || [];
      success = !!api.success;
      if (success) okQueries += 1;
    } catch (err) {
      console.warn("[jobright-cs] fetch failed", query, err.message);
      continue;
    }
    apiCount += list.length;

    for (const item of list) {
      const mapped = mapItem(item, "");
      if (!mapped) continue;
      if (byId.has(mapped.id)) continue;

      if (mapped._expired) {
        skippedExpired += 1;
        continue;
      }
      if (appliedIds.has(mapped.id)) {
        skippedApplied += 1;
        continue;
      }
      if (!isRemoteArrangement(mapped.work_arrangement)) continue;
      if (!isSalesforceJob(mapped)) continue;
      if (isWithinRecentDays(mapped.date_posted, RECENT_DAYS) === false) {
        skippedStale += 1;
        continue;
      }
      if (/linkedin\.com/i.test(mapped.url || "")) {
        skippedStale += 1;
        continue;
      }

      delete mapped._applyLink;
      delete mapped._isCompanySite;
      delete mapped._expired;
      byId.set(mapped.id, mapped);
    }
  }

  const kept = Array.from(byId.values());
  if (okQueries === 0 && listTitles.length > 0) {
    return {
      ok: false,
      error:
        "JobRight recommend/search failed for all titles (check login / API body)",
      jobs: [],
      stats: {
        apiCount,
        okQueries,
        titles: listTitles.length,
        kept: 0,
        csVersion: CS_VERSION,
        href: location.href,
      },
    };
  }
  return {
    ok: true,
    jobs: kept,
    stats: {
      apiCount,
      okQueries,
      titles: listTitles.length,
      kept: kept.length,
      skippedApplied,
      skippedStale,
      skippedExpired,
      appliedTotal,
      csVersion: CS_VERSION,
      href: location.href,
    },
  };
}

function onScrapeMessage(msg, _sender, sendResponse) {
  if (!msg || (msg.type !== "SCRAPE_JOBRIGHT_V3" && msg.type !== "SCRAPE_JOBRIGHT")) {
    return;
  }
  const titles = Array.isArray(msg.titles)
    ? msg.titles
    : msg.query
    ? [msg.query]
    : null;
  scrapeJobrightJobs(titles)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: err.message, jobs: [] }));
  return true;
}

window.__SF_JOBRIGHT_CS_LISTENER__ = onScrapeMessage;
chrome.runtime.onMessage.addListener(onScrapeMessage);
})();

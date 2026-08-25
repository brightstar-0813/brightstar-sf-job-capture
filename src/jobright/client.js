/**
 * JobRight /swan API client — direct HTTP, no browser or extension.
 * Session cookies come from `npm run jobright:login` (Playwright storage state).
 */

import fs from "fs";

const API_ORIGIN = "https://jobright.ai";
const DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "x-client-type": "web",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

/** @param {string} authPath Playwright storageState JSON */
export function loadJobrightCookieHeader(authPath) {
  if (!authPath || !fs.existsSync(authPath)) return "";
  try {
    const state = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
    const pairs = cookies
      .filter((c) => {
        const domain = String(c.domain || "");
        return domain.includes("jobright.ai");
      })
      .map((c) => `${c.name}=${c.value}`);
    return pairs.join("; ");
  } catch {
    return "";
  }
}

/**
 * @param {string} pathWithQuery e.g. `/swan/recommend/search?...`
 * @param {{ method?: string, body?: object, authPath?: string, timeoutMs?: number }} opts
 */
export async function jobrightApiFetch(pathWithQuery, opts = {}) {
  const url = pathWithQuery.startsWith("http")
    ? pathWithQuery
    : `${API_ORIGIN}${pathWithQuery}`;
  const cookie = loadJobrightCookieHeader(opts.authPath);
  const headers = { ...DEFAULT_HEADERS };
  if (cookie) headers.cookie = cookie;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
  });

  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

export function buildRecommendSearchBody(query, { daysAgo = null, position = 0 } = {}) {
  return {
    searchType: "job_title",
    value: query,
    jobTaxonomyList: [{ taxonomyId: "00-00-00", title: query }],
    country: "US",
    jobTypes: [],
    seniority: [],
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
    daysAgo: daysAgo || null,
    refresh: true,
    position,
    sortCondition: 0,
  };
}

/**
 * POST /swan/recommend/search
 * @param {string} authPath
 */
export async function fetchRecommendSearch(authPath, { count, query, daysAgo = null, position = 0 }) {
  const path =
    `/swan/recommend/search?searchType=job_title` +
    `&refresh=true&count=${count}&position=${position}&sortCondition=0`;
  const { ok, status, json } = await jobrightApiFetch(path, {
    method: "POST",
    authPath,
    body: buildRecommendSearchBody(query, { daysAgo, position }),
  });
  return {
    ok: ok && !!json?.success,
    status,
    jobList: json?.result?.jobList || [],
    jobNum: json?.result?.jobNum,
  };
}

/**
 * POST /swan/job/applied/jobs-v3 — jobs the user already applied to.
 * @returns {{ ok: boolean, ids: string[] }}
 */
export async function fetchAppliedJobIds(authPath) {
  const ids = [];
  let cursor = null;
  let ok = true;

  for (let i = 0; i < 20; i += 1) {
    const { ok: resOk, json } = await jobrightApiFetch("/swan/job/applied/jobs-v3", {
      method: "POST",
      authPath,
      body: { cursor, pageSize: 50, applyStatus: 0 },
    });
    if (!resOk || !json) {
      ok = false;
      break;
    }
    const result = json?.result || {};
    const list = Array.isArray(result.list) ? result.list : [];
    for (const it of list) {
      const jobId = it?.jobResult?.jobId || it?.jobId;
      if (jobId) ids.push(`jobright_${jobId}`);
    }
    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }
  return { ok, ids };
}

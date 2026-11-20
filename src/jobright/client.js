/**
 * JobRight /swan API client — direct HTTP, no browser or extension.
 * Session cookies come from `npm run jobright:login` (Playwright storage state).
 * Without a valid session the API answers 401 / errorCode 41001 — callers
 * fall back to the anonymous SSR pages in `ssr.js`.
 */

import fs from "fs";

const API_ORIGIN = "https://jobright.ai";
const DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "x-client-type": "web",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

/** @param {string} authPath Playwright storageState JSON */
export function loadJobrightCookieHeader(authPath) {
  if (!authPath || !fs.existsSync(authPath)) return "";
  try {
    const state = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
    const nowSec = Date.now() / 1000;
    return cookies
      .filter((c) => String(c.domain || "").includes("jobright.ai"))
      .filter((c) => !(c.expires > 0 && c.expires < nowSec))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    return "";
  }
}

/** True when the saved storage state has an unexpired JobRight SESSION_ID. */
export function hasJobrightSession(authPath) {
  return /(?:^|;\s*)SESSION_ID=/.test(loadJobrightCookieHeader(authPath));
}

/**
 * @param {string} pathWithQuery e.g. `/swan/recommend/search?...`
 * @param {{ method?: string, body?: object, authPath?: string, timeoutMs?: number }} opts
 */
export async function jobrightApiFetch(pathWithQuery, opts = {}) {
  const url = pathWithQuery.startsWith("http")
    ? pathWithQuery
    : `${API_ORIGIN}${pathWithQuery}`;
  const headers = { ...DEFAULT_HEADERS };
  const cookie = loadJobrightCookieHeader(opts.authPath);
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
export async function fetchRecommendSearch(
  authPath,
  { count, query, daysAgo = null, position = 0 }
) {
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
    errorCode: json?.errorCode ?? null,
    errorMsg: json?.errorMsg || null,
  };
}

/** Missing / expired login: HTTP 401 or JobRight errorCode 41001. */
export function isJobrightAuthError(resp) {
  return resp?.status === 401 || Number(resp?.errorCode) === 41001;
}

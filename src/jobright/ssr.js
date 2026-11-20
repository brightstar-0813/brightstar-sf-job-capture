/**
 * Anonymous JobRight search via the public Next.js SSR page — no login.
 * Returns the newest ~20 jobs per title in the same `{ jobResult, companyResult }`
 * shape as /swan/recommend/search. Filters (workModel, daysAgo) and paging are
 * login-gated: adding them redirects to /_jr/security/challenge.
 */

const ORIGIN = "https://jobright.ai";
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

let cachedBuildId = null;

function searchParams(title) {
  return `value=${encodeURIComponent(title)}&country=US`;
}

function parseNextData(html) {
  const m = String(html || "").match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

async function get(url, timeoutMs = 45000) {
  return fetch(url, {
    headers: HEADERS,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function isChallenge(res) {
  const loc = res.headers.get("location") || "";
  return res.status >= 300 && res.status < 400 && /security\/challenge/i.test(loc);
}

/**
 * @param {string} title search seed
 * @returns {Promise<{ ok: boolean, jobList: any[], totalJobs?: number, challenged?: boolean, status?: number, via?: string }>}
 */
export async function fetchJobrightSsr(title) {
  const qs = searchParams(title);

  if (cachedBuildId) {
    const res = await get(
      `${ORIGIN}/_next/data/${cachedBuildId}/jobs/search.json?${qs}`
    );
    if (isChallenge(res)) {
      return { ok: false, jobList: [], challenged: true, status: res.status };
    }
    if (res.ok) {
      const json = await res.json().catch(() => null);
      const pp = json?.pageProps;
      if (Array.isArray(pp?.jobList)) {
        return { ok: true, jobList: pp.jobList, totalJobs: pp.totalJobs, via: "data" };
      }
    }
    // 404 after a JobRight deploy (new buildId) — refresh via HTML below.
    cachedBuildId = null;
  }

  const res = await get(`${ORIGIN}/jobs/search?${qs}`);
  if (isChallenge(res)) {
    return { ok: false, jobList: [], challenged: true, status: res.status };
  }
  if (!res.ok) return { ok: false, jobList: [], status: res.status };
  const data = parseNextData(await res.text());
  if (!data) return { ok: false, jobList: [], status: res.status };
  if (data.buildId) cachedBuildId = data.buildId;
  const pp = data.props?.pageProps || {};
  return {
    ok: Array.isArray(pp.jobList),
    jobList: Array.isArray(pp.jobList) ? pp.jobList : [],
    totalJobs: pp.totalJobs,
    via: "html",
  };
}

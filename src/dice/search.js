/**
 * Dice search listing helpers.
 */

import { config } from "../config.js";

export function buildSearchUrl(page = 1) {
  const params = new URLSearchParams();
  params.set("q", config.searchQ);
  params.set("countryCode", "US");
  params.set("radius", "30");
  params.set("radiusUnit", "mi");
  params.set("page", String(page));
  params.set("pageSize", String(config.pageSize));
  params.set("language", "en");
  params.set("filters.postedDate", "SEVEN");
  params.set("filters.workplaceTypes", "Remote");
  return `https://www.dice.com/jobs?${params.toString()}`;
}

/**
 * Extract job id from a Dice job URL.
 * Supports /job-detail/{slug}/{id} and /jobs/detail/{id}
 */
export function extractJobIdFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, "https://www.dice.com");
    const parts = u.pathname.split("/").filter(Boolean);
    // /job-detail/title-slug/ABC123 or /jobs/detail/ABC123
    const detailIdx = parts.findIndex(
      (p) => p === "job-detail" || p === "detail"
    );
    if (detailIdx >= 0 && parts[detailIdx + 1]) {
      // job-detail often has slug then id
      if (parts[detailIdx] === "job-detail" && parts[detailIdx + 2]) {
        return parts[detailIdx + 2];
      }
      return parts[detailIdx + 1];
    }
    // query param fallback
    const qid = u.searchParams.get("jobId") || u.searchParams.get("id");
    return qid || null;
  } catch {
    return null;
  }
}

export function normalizeJobUrl(url) {
  try {
    const u = new URL(String(url), "https://www.dice.com");
    u.hash = "";
    return u.toString();
  } catch {
    return String(url || "");
  }
}

/**
 * Collect job cards / links from a search results page.
 * @param {import('playwright').Page} page
 */
export async function scrapeSearchPage(page) {
  await page.waitForTimeout(1500);

  const jobs = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    const root =
      document.querySelector('[data-cy="search-page"]') ||
      document.querySelector('main') ||
      document.body;

    // Prefer explicit search result cards when present
    const cards = Array.from(
      root.querySelectorAll(
        '[data-cy="card"], [data-testid="job-search-serp-card"], article[data-cy], dhi-search-card, .card'
      )
    );

    const collectFrom = (scope) => {
      const anchors = Array.from(
        scope.querySelectorAll(
          'a[href*="/job-detail/"], a[href*="/jobs/detail/"], a[data-cy="card-title-link"]'
        )
      );
      for (const a of anchors) {
        const href = a.href || a.getAttribute("href") || "";
        if (!href || seen.has(href)) continue;
        if (!/job-detail|jobs\/detail/.test(href)) continue;
        seen.add(href);

        const card =
          a.closest('[data-cy="card"]') ||
          a.closest('[data-testid="job-search-serp-card"]') ||
          a.closest("article") ||
          a.closest("li") ||
          a.parentElement;

        const title =
          (a.textContent || "").replace(/\s+/g, " ").trim() ||
          a.getAttribute("aria-label") ||
          "";

        let company = "";
        const companyEl =
          card?.querySelector('[data-cy="search-result-company-name"]') ||
          card?.querySelector('a[href*="/company-profile/"]') ||
          card?.querySelector(".companyName, [class*='company']");
        if (companyEl) {
          company = (companyEl.textContent || "").replace(/\s+/g, " ").trim();
        }

        let location = "";
        const locEl =
          card?.querySelector('[data-cy="search-result-location"]') ||
          card?.querySelector("[class*='location']");
        if (locEl) {
          location = (locEl.textContent || "").replace(/\s+/g, " ").trim();
        }

        results.push({ title, organization: company, location, url: href });
      }
    };

    if (cards.length) {
      for (const card of cards) collectFrom(card);
    } else {
      collectFrom(root);
    }

    return results;
  });

  return jobs
    .map((j) => ({
      ...j,
      url: normalizeJobUrl(j.url),
      id: extractJobIdFromUrl(j.url),
    }))
    .filter((j) => j.id && j.url)
    .slice(0, config.pageSize);
}

/**
 * Paginate Dice search and return unique listing stubs.
 * @param {import('playwright').Browser} browser
 */
export async function searchDiceJobs(browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1365, height: 900 },
  });
  const page = await context.newPage();
  const all = [];
  const seenIds = new Set();

  try {
    for (let p = 1; p <= config.maxPages; p += 1) {
      const url = buildSearchUrl(p);
      console.log(`[search] page ${p}: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      // Wait for client-side results
      try {
        await page.waitForSelector(
          'a[href*="/job-detail/"], a[href*="/jobs/detail/"]',
          { timeout: 20000 }
        );
      } catch {
        console.log(`[search] no job links on page ${p}, stopping`);
        break;
      }

      const batch = await scrapeSearchPage(page);
      console.log(`[search] page ${p}: found ${batch.length} links`);
      if (!batch.length) break;

      let newOnPage = 0;
      for (const job of batch) {
        if (seenIds.has(job.id)) continue;
        seenIds.add(job.id);
        all.push(job);
        newOnPage += 1;
      }
      if (newOnPage === 0) break;

      if (p < config.maxPages && config.delayMs) {
        await page.waitForTimeout(config.delayMs);
      }
    }
  } finally {
    await context.close();
  }

  return all;
}

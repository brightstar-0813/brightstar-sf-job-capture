/**
 * Built In — remote Salesforce jobs via search + detail scrape.
 */

import { config } from "../config.js";
import { contextOptions } from "../browser.js";
import {
  containsSalesforce,
  isBlockedEmployer,
  isRemoteArrangement,
  isUsFriendlyLocation,
  isWithinRecentDays,
  parsePostedDate,
  looksSalesforceTitle,
} from "../filter.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * `allLocations=true` is required: without it Built In scopes "remote" to the
 * requester's IP country (non-US IP → zero Salesforce results). Non-US remote
 * roles are dropped later by the US-location filter.
 */
function buildSearchUrl(page = 1, query = config.searchQ) {
  const params = new URLSearchParams();
  params.set("search", query);
  params.set("allLocations", "true");
  params.set("daysSinceUpdated", String(config.recentDays));
  if (page > 1) params.set("page", String(page));
  return `https://builtin.com/jobs/remote?${params.toString()}`;
}

async function scrapeListingPage(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/job/"]')) {
      const href = (a.href || "").split("?")[0];
      const idMatch = href.match(/\/job\/[^/]+\/(\d+)/);
      if (!idMatch || seen.has(idMatch[1])) continue;
      seen.add(idMatch[1]);
      const title = (a.textContent || "").replace(/\s+/g, " ").trim();
      out.push({ id: idMatch[1], url: href, title });
    }
    return out;
  });
}

async function scrapeDetail(page, stub) {
  await page.goto(stub.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1500 + config.delayMs);

  const data = await page.evaluate(() => {
    const text = (el) =>
      el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
    const h1 = document.querySelector("h1");
    let company = "";
    for (const a of document.querySelectorAll('a[href*="/company/"]')) {
      const t = text(a);
      const href = a.getAttribute("href") || "";
      if (!t || /\/jobs|\/faq/i.test(href) || t.length > 80) continue;
      if (/^jobs$/i.test(t)) continue;
      company = t;
      break;
    }
    const main = document.querySelector("main") || document.body;
    const bodyText = main ? main.innerText || "" : "";
    const remoteBadge =
      /\bhiring remotely\b/i.test(bodyText.slice(0, 2500)) ||
      /\bfully remote\b/i.test(bodyText.slice(0, 2500)) ||
      /(^|\n)\s*remote\s*(\n|$)/i.test(bodyText.slice(0, 1500));
    const hybrid = /\bhybrid\b/i.test(bodyText.slice(0, 2500));
    const onsite = /\bon[-\s]?site\b|\bin[-\s]?office\b/i.test(bodyText.slice(0, 2500));
    let work = "";
    if (hybrid) work = "Hybrid";
    else if (onsite && !remoteBadge) work = "Onsite";
    else if (remoteBadge || /\bremote\b/i.test(bodyText.slice(0, 2500))) work = "Remote";

    // "Posted Yesterday", "Posted 6 Minutes Ago", "Reposted 3 Days Ago", …
    const postedMatch = bodyText.match(
      /(?:re)?posted\s+(yesterday|today|just now|\d+\+?\s+(?:minute|hour|day|week|month)s?\s+ago)/i
    );
    const datePosted = postedMatch ? postedMatch[1].toLowerCase() : "";

    const remoteIn = bodyText
      .slice(0, 2500)
      .match(/hiring remotely in\s+([^\n]{2,80})/i);

    // Prefer description after the title block — drop nav chrome.
    let description = bodyText;
    const cut = bodyText.search(/\b(about the role|job description|what you.?ll do|responsibilities)\b/i);
    if (cut > 0) description = bodyText.slice(cut);

    return {
      title: text(h1),
      organization: company,
      work_arrangement: work,
      date_posted_raw: datePosted,
      description: description.replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000),
      location: remoteIn
        ? `Remote, ${remoteIn[1].trim()}`
        : remoteBadge
          ? "Remote"
          : "",
    };
  });

  const postedAbs = parsePostedDate(data.date_posted_raw);
  const datePosted = postedAbs
    ? postedAbs.toISOString().slice(0, 10)
    : String(data.date_posted_raw || "");

  return {
    id: `builtin_${stub.id}`,
    title: data.title || stub.title || "",
    organization: data.organization || "",
    location: data.location || "",
    work_arrangement: data.work_arrangement || "Remote",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: "",
    salary_min: "",
    salary_max: "",
    salary_currency: "USD",
    salary_unit: "",
    key_skills: "",
    source: "builtin",
    date_posted: datePosted,
    url: stub.url,
    description: data.description || "",
  };
}

/**
 * Built In's "Hiring Remotely in <place>" always names a country ("USA",
 * "India", "Chennai, Tamilnadu, IND"); a named place without a US marker is
 * foreign. Multi-location / anywhere postings are left to the shared filter.
 */
function isNonUsRemotePlace(location) {
  const m = String(location || "").match(/^Remote,\s*(.+)$/i);
  if (!m) return false;
  const place = m[1];
  if (/\b(usa|united states|u\.s\.?|us)\b/i.test(place)) return false;
  if (/\blocations?\b|anywhere|worldwide|north america|americas/i.test(place)) return false;
  return true;
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchBuiltinJobs(browser) {
  const context = await browser.newContext(contextOptions());
  const page = await context.newPage();
  const stubs = [];
  const seen = new Set();
  let listingErrors = 0;

  try {
    const queries =
      config.roleTitles?.length > 0 ? config.roleTitles : [config.searchQ];
    const pages = Math.max(1, config.rolePages || 2);

    for (let qi = 0; qi < queries.length; qi += 1) {
      const query = queries[qi];
      for (let p = 1; p <= pages; p += 1) {
        const url = buildSearchUrl(p, query);
        console.log(`[builtin] q="${query}" page ${p}/${pages}: ${url}`);
        let batch;
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page
            .waitForSelector('a[href*="/job/"]', { timeout: 12000 })
            .catch(() => {});
          await sleep(1000 + config.delayMs);
          batch = await scrapeListingPage(page);
        } catch (err) {
          listingErrors += 1;
          console.warn(`[builtin] q="${query}" page ${p} failed: ${err.message.split("\n")[0]}`);
          break;
        }
        console.log(`[builtin] q="${query}" page ${p}: found ${batch.length} links`);
        if (!batch.length) break;
        let added = 0;
        for (const s of batch) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          stubs.push(s);
          added += 1;
        }
        // Built In shows 25 per page; a short page is the last one.
        if (added === 0 || batch.length < 20) break;
      }
    }

    const kept = [];
    let nonRemote = 0;
    let nonUs = 0;
    let nonSf = 0;
    let stale = 0;
    let employer = 0;
    let skippedTitle = 0;

    const toScrape = stubs.filter((stub) => {
      if (looksSalesforceTitle(stub.title)) return true;
      skippedTitle += 1;
      return false;
    });
    if (skippedTitle) {
      console.log(
        `[builtin] skip ${skippedTitle} listings whose titles are not Salesforce-related`
      );
    }

    for (let i = 0; i < toScrape.length; i += 1) {
      const stub = toScrape[i];
      console.log(`[builtin] detail ${i + 1}/${toScrape.length}: ${stub.id}`);
      try {
        const job = await scrapeDetail(page, stub);
        if (isBlockedEmployer(job.organization)) {
          employer += 1;
          continue;
        }
        if (!isRemoteArrangement(job.work_arrangement)) {
          nonRemote += 1;
          continue;
        }
        if (!isUsFriendlyLocation(job.location, job.title) || isNonUsRemotePlace(job.location)) {
          nonUs += 1;
          continue;
        }
        if (!containsSalesforce(job.title, job.description)) {
          nonSf += 1;
          continue;
        }
        if (isWithinRecentDays(job.date_posted, config.recentDays) === false) {
          stale += 1;
          continue;
        }
        kept.push(job);
      } catch (err) {
        console.warn(`[builtin] failed ${stub.id}: ${err.message}`);
      }
      if (config.delayMs) await sleep(config.delayMs);
    }

    console.log(
      `[builtin] kept ${kept.length} remote Salesforce jobs` +
        ` (stubs=${stubs.length}, skipped title=${skippedTitle}, skipped employer=${employer}, non-remote=${nonRemote},` +
        ` non-US=${nonUs}, non-Salesforce=${nonSf}, stale=${stale})`
    );
    let status = kept.length ? "ok" : "empty";
    if (!stubs.length && listingErrors) status = "error";
    const note = [
      stubs.length ? "" : "search pages returned no job links",
      listingErrors ? `${listingErrors} listing page(s) failed to load` : "",
    ]
      .filter(Boolean)
      .join("; ");
    return { jobs: kept, status, note };
  } finally {
    await context.close();
  }
}

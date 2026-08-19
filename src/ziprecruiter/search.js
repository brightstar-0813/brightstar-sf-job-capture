/**
 * ZipRecruiter — best-effort remote Salesforce scrape.
 * Often blocked by Cloudflare in headless mode; returns [] with a warning then.
 */

import { config } from "../config.js";
import { contextOptions } from "../browser.js";
import {
  containsSalesforce,
  isSalesforceEmployer,
  isRemoteArrangement,
  isWithinRecentDays,
  isExpiredPosting,
  looksSalesforceTitle,
  parsePostedDate,
} from "../filter.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildSearchUrl() {
  // SEO path tends to pass Cloudflare more often than /jobs-search?...
  return `https://www.ziprecruiter.com/Jobs/Remote-${encodeURIComponent(
    String(config.searchQ || "Salesforce").replace(/\s+/g, "-")
  )}`;
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchZiprecruiterJobs(browser) {
  const context = await browser.newContext(contextOptions());
  const page = await context.newPage();
  const kept = [];

  try {
    const url = buildSearchUrl();
    console.log(`[ziprecruiter] open: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(6000 + config.delayMs);

    const title = await page.title();
    const blocked = await page.evaluate(() => {
      const t = (document.title || "") + (document.body?.innerText || "").slice(0, 500);
      return /just a moment|security verification|cf-browser-verification|attention required/i.test(
        t
      );
    });
    if (blocked || /just a moment/i.test(title)) {
      console.warn(
        `[ziprecruiter] blocked by Cloudflare bot check — skipping this run`
      );
      return { jobs: [], blocked: true };
    }

    const stubs = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      for (const a of document.querySelectorAll("a[href]")) {
        const href = (a.href || "").split("?")[0];
        if (!/ziprecruiter\.com\/(job|ojob)\//i.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        const title = (a.textContent || "").replace(/\s+/g, " ").trim();
        out.push({ url: href, title });
      }
      return out.slice(0, 60);
    });

    const relevant = stubs.filter(
      (s) => !s.title || looksSalesforceTitle(s.title)
    );
    console.log(
      `[ziprecruiter] listing links: ${stubs.length}` +
        (relevant.length !== stubs.length
          ? ` (skip ${stubs.length - relevant.length} unrelated titles)`
          : "")
    );
    if (!relevant.length) {
      console.warn(
        `[ziprecruiter] no job links found (page may be JS-gated) — skipping`
      );
      return { jobs: [], blocked: false };
    }

    for (let i = 0; i < relevant.length; i += 1) {
      const stub = relevant[i];
      console.log(`[ziprecruiter] detail ${i + 1}/${relevant.length}`);
      try {
        await page.goto(stub.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await sleep(1200 + config.delayMs);
        const data = await page.evaluate(() => {
          const text = (el) =>
            el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
          let ld = null;
          for (const s of document.querySelectorAll(
            'script[type="application/ld+json"]'
          )) {
            try {
              const p = JSON.parse(s.textContent || "");
              const nodes = Array.isArray(p) ? p : [p];
              for (const n of nodes) {
                if (n && (n["@type"] === "JobPosting" || n.title)) {
                  ld = n;
                  break;
                }
              }
            } catch {
              /* ignore */
            }
            if (ld) break;
          }
          const body = document.body?.innerText || "";
          const work = /\bhybrid\b/i.test(body.slice(0, 2000))
            ? "Hybrid"
            : /\bon[-\s]?site\b/i.test(body.slice(0, 2000)) &&
              !/\bremote\b/i.test(body.slice(0, 2000))
            ? "Onsite"
            : /\bremote\b/i.test(body.slice(0, 2000))
            ? "Remote"
            : "";
          return {
            title: text(document.querySelector("h1")) || (ld && ld.title) || "",
            organization:
              (ld && (ld.hiringOrganization?.name || ld.hiringOrganization)) ||
              "",
            description:
              (ld && ld.description) ||
              text(document.querySelector('[class*="description"]')) ||
              body.slice(0, 15000),
            date_posted: (ld && ld.datePosted) || "",
            work_arrangement:
              work || (ld?.jobLocationType === "TELECOMMUTE" ? "Remote" : ""),
            location: "",
          };
        });

        const idMatch = stub.url.match(/\/(?:job|ojob)\/([^/?#]+)/i);
        const id = `ziprecruiter_${idMatch ? idMatch[1] : i}`;
        const postedAbs = parsePostedDate(data.date_posted);
        const job = {
          id,
          title: data.title || stub.title || "",
          organization: String(data.organization || "").trim(),
          location: data.location || "Remote",
          work_arrangement: data.work_arrangement || "Remote",
          remote_restricted_to: "",
          experience_level: "",
          employment_type: "",
          salary_min: "",
          salary_max: "",
          salary_currency: "USD",
          salary_unit: "",
          key_skills: "",
          source: "ziprecruiter",
          date_posted: postedAbs
            ? postedAbs.toISOString().slice(0, 10)
            : String(data.date_posted || ""),
          url: stub.url,
          description: String(data.description || "")
            .replace(/<[^>]+>/g, " ")
            .trim(),
        };

        if (isSalesforceEmployer(job.organization)) continue;
        if (isExpiredPosting(`${job.title}\n${job.description}`)) continue;
        if (!isRemoteArrangement(job.work_arrangement)) continue;
        if (!containsSalesforce(job.title, job.description)) continue;
        if (isWithinRecentDays(job.date_posted, config.recentDays) === false) continue;
        kept.push(job);
      } catch (err) {
        console.warn(`[ziprecruiter] detail failed: ${err.message}`);
      }
    }

    console.log(`[ziprecruiter] kept ${kept.length} remote Salesforce jobs`);
    return { jobs: kept, blocked: false };
  } finally {
    await context.close();
  }
}

/**
 * Indeed — best-effort remote Salesforce scrape (fromage = RECENT_DAYS).
 * Often bot-blocked in headless; skip cleanly when challenged.
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

function fromageDays(days) {
  const d = Math.max(1, Number(days) || 7);
  if (d <= 1) return "1";
  if (d <= 3) return "3";
  if (d <= 7) return "7";
  return "14";
}

function buildSearchUrl(q) {
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("l", "Remote");
  params.set("fromage", fromageDays(config.recentDays));
  params.set("sort", "date");
  return `https://www.indeed.com/jobs?${params.toString()}`;
}

function looksBlocked(title, snippet) {
  const t = `${title}\n${snippet}`;
  return /just a moment|unusual traffic|verify you are (a )?human|blocked|captcha|enable javascript/i.test(
    t
  );
}

/**
 * @param {import('playwright').Browser} browser
 */
export async function searchIndeedJobs(browser) {
  const context = await browser.newContext(contextOptions());
  const page = await context.newPage();
  const kept = [];
  const seen = new Set();
  const queries = (config.searchQueries || [config.searchQ]).slice(0, 4);

  try {
    for (const q of queries) {
      const url = buildSearchUrl(q);
      console.log(`[indeed] search: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(5000 + config.delayMs);

      const title = await page.title();
      const snippet = await page.evaluate(() =>
        (document.body?.innerText || "").slice(0, 800)
      );
      if (looksBlocked(title, snippet)) {
        console.warn(`[indeed] blocked or challenged — skipping this run`);
        return { jobs: [], blocked: true };
      }

      const stubs = await page.evaluate(() => {
        const out = [];
        const seenLocal = new Set();
        for (const a of document.querySelectorAll(
          'a[href*="/viewjob?jk="], a[href*="/rc/clk"], a.jcs-JobTitle'
        )) {
          const href = (a.href || "").split("#")[0];
          if (!href || seenLocal.has(href)) continue;
          if (!/indeed\.com/i.test(href)) continue;
          seenLocal.add(href);
          out.push({
            url: href,
            title: (a.textContent || "").replace(/\s+/g, " ").trim(),
          });
        }
        return out;
      });

      console.log(`[indeed] "${q}" listing links: ${stubs.length}`);
      const relevant = stubs.filter(
        (s) => !s.title || looksSalesforceTitle(s.title)
      );
      const toScrape = relevant.slice(0, 25);

      for (let i = 0; i < toScrape.length; i += 1) {
        const stub = toScrape[i];
        if (seen.has(stub.url)) continue;
        seen.add(stub.url);
        console.log(`[indeed] detail ${i + 1}/${toScrape.length}`);
        try {
          await page.goto(stub.url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          await sleep(1000 + config.delayMs);
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
              : ld?.jobLocationType === "TELECOMMUTE"
              ? "Remote"
              : "";
            return {
              title: text(document.querySelector("h1")) || (ld && ld.title) || "",
              organization:
                (ld && (ld.hiringOrganization?.name || ld.hiringOrganization)) ||
                "",
              description:
                (ld && ld.description) ||
                text(document.querySelector("#jobDescriptionText")) ||
                body.slice(0, 15000),
              date_posted: (ld && ld.datePosted) || "",
              work_arrangement: work,
              expired: /this job has expired|no longer accepting applications|job has expired/i.test(
                body.slice(0, 2500)
              ),
              bodyPreview: body.slice(0, 2500),
            };
          });

          if (data.expired || isExpiredPosting(data.bodyPreview)) continue;

          const jk =
            stub.url.match(/[?&]jk=([a-z0-9]+)/i)?.[1] ||
            stub.url.match(/\/viewjob\/([^/?#]+)/i)?.[1] ||
            String(kept.length);
          const postedAbs = parsePostedDate(data.date_posted);
          const job = {
            id: `indeed_${jk}`,
            title: data.title || stub.title || "",
            organization: String(data.organization || "").trim(),
            location: "Remote",
            work_arrangement: data.work_arrangement || "Remote",
            remote_restricted_to: "",
            experience_level: "",
            employment_type: "",
            salary_min: "",
            salary_max: "",
            salary_currency: "USD",
            salary_unit: "",
            key_skills: "",
            source: "indeed",
            date_posted: postedAbs
              ? postedAbs.toISOString().slice(0, 10)
              : String(data.date_posted || ""),
            url: stub.url.split("&from=")[0],
            description: String(data.description || "")
              .replace(/<[^>]+>/g, " ")
              .trim(),
          };

          if (isSalesforceEmployer(job.organization)) continue;
          if (!isRemoteArrangement(job.work_arrangement)) continue;
          if (!containsSalesforce(job.title, job.description)) continue;
          if (isWithinRecentDays(job.date_posted, config.recentDays) === false)
            continue;
          kept.push(job);
        } catch (err) {
          console.warn(`[indeed] detail failed: ${err.message}`);
        }
      }
    }

    console.log(`[indeed] kept ${kept.length} remote Salesforce jobs`);
    return { jobs: kept, blocked: false };
  } finally {
    await context.close();
  }
}

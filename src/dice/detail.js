/**
 * Dice job detail page extractor.
 */

import { extractJobIdFromUrl, normalizeJobUrl } from "./search.js";
import { config } from "../config.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 */
export async function scrapeJobDetail(page, url) {
  const jobUrl = normalizeJobUrl(url);
  await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  try {
    await page.waitForSelector(
      'h1, [data-cy="jobTitle"], #jobDescription, [data-cy="jobDescription"], [class*="job-description"]',
      { timeout: 20000 }
    );
  } catch {
    // continue with whatever is on the page
  }

  await page.waitForTimeout(800);

  const data = await page.evaluate(() => {
    const text = (el) =>
      el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";

    const bodyText = document.body ? document.body.innerText || "" : "";
    const expired =
      /this job is no longer available|no longer accepting applications|this (job|position|posting) (has expired|is expired|has been filled|is closed)|job (posting )?(has )?expired/i.test(
        bodyText
      );

    const titleEl =
      document.querySelector('[data-cy="jobTitle"]') ||
      document.querySelector("h1") ||
      document.querySelector('[class*="jobTitle"]');

    const companyEl =
      document.querySelector('[data-cy="companyNameLink"]') ||
      document.querySelector('a[href*="/company-profile/"]') ||
      document.querySelector('[data-cy="companyName"]') ||
      document.querySelector("[class*='companyName']");

    const locationEl =
      document.querySelector('[data-cy="location"]') ||
      document.querySelector('[data-cy="jobLocation"]') ||
      document.querySelector("[class*='location']");

    const descEl =
      document.querySelector("#jobDescription") ||
      document.querySelector('[data-cy="jobDescription"]') ||
      document.querySelector('[class*="job-description"]') ||
      document.querySelector('[id*="description"]') ||
      document.querySelector("article");

    // Prefer innerText for JD (keeps line breaks somewhat)
    let description = "";
    if (descEl) {
      description = (descEl.innerText || descEl.textContent || "")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const employment =
      text(document.querySelector('[data-cy="employmentDetails"]')) ||
      text(document.querySelector('[data-cy="employmentType"]')) ||
      "";

    const workplace =
      text(document.querySelector('[data-cy="workplaceType"]')) ||
      text(document.querySelector('[data-cy="workSettings"]')) ||
      "";

    const posted =
      text(document.querySelector('[data-cy="postedDate"]')) ||
      text(document.querySelector("time")) ||
      "";

    const skills = Array.from(
      document.querySelectorAll(
        '[data-cy="skillsList"] li, [data-cy="chip"], [class*="skill"] li, [class*="SkillChip"]'
      )
    )
      .map((el) => text(el))
      .filter(Boolean)
      .slice(0, 40);

    // JSON-LD fallback
    let ld = null;
    for (const script of document.querySelectorAll(
      'script[type="application/ld+json"]'
    )) {
      try {
        const parsed = JSON.parse(script.textContent || "");
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        for (const n of nodes) {
          if (n && (n["@type"] === "JobPosting" || n.title || n.description)) {
            ld = n;
            break;
          }
        }
      } catch {
        /* ignore */
      }
      if (ld) break;
    }

    return {
      expired,
      title: text(titleEl) || (ld && ld.title) || "",
      organization:
        text(companyEl) ||
        (ld && (ld.hiringOrganization?.name || ld.hiringOrganization)) ||
        "",
      location:
        text(locationEl) ||
        (ld &&
          (typeof ld.jobLocation === "string"
            ? ld.jobLocation
            : ld.jobLocation?.address?.addressLocality ||
              ld.jobLocation?.name ||
              "")) ||
        "",
      description: description || (ld && ld.description) || "",
      employment_type: employment || (ld && ld.employmentType) || "",
      work_arrangement: workplace || "",
      date_posted: posted || (ld && ld.datePosted) || "",
      key_skills: skills.join("; "),
      salary_min: ld?.baseSalary?.value?.minValue ?? "",
      salary_max: ld?.baseSalary?.value?.maxValue ?? "",
      salary_currency: ld?.baseSalary?.currency || "USD",
      salary_unit: ld?.baseSalary?.value?.unitText || "",
    };
  });

  // Strip HTML entities / tags if description came from JSON-LD
  if (data.description && /<[^>]+>/.test(data.description)) {
    data.description = data.description
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  const id = extractJobIdFromUrl(jobUrl);
  return {
    id,
    url: jobUrl,
    expired: data.expired === true,
    title: data.title,
    organization: String(data.organization || "").trim(),
    location: String(data.location || "").trim(),
    work_arrangement: String(data.work_arrangement || "").trim() || "Remote",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: String(data.employment_type || "").trim(),
    salary_min: data.salary_min === "" || data.salary_min == null ? "" : String(data.salary_min),
    salary_max: data.salary_max === "" || data.salary_max == null ? "" : String(data.salary_max),
    salary_currency: data.salary_currency || "USD",
    salary_unit: data.salary_unit || "",
    key_skills: data.key_skills || "",
    source: "dice",
    date_posted: data.date_posted || "",
    description: data.description || "",
  };
}

/**
 * Fetch details for listing stubs.
 * @param {import('playwright').Browser} browser
 * @param {Array<{ id: string, url: string, title?: string, organization?: string, location?: string }>} stubs
 */
export async function scrapeJobDetails(browser, stubs) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1365, height: 900 },
  });
  const page = await context.newPage();
  const results = [];

  try {
    for (let i = 0; i < stubs.length; i += 1) {
      const stub = stubs[i];
      console.log(`[detail] ${i + 1}/${stubs.length}: ${stub.id}`);
      try {
        const detail = await scrapeJobDetail(page, stub.url);
        if (detail.expired) {
          console.log(`[detail] skip ${stub.id}: job no longer available`);
          if (config.delayMs) await sleep(config.delayMs);
          continue;
        }
        results.push({
          ...detail,
          title: detail.title || stub.title || "",
          organization: detail.organization || stub.organization || "",
          location: detail.location || stub.location || "",
          id: detail.id || stub.id,
          url: detail.url || stub.url,
        });
      } catch (err) {
        console.warn(`[detail] failed ${stub.id}: ${err.message}`);
      }
      if (config.delayMs) await sleep(config.delayMs);
    }
  } finally {
    await context.close();
  }

  return results;
}

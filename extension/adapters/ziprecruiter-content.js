/**
 * ZipRecruiter DOM adapter — current page only.
 */
(function () {
  const Sf = globalThis.SfCapture;
  const SOURCE = "ziprecruiter";
  const CS_VERSION = 2;

  function extractStubs() {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const href = (a.href || "").split("?")[0];
      if (!/ziprecruiter\.com\/(job|ojob)\//i.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const card =
        a.closest("article, li, div[class*='job'], div[class*='Job']") ||
        a.parentElement;
      out.push({
        url: href,
        title: (
          a.textContent ||
          card?.querySelector("h2, h3")?.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim(),
        company:
          card
            ?.querySelector(
              "[data-testid*='company' i], .company_name, a[class*='company' i]"
            )
            ?.textContent?.trim() || "",
        location:
          card
            ?.querySelector(
              "[data-testid*='location' i], .location, [class*='location' i]"
            )
            ?.textContent?.trim() || "Remote",
        snippet:
          card
            ?.querySelector("p, [class*='snippet' i], [class*='description' i]")
            ?.textContent?.trim() || "",
        date:
          card
            ?.querySelector("time, [class*='posted' i], [class*='date' i]")
            ?.textContent?.trim() || "",
      });
    }
    return out.slice(0, 80);
  }

  function jobIdFromUrl(url) {
    const m = String(url).match(/\/(?:job|ojob)\/([^/?#]+)/i);
    return m ? m[1] : String(url).slice(-24);
  }

  function mapStub(stub) {
    const postedAbs = Sf.parsePostedDate(stub.date);
    return Sf.emptyJob(SOURCE, {
      id: `ziprecruiter_${jobIdFromUrl(stub.url)}`,
      title: stub.title || "",
      organization: stub.company || "",
      location: stub.location || "Remote",
      work_arrangement: /remote/i.test(stub.location || "Remote")
        ? "Remote"
        : "",
      date_posted: postedAbs
        ? postedAbs.toISOString().slice(0, 10)
        : stub.date || "",
      url: stub.url,
      description: stub.snippet || "",
    });
  }

  async function fetchDetailDescription(url) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return "";
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const el =
        doc.querySelector(
          "[data-testid='job-description'], .job_description, #job_description, article"
        ) || doc.body;
      return (el?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 12000);
    } catch {
      return "";
    }
  }

  Sf.installAdapter(SOURCE, CS_VERSION, async function scrapePage(opts) {
    const { recentDays } = opts;
    await Sf.sleep(1000);
    const stubs = extractStubs();
    const jobs = [];
    let skipped = 0;

    for (const stub of stubs) {
      let job = mapStub(stub);
      if (!job) continue;
      if (job.title && !Sf.looksSalesforceTitle(job.title)) {
        skipped += 1;
        continue;
      }
      if (!job.description || job.description.length < 80) {
        const detail = await fetchDetailDescription(job.url);
        if (detail) job.description = detail;
        await Sf.sleep(350);
      }
      if (!Sf.keepDomJob(job, recentDays)) {
        skipped += 1;
        continue;
      }
      jobs.push(job);
    }

    const hasNext = !!document.querySelector(
      'a[rel="next"], button[aria-label*="Next" i], a[aria-label*="Next" i]'
    );

    return {
      jobs,
      found: stubs.length,
      skipped,
      hasMore: hasNext || stubs.length >= 10,
      stats: {},
    };
  });
})();

/**
 * CareerBuilder DOM adapter — current page only.
 */
(function () {
  const Sf = globalThis.SfCapture;
  const SOURCE = "careerbuilder";
  const CS_VERSION = 2;

  function extractStubs() {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll(
      'a[href*="/job/"], a[href*="/jobs/"]'
    )) {
      const href = (a.href || "").split("#")[0];
      if (!href || seen.has(href)) continue;
      if (!/careerbuilder\.com/i.test(href)) continue;
      if (/\/jobs\?/.test(href) && !/\/job\//i.test(href)) continue;
      seen.add(href);
      const card =
        a.closest("article, li, .data-results-content, [class*='job']") ||
        a.parentElement;
      out.push({
        url: href,
        title: (a.textContent || "").replace(/\s+/g, " ").trim(),
        company:
          card
            ?.querySelector(
              "[class*='company' i], .data-details span, [data-company]"
            )
            ?.textContent?.trim() || "",
        location:
          card
            ?.querySelector("[class*='location' i], .data-details")
            ?.textContent?.trim() || "Remote",
        snippet:
          card
            ?.querySelector("p, [class*='snippet' i], [class*='description' i]")
            ?.textContent?.trim() || "",
        date:
          card
            ?.querySelector("time, [class*='date' i], [class*='posted' i]")
            ?.textContent?.trim() || "",
      });
    }
    return out.slice(0, 80);
  }

  function jobIdFromUrl(url) {
    const m =
      String(url).match(/\/job\/([^/?#]+)/i) ||
      String(url).match(/job_did=([^&]+)/i);
    return m ? decodeURIComponent(m[1]) : String(url).slice(-32);
  }

  function mapStub(stub) {
    const postedAbs = Sf.parsePostedDate(stub.date);
    const loc = stub.location || "Remote";
    return Sf.emptyJob(SOURCE, {
      id: `careerbuilder_${jobIdFromUrl(stub.url)}`,
      title: stub.title || "",
      organization: stub.company || "",
      location: loc,
      work_arrangement: /remote/i.test(loc) ? "Remote" : "",
      date_posted: postedAbs
        ? postedAbs.toISOString().slice(0, 10)
        : stub.date || "",
      url: stub.url,
      description: stub.snippet || "",
    });
  }

  async function fetchDetail(url) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return "";
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const el =
        doc.querySelector(
          ".jdp-description-details, #jdp_description, [class*='description' i], article"
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
    if (!stubs.length && (document.body?.innerText || "").length > 80) {
      return {
        jobs: [],
        found: 0,
        skipped: 0,
        hasMore: false,
        stats: { layoutUnknown: true },
        needUser: {
          type: Sf.MSG.SCRAPE_NEED_USER,
          source: SOURCE,
          reason: "blocked",
          url: location.href,
        },
      };
    }

    const jobs = [];
    let skipped = 0;
    for (const stub of stubs) {
      let job = mapStub(stub);
      if (!job) continue;
      if (job.title && !Sf.looksSalesforceTitle(job.title)) {
        skipped += 1;
        continue;
      }
      if (!job.description || job.description.length < 60) {
        const d = await fetchDetail(job.url);
        if (d) job.description = d;
        await Sf.sleep(300);
      }
      if (!Sf.keepDomJob(job, recentDays)) {
        skipped += 1;
        continue;
      }
      jobs.push(job);
    }

    const hasNext = !!document.querySelector(
      'a[aria-label*="Next" i], a.next, button[aria-label*="Next" i]'
    );

    return {
      jobs,
      found: stubs.length,
      skipped,
      hasMore: hasNext || stubs.length >= 8,
      stats: {},
    };
  });
})();

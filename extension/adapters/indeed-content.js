/**
 * Indeed DOM adapter — scrape the current search page only.
 * Background navigates between queries / pages.
 */
(function () {
  const Sf = globalThis.SfCapture;
  const SOURCE = "indeed";
  const CS_VERSION = 2;

  function extractCards() {
    const cards = [];
    const seen = new Set();

    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== "object") return;
      const key = node.jobkey || node.jobKey || node.jk;
      const title = node.title || node.displayTitle || node.jobTitle;
      if (key && title) {
        const id = String(key);
        if (!seen.has(id)) {
          seen.add(id);
          const loc = String(
            node.formattedLocation ||
              node.jobLocationCity ||
              node.location ||
              ""
          );
          cards.push({
            jobkey: id,
            title: String(title),
            company: String(
              node.company ||
                node.companyName ||
                node.companyDisplayName ||
                ""
            ),
            location: loc,
            snippet: String(
              node.snippet || node.excerpt || node.jobSnippet || ""
            ),
            pubDate:
              node.pubDate ||
              node.formattedRelativeTime ||
              node.date ||
              "",
            remote: !!(
              node.remoteLocation ||
              node.remoteWorkModel ||
              /remote/i.test(loc)
            ),
            expired: node.expired === true || node.jobExpired === true,
            href: node.viewJobLink || node.link || node.url || "",
          });
        }
        return;
      }
      for (const v of Object.values(node)) walk(v);
    };

    try {
      if (window.mosaic && window.mosaic.providerData) {
        walk(window.mosaic.providerData);
      }
    } catch {
      /* ignore */
    }

    for (const s of document.querySelectorAll("script")) {
      const t = s.textContent || "";
      if (!/"jobkey"/.test(t) && !/mosaic-provider-jobcards/.test(t)) continue;
      const trimmed = t.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          walk(JSON.parse(trimmed));
        } catch {
          /* ignore */
        }
      }
    }

    if (!cards.length) {
      for (const el of document.querySelectorAll(
        "[data-jk], a[href*='/viewjob?jk='], a.jcs-JobTitle"
      )) {
        const jk =
          el.getAttribute("data-jk") ||
          ((el.href || "").match(/[?&]jk=([a-z0-9]+)/i) || [])[1];
        if (!jk || seen.has(jk)) continue;
        seen.add(jk);
        const card =
          el.closest(".job_seen_beacon, .cardOutline, li") || el.parentElement;
        const titleEl =
          card?.querySelector("h2, a.jcs-JobTitle, span[id^='jobTitle']") || el;
        const company =
          card
            ?.querySelector(
              "[data-testid='company-name'], .companyName, span.companyName"
            )
            ?.textContent?.trim() || "";
        const location =
          card
            ?.querySelector(
              "[data-testid='text-location'], .companyLocation"
            )
            ?.textContent?.trim() || "Remote";
        const snippet =
          card
            ?.querySelector(
              ".job-snippet, [data-testid='job-snippet'], .underShelfFooter"
            )
            ?.textContent?.trim() || "";
        const date =
          card
            ?.querySelector(
              ".date, [data-testid='myJobsStateDate'], span.date"
            )
            ?.textContent?.trim() || "";
        cards.push({
          jobkey: jk,
          title: (titleEl.textContent || "").replace(/\s+/g, " ").trim(),
          company,
          location,
          snippet,
          pubDate: date,
          remote: /remote/i.test(location),
          expired: false,
          href: `https://www.indeed.com/viewjob?jk=${jk}`,
        });
      }
    }

    return cards;
  }

  function mapCard(card) {
    const jk = String(card.jobkey || "").trim();
    if (!jk) return null;
    const postedAbs = Sf.parsePostedDate(card.pubDate);
    const loc = String(card.location || "Remote");
    const remote = card.remote === true || /\bremote\b/i.test(loc);
    const href = String(card.href || "").trim();
    const url = href
      ? href.startsWith("http")
        ? href.split("&from=")[0]
        : `https://www.indeed.com${href.split("&from=")[0]}`
      : `https://www.indeed.com/viewjob?jk=${jk}`;
    return Sf.emptyJob(SOURCE, {
      id: `indeed_${jk}`,
      title: String(card.title || "").trim(),
      organization: String(card.company || "").trim(),
      location: loc || "Remote",
      work_arrangement: remote ? "Remote" : "",
      date_posted: postedAbs
        ? postedAbs.toISOString().slice(0, 10)
        : String(card.pubDate || ""),
      url,
      description: String(card.snippet || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  async function enrichFromPane(job) {
    const jk = job.id.replace(/^indeed_/, "");
    const link = document.querySelector(
      `[data-jk="${jk}"] a, [data-jk="${jk}"], a[href*="jk=${jk}"]`
    );
    if (link) {
      try {
        link.click();
        await Sf.sleep(1100);
      } catch {
        /* ignore */
      }
    }
    const pane = document.querySelector(
      "#jobDescriptionText, .jobsearch-JobComponent-description, [id*='jobDescription']"
    );
    const text = (pane?.innerText || "").trim();
    if (text.length > 80) job.description = text.slice(0, 12000);
    return job;
  }

  Sf.installAdapter(SOURCE, CS_VERSION, async function scrapePage(opts) {
    const { recentDays, page } = opts;
    await Sf.sleep(800);
    const cards = extractCards();
    const jobs = [];
    let skipped = 0;

    for (const card of cards) {
      let job = mapCard(card);
      if (!job) continue;
      if (job.title && !Sf.looksSalesforceTitle(job.title)) {
        skipped += 1;
        continue;
      }
      if (!job.description || job.description.length < 80) {
        job = await enrichFromPane(job);
      }
      if (!Sf.keepDomJob(job, recentDays)) {
        skipped += 1;
        continue;
      }
      jobs.push(job);
    }

    return {
      jobs,
      found: cards.length,
      skipped,
      hasMore: cards.length >= 8,
      stats: { page },
    };
  });
})();

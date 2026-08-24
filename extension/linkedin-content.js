/**
 * LinkedIn content script — prefer Voyager jobs API (same pattern as JobRight),
 * with a thin DOM fallback if the undocumented endpoint fails.
 * External Apply only; never clicks Apply.
 */
(function () {
  const CS_VERSION = 2;
  if (window.__SF_LINKEDIN_CS_VERSION__ === CS_VERSION) return;
  if (typeof window.__SF_LINKEDIN_CS_LISTENER__ === "function") {
    try {
      chrome.runtime.onMessage.removeListener(window.__SF_LINKEDIN_CS_LISTENER__);
    } catch {
      /* ignore */
    }
  }
  window.__SF_LINKEDIN_CS_VERSION__ = CS_VERSION;

  const US_GEO_ID = "103644278";
  const PAGE_SIZE = 25;
  const CARD_DECORATION =
    "com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220";

  const CARD_SELECTOR = [
    "li[data-occludable-job-id]",
    "li[data-job-id]",
    ".jobs-search-results__list-item",
    "[data-view-name='job-card']",
  ].join(",");
  const DETAIL_SELECTOR = [
    ".jobs-search__job-details--container",
    ".job-view-layout",
    ".jobs-details",
    ".scaffold-layout__detail",
  ].join(",");

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isLoginWall() {
    return (
      /\/(?:login|checkpoint|authwall)(?:\/|$)/i.test(location.pathname) ||
      !!document.querySelector(
        "#username, .authwall, form[action*='login'], [data-test-id='sign-in-form']"
      )
    );
  }

  function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)JSESSIONID=([^;]+)/);
    if (!match) return "";
    return decodeURIComponent(match[1]).replace(/^"|"$/g, "");
  }

  async function voyagerGet(pathAndQuery) {
    const csrf = getCsrfToken();
    if (!csrf) {
      throw new Error("LinkedIn is not signed in. Sign in, then run capture again.");
    }
    const res = await fetch(`https://www.linkedin.com${pathAndQuery}`, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/vnd.linkedin.normalized+json+2.1",
        "csrf-token": csrf,
        "x-restli-protocol-version": "2.0.0",
        "x-li-lang": "en_US",
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("LinkedIn session rejected Voyager API — re-sign in and retry.");
    }
    if (!res.ok) {
      throw new Error(`LinkedIn Voyager HTTP ${res.status}`);
    }
    return res.json();
  }

  function buildSearchPath(keywords, start) {
    const kw = String(keywords || "Salesforce").trim() || "Salesforce";
    const query =
      `(origin:JOB_SEARCH_PAGE_JOB_FILTER,` +
      `keywords:${kw},` +
      `locationUnion:(geoId:${US_GEO_ID}),` +
      `selectedFilters:(timePostedRange:List(r604800),workplaceType:List(2)),` +
      `spellCorrectionEnabled:true)`;
    return (
      `/voyager/api/voyagerJobsDashJobCards` +
      `?decorationId=${encodeURIComponent(CARD_DECORATION)}` +
      `&count=${PAGE_SIZE}&q=jobSearch` +
      `&query=${encodeURIComponent(query)}` +
      `&start=${start}`
    );
  }

  function includedByUrn(payload, urn) {
    if (!urn || !payload) return null;
    const list = payload.included || [];
    return list.find((item) => item?.entityUrn === urn || item?.$URN === urn) || null;
  }

  function jobIdFromUrn(urn) {
    const m = String(urn || "").match(/(\d{5,})/);
    return m ? m[1] : "";
  }

  function isEasyApplyCard(card, resolved) {
    const blob = JSON.stringify({ card, resolved }).toLowerCase();
    if (/"easyapply"\s*:\s*true/.test(blob)) return true;
    if (/\beasy_apply_text\b/.test(blob)) return true;
    if (/com\.linkedin\.jobs\.easyapply/.test(blob)) return true;
    if (resolved?.footerItems?.some((f) => /easy\s*apply/i.test(f?.text || f?.type || ""))) {
      return true;
    }
    // Offsite / company website apply → not Easy Apply
    if (/offsiteapply|company_apply|external/i.test(blob) && !/easyapply/i.test(blob)) {
      return false;
    }
    return false;
  }

  function extractCards(payload) {
    const elements =
      payload?.data?.elements ||
      payload?.data?.["*elements"] ||
      payload?.elements ||
      [];
    const cards = [];
    for (const el of elements) {
      const ref = typeof el === "string" ? el : el?.entityUrn || el?.["*card"] || "";
      const card =
        (typeof el === "object" && el?.jobCard && el) ||
        includedByUrn(payload, ref) ||
        (typeof el === "object" ? el : null);
      if (!card) continue;
      cards.push(card);
    }
    // Some responses put job cards only in `included`
    if (!cards.length && Array.isArray(payload?.included)) {
      for (const item of payload.included) {
        if (/JobPostingCard|JobCard|jobPosting/i.test(item?.$type || "")) {
          cards.push(item);
        }
      }
    }
    return cards;
  }

  function mapApiCard(card, payload) {
    const jobUrn =
      card?.jobPostingUrn ||
      card?.["*jobPosting"] ||
      card?.jobPosting?.entityUrn ||
      card?.entityUrn ||
      "";
    const id = jobIdFromUrn(jobUrn) || jobIdFromUrn(card?.entityUrn);
    if (!id) return { reason: "malformed" };

    const posting =
      includedByUrn(payload, jobUrn) ||
      includedByUrn(payload, `urn:li:fsd_jobPosting:${id}`) ||
      includedByUrn(payload, `urn:li:jobPosting:${id}`) ||
      card?.jobPosting ||
      {};

    const title =
      card?.title?.text ||
      card?.jobPostingTitle ||
      posting?.title ||
      posting?.title?.text ||
      "";
    const organization =
      card?.primaryDescription?.text ||
      card?.companyName ||
      posting?.companyDetails?.companyName ||
      posting?.companyName ||
      "";
    const locationText =
      card?.secondaryDescription?.text ||
      card?.location ||
      posting?.formattedLocation ||
      posting?.location?.displayName ||
      "";
    const listedAt = posting?.listedAt || posting?.originalListedAt || card?.listedAt;
    const datePosted = listedAt
      ? new Date(Number(listedAt)).toISOString().slice(0, 10)
      : "";

    if (!title || !organization) return { reason: "malformed" };
    if (isEasyApplyCard(card, posting)) return { reason: "easyApply" };

    return {
      job: {
        id: `linkedin_${id}`,
        title: String(title).trim(),
        organization: String(organization).trim(),
        location: String(locationText).trim(),
        work_arrangement: "Remote",
        remote_restricted_to: "United States",
        experience_level: "",
        employment_type: "",
        salary_min: "",
        salary_max: "",
        salary_currency: "USD",
        salary_unit: "",
        key_skills: "",
        source: "linkedin",
        date_posted: datePosted,
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        description: "",
        _jobId: id,
      },
    };
  }

  async function enrichDescription(job) {
    const id = job._jobId;
    if (!id) return job;
    try {
      const detail = await voyagerGet(
        `/voyager/api/jobs/jobPostings/${id}?decorationId=com.linkedin.voyager.deco.jobs.web.shared.WebFullJobPosting-65`
      );
      const desc =
        detail?.data?.description?.text ||
        detail?.description?.text ||
        detail?.data?.description ||
        "";
      if (desc) job.description = String(desc).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      // Re-check apply method on detail if present
      const applyMethod = JSON.stringify(detail?.data?.applyMethod || detail?.applyMethod || "");
      if (/EasyApply/i.test(applyMethod)) {
        return null; // signal caller to drop as easy apply
      }
    } catch {
      /* description optional */
    }
    delete job._jobId;
    return job;
  }

  async function scrapeViaVoyager(options = {}) {
    if (isLoginWall()) {
      throw new Error("LinkedIn is not signed in. Sign in, then run capture again.");
    }
    const keywords = String(options.keywords || "Salesforce").trim() || "Salesforce";
    const maxJobs = Math.max(1, Math.min(100, Number(options.maxJobs) || 60));
    const jobs = [];
    const stats = {
      examined: 0,
      kept: 0,
      easyApply: 0,
      noExternalApply: 0,
      closed: 0,
      malformed: 0,
      via: "api",
    };

    for (let start = 0; start < maxJobs; start += PAGE_SIZE) {
      const payload = await voyagerGet(buildSearchPath(keywords, start));
      const cards = extractCards(payload);
      if (!cards.length) break;

      for (const card of cards) {
        if (jobs.length >= maxJobs) break;
        stats.examined += 1;
        const mapped = mapApiCard(card, payload);
        if (!mapped.job) {
          stats[mapped.reason] = (stats[mapped.reason] || 0) + 1;
          continue;
        }
        const enriched = await enrichDescription(mapped.job);
        if (!enriched) {
          stats.easyApply += 1;
          continue;
        }
        jobs.push(enriched);
        stats.kept += 1;
        await sleep(200);
      }

      if (cards.length < PAGE_SIZE) break;
      await sleep(400);
    }

    if (stats.examined === 0) {
      throw new Error("Voyager returned no job cards");
    }
    return { jobs, stats };
  }

  function text(root, selectors) {
    for (const selector of selectors) {
      const value = root?.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
      if (value) return value;
    }
    return "";
  }

  function attr(root, selectors, name) {
    for (const selector of selectors) {
      const value = root?.querySelector(selector)?.getAttribute(name)?.trim();
      if (value) return value;
    }
    return "";
  }

  function jobIdFromCard(card) {
    const direct =
      card.getAttribute("data-occludable-job-id") ||
      card.getAttribute("data-job-id") ||
      card.querySelector("[data-job-id]")?.getAttribute("data-job-id") ||
      "";
    const match = String(direct || card.innerHTML).match(
      /(?:currentJobId=|\/jobs\/view\/|urn:li:jobPosting:)(\d{5,})/i
    );
    return String(direct).match(/\d{5,}/)?.[0] || match?.[1] || "";
  }

  function applyKind(detail) {
    const candidates = [
      ...detail.querySelectorAll(
        "button.jobs-apply-button, button[aria-label*='Apply' i], a[aria-label*='Apply' i]"
      ),
    ];
    for (const button of candidates) {
      const label = `${button.textContent || ""} ${button.getAttribute("aria-label") || ""}`
        .replace(/\s+/g, " ")
        .trim();
      if (/\beasy\s+apply\b/i.test(label)) return "easy";
      if (/\bapply\b/i.test(label)) return "external";
    }
    return "none";
  }

  async function selectCard(card, id) {
    card.scrollIntoView({ block: "center", behavior: "instant" });
    const target =
      card.querySelector("a[href*='/jobs/view/']") ||
      card.querySelector(".job-card-container__link") ||
      card;
    target.click();
    const started = Date.now();
    while (Date.now() - started < 8000) {
      const currentId = new URL(location.href).searchParams.get("currentJobId");
      const detail = document.querySelector(DETAIL_SELECTOR);
      if (detail && (currentId === id || Date.now() - started > 1400)) return detail;
      await sleep(250);
    }
    return document.querySelector(DETAIL_SELECTOR);
  }

  function mapSelectedJob(card, detail, id) {
    const title =
      text(detail, [
        ".job-details-jobs-unified-top-card__job-title",
        ".jobs-unified-top-card__job-title",
        "h1",
      ]) || text(card, [".job-card-list__title--link", ".job-card-container__link", "strong"]);
    const organization =
      text(detail, [
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name",
        "a[href*='/company/']",
      ]) ||
      text(card, [".artdeco-entity-lockup__subtitle", ".job-card-container__primary-description"]);
    const locationText =
      text(detail, [
        ".job-details-jobs-unified-top-card__tertiary-description-container",
        ".jobs-unified-top-card__bullet",
      ]) || text(card, [".artdeco-entity-lockup__caption", ".job-card-container__metadata-item"]);
    const description = text(detail, [
      ".jobs-description-content__text",
      ".jobs-description__content",
      "#job-details",
    ]);
    const datePosted =
      attr(detail, ["time[datetime]"], "datetime") ||
      text(detail, [".jobs-unified-top-card__posted-date"]) ||
      attr(card, ["time[datetime]"], "datetime");

    if (!id || !title || !organization) return { reason: "malformed" };
    if (/no longer accepting applications|this job is no longer available/i.test(detail.textContent || "")) {
      return { reason: "closed" };
    }
    const kind = applyKind(detail);
    if (kind !== "external") return { reason: kind === "easy" ? "easyApply" : "noExternalApply" };

    return {
      job: {
        id: `linkedin_${id}`,
        title,
        organization,
        location: locationText,
        work_arrangement: "Remote",
        remote_restricted_to: "United States",
        experience_level: "",
        employment_type: "",
        salary_min: "",
        salary_max: "",
        salary_currency: "USD",
        salary_unit: "",
        key_skills: "",
        source: "linkedin",
        date_posted: datePosted,
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        description,
      },
    };
  }

  async function scrapeViaDom(options = {}) {
    const maxJobs = Math.max(1, Math.min(100, Number(options.maxJobs) || 60));
    const maxScrolls = Math.max(1, Math.min(20, Number(options.maxScrolls) || 12));
    const jobs = [];
    const seen = new Set();
    const stats = {
      examined: 0,
      kept: 0,
      easyApply: 0,
      noExternalApply: 0,
      closed: 0,
      malformed: 0,
      via: "dom",
    };
    const scroller =
      document.querySelector(".jobs-search-results-list") ||
      document.querySelector(".scaffold-layout__list") ||
      document.scrollingElement;

    let stagnant = 0;
    for (let scroll = 0; scroll < maxScrolls && seen.size < maxJobs; scroll += 1) {
      const cards = [...document.querySelectorAll(CARD_SELECTOR)];
      let foundNew = false;
      for (const card of cards) {
        if (seen.size >= maxJobs) break;
        const id = jobIdFromCard(card);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        foundNew = true;
        stats.examined += 1;
        try {
          const detail = await selectCard(card, id);
          if (!detail) {
            stats.malformed += 1;
            continue;
          }
          const mapped = mapSelectedJob(card, detail, id);
          if (mapped.job) {
            jobs.push(mapped.job);
            stats.kept += 1;
          } else {
            stats[mapped.reason] = (stats[mapped.reason] || 0) + 1;
          }
        } catch {
          stats.malformed += 1;
        }
        await sleep(650);
      }
      stagnant = foundNew ? 0 : stagnant + 1;
      if (stagnant >= 2) break;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
      await sleep(1200);
    }
    return { jobs, stats };
  }

  async function scrapeLinkedinJobs(options = {}) {
    if (isLoginWall()) {
      throw new Error("LinkedIn is not signed in. Sign in, then run capture again.");
    }
    try {
      return await scrapeViaVoyager(options);
    } catch (err) {
      console.warn("[linkedin] Voyager failed, falling back to DOM:", err);
      const dom = await scrapeViaDom(options);
      dom.stats.apiError = String(err.message || err);
      return dom;
    }
  }

  const listener = (message, _sender, sendResponse) => {
    if (message?.type !== "SCRAPE_LINKEDIN_V2" && message?.type !== "SCRAPE_LINKEDIN_V1") {
      return false;
    }
    scrapeLinkedinJobs(message.options)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  };

  window.__SF_LINKEDIN_CS_LISTENER__ = listener;
  chrome.runtime.onMessage.addListener(listener);
})();

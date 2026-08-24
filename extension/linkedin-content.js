/**
 * LinkedIn content script — scrape US remote Salesforce search results from
 * the user's signed-in browser session. Only external Apply jobs are returned;
 * Easy Apply jobs are deliberately skipped and no apply button is clicked.
 */
(function () {
  const CS_VERSION = 1;
  if (window.__SF_LINKEDIN_CS_VERSION__ === CS_VERSION) return;
  if (typeof window.__SF_LINKEDIN_CS_LISTENER__ === "function") {
    try {
      chrome.runtime.onMessage.removeListener(window.__SF_LINKEDIN_CS_LISTENER__);
    } catch {
      /* ignore stale listener cleanup */
    }
  }
  window.__SF_LINKEDIN_CS_VERSION__ = CS_VERSION;

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

  function isLoginWall() {
    return (
      /\/(?:login|checkpoint|authwall)(?:\/|$)/i.test(location.pathname) ||
      !!document.querySelector(
        "#username, .authwall, form[action*='login'], [data-test-id='sign-in-form']"
      )
    );
  }

  function resultScroller() {
    return (
      document.querySelector(".jobs-search-results-list") ||
      document.querySelector(".scaffold-layout__list") ||
      document.querySelector("[class*='jobs-search-results-list']") ||
      document.scrollingElement
    );
  }

  async function waitForCards(timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (isLoginWall()) {
        throw new Error("LinkedIn is not signed in. Sign in, then run capture again.");
      }
      const cards = [...document.querySelectorAll(CARD_SELECTOR)];
      if (cards.length) return cards;
      await sleep(500);
    }
    throw new Error(
      "No LinkedIn job cards found. Open LinkedIn Jobs, confirm search results are visible, and reload the extension."
    );
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
      const detailUrn =
        detail?.querySelector("[data-job-id]")?.getAttribute("data-job-id") || "";
      if (detail && (currentId === id || detailUrn.includes(id) || Date.now() - started > 1400)) {
        return detail;
      }
      await sleep(250);
    }
    return document.querySelector(DETAIL_SELECTOR);
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

  function mapSelectedJob(card, detail, id) {
    const title =
      text(detail, [
        ".job-details-jobs-unified-top-card__job-title",
        ".jobs-unified-top-card__job-title",
        "h1",
      ]) ||
      text(card, [".job-card-list__title--link", ".job-card-container__link", "strong"]);
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
        ".jobs-unified-top-card__subtitle-primary-grouping",
      ]) ||
      text(card, [".artdeco-entity-lockup__caption", ".job-card-container__metadata-item"]);
    const description = text(detail, [
      ".jobs-description-content__text",
      ".jobs-description__content",
      "#job-details",
    ]);
    const datePosted =
      attr(detail, ["time[datetime]"], "datetime") ||
      text(detail, [
        ".job-details-jobs-unified-top-card__tertiary-description-container time",
        ".jobs-unified-top-card__posted-date",
      ]) ||
      attr(card, ["time[datetime]"], "datetime") ||
      text(card, ["time", ".job-card-container__footer-item"]);
    const pageText = detail.textContent || "";

    if (!id || !title || !organization) return { reason: "malformed" };
    if (
      /no longer accepting applications|this job is no longer available|job has expired/i.test(
        pageText
      )
    ) {
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

  async function scrapeLinkedinJobs(options = {}) {
    if (isLoginWall()) {
      throw new Error("LinkedIn is not signed in. Sign in, then run capture again.");
    }

    await waitForCards();
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
    };
    const scroller = resultScroller();
    let stagnantScrolls = 0;

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

      stagnantScrolls = foundNew ? 0 : stagnantScrolls + 1;
      if (stagnantScrolls >= 2) break;
      const before = scroller.scrollTop;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
      if (scroller === document.scrollingElement) window.scrollTo(0, document.body.scrollHeight);
      await sleep(before === scroller.scrollTop ? 1800 : 1200);
    }

    return { jobs, stats };
  }

  const listener = (message, _sender, sendResponse) => {
    if (message?.type !== "SCRAPE_LINKEDIN_V1") return false;
    scrapeLinkedinJobs(message.options)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  };

  window.__SF_LINKEDIN_CS_LISTENER__ = listener;
  chrome.runtime.onMessage.addListener(listener);
})();

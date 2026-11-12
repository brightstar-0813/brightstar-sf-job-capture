/**
 * Shared content-script helpers for current-page scrapes.
 * Background owns navigation / pagination (location changes kill CS).
 */
(function (g) {
  const Sf = (g.SfCapture = g.SfCapture || {});

  Sf.sleep = function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  };

  Sf.send = function send(payload) {
    return chrome.runtime.sendMessage(payload).catch(() => ({}));
  };

  Sf.pageSignals = function pageSignals() {
    const title = document.title || "";
    const body = (document.body?.innerText || "").slice(0, 1200);
    const href = location.href;
    return { title, body, href };
  };

  /**
   * @returns {{ ok: true } | { ok: false, needUser: object }}
   */
  Sf.inspectPage = function inspectPage(source) {
    Sf.dismissConsent(document);
    const { title, body, href } = Sf.pageSignals();
    if (Sf.looksBlockedPage(title, body)) {
      return {
        ok: false,
        needUser: {
          type: Sf.MSG.SCRAPE_NEED_USER,
          source,
          reason: /cloudflare|just a moment|cf-browser/i.test(`${title}\n${body}`)
            ? "cloudflare"
            : "captcha",
          url: href,
        },
      };
    }
    if (Sf.looksLoginPage(title, body, href)) {
      return {
        ok: false,
        needUser: {
          type: Sf.MSG.SCRAPE_NEED_USER,
          source,
          reason: "login",
          url: href,
        },
      };
    }
    if ((document.body?.innerText || "").trim().length < 40) {
      return {
        ok: false,
        needUser: {
          type: Sf.MSG.SCRAPE_NEED_USER,
          source,
          reason: "blocked",
          url: href,
        },
      };
    }
    return { ok: true };
  };

  /**
   * Install page scraper. Handles SCRAPE_PAGE (preferred) and SCRAPE_START
   * (single current-page scrape for compatibility).
   */
  Sf.installAdapter = function installAdapter(source, version, scrapePageFn) {
    const flag = `__SF_${source.toUpperCase()}_CS_VERSION__`;
    if (g[flag] === version) return;
    const listenerKey = `__SF_${source.toUpperCase()}_CS_LISTENER__`;
    if (typeof g[listenerKey] === "function") {
      try {
        chrome.runtime.onMessage.removeListener(g[listenerKey]);
      } catch {
        /* ignore */
      }
    }
    g[flag] = version;

    async function handle(msg) {
      const recentDays = Math.max(1, Number(msg.recentDays) || 7);
      const page = Math.max(0, Number(msg.page) || 0);
      const query = msg.query || (msg.queries && msg.queries[0]) || "Salesforce";

      const gate = Sf.inspectPage(source);
      if (!gate.ok) {
        return { ok: false, needUser: gate.needUser, jobs: [], found: 0 };
      }

      try {
        const result = await scrapePageFn({
          source,
          query,
          recentDays,
          page,
          maxPages: msg.maxPages,
        });
        if (result?.needUser) {
          return { ok: false, needUser: result.needUser, jobs: [], found: 0 };
        }
        return {
          ok: true,
          jobs: result.jobs || [],
          found: result.found ?? (result.jobs || []).length,
          skipped: result.skipped || 0,
          hasMore: !!result.hasMore,
          stats: result.stats || {},
        };
      } catch (err) {
        return { ok: false, error: err.message || String(err), jobs: [] };
      }
    }

    function listener(msg, _sender, sendResponse) {
      if (!msg) return;
      if (
        msg.type !== Sf.MSG.SCRAPE_START &&
        msg.type !== "SCRAPE_PAGE"
      ) {
        return;
      }
      if (msg.source && msg.source !== source) return;
      handle(msg)
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({ ok: false, error: err.message, jobs: [] })
        );
      return true;
    }

    g[listenerKey] = listener;
    chrome.runtime.onMessage.addListener(listener);
  };
})(typeof globalThis !== "undefined" ? globalThis : self);

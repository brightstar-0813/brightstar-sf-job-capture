/**
 * Shared extension protocol — classic script (importScripts + content_scripts).
 * Attaches to globalThis.SfCapture.
 */
(function (g) {
  const Sf = (g.SfCapture = g.SfCapture || {});

  Sf.API_BASE = "http://127.0.0.1:3847";

  Sf.EXT_SOURCES = [
    "indeed",
    "ziprecruiter",
    "monster",
    "careerbuilder",
    "jobright",
  ];

  Sf.MSG = {
    SCRAPE_START: "SCRAPE_START",
    SCRAPE_PROGRESS: "SCRAPE_PROGRESS",
    SCRAPE_BATCH: "SCRAPE_BATCH",
    SCRAPE_NEED_USER: "SCRAPE_NEED_USER",
    SCRAPE_PAUSE: "SCRAPE_PAUSE",
    SCRAPE_RESUME: "SCRAPE_RESUME",
    SCRAPE_STOP: "SCRAPE_STOP",
    SCRAPE_DONE: "SCRAPE_DONE",
    SCRAPE_ERROR: "SCRAPE_ERROR",
    /** Current-page scrape (background owns navigation) */
    SCRAPE_PAGE: "SCRAPE_PAGE",
    /** Legacy JobRight */
    SCRAPE_JOBRIGHT_V3: "SCRAPE_JOBRIGHT_V3",
    /** Popup ↔ background */
    GET_STATE: "GET_STATE",
    RUN_CAPTURE: "RUN_CAPTURE",
    STOP_CAPTURE: "STOP_CAPTURE",
    RESUME_CAPTURE: "RESUME_CAPTURE",
    OPEN_NEED_USER_URL: "OPEN_NEED_USER_URL",
    FLUSH_BUFFER: "FLUSH_BUFFER",
  };

  Sf.DEFAULT_QUERIES = [
    "Salesforce",
    "Health Cloud",
    "Data Cloud",
    "Marketing Cloud",
    "Service Cloud",
    "Agentforce",
    "OmniStudio",
    "Salesforce CPQ",
  ];

  Sf.DEFAULT_ROLE_TITLES = [
    "Salesforce Administrator",
    "Salesforce Developer",
    "Salesforce Consultant",
    "Salesforce Business Analyst",
    "Salesforce Architect",
    "Salesforce Engineer",
    "Salesforce Marketing Cloud",
    "Salesforce CPQ",
    "Salesforce Technical Lead",
    "Salesforce Solution Architect",
    "Salesforce Project Manager",
    "Salesforce QA Engineer",
    "Health Cloud",
    "Data Cloud",
    "Service Cloud",
    "Agentforce",
    "OmniStudio",
    "Revenue Cloud",
    "Financial Services Cloud",
  ];

  Sf.DEFAULT_SETTINGS = {
    enabledSources: ["indeed", "jobright"],
    queries: Sf.DEFAULT_QUERIES.slice(),
    roleTitles: Sf.DEFAULT_ROLE_TITLES.slice(),
    scheduleEnabled: true,
    runHours: [5, 17],
    autoCloseTabs: true,
    maxPagesPerQuery: 3,
    recentDays: 7,
    dryRun: false,
    excludeBidTracking: true,
  };

  Sf.SOURCE_HOME = {
    indeed: "https://www.indeed.com/",
    ziprecruiter: "https://www.ziprecruiter.com/",
    monster: "https://www.monster.com/",
    careerbuilder: "https://www.careerbuilder.com/",
    jobright: "https://jobright.ai/jobs/search",
  };

  Sf.ADAPTER_FILES = {
    indeed: [
      "lib/protocol.js",
      "lib/filter-lite.js",
      "lib/dom-runner.js",
      "adapters/indeed-content.js",
    ],
    ziprecruiter: [
      "lib/protocol.js",
      "lib/filter-lite.js",
      "lib/dom-runner.js",
      "adapters/ziprecruiter-content.js",
    ],
    monster: [
      "lib/protocol.js",
      "lib/filter-lite.js",
      "lib/dom-runner.js",
      "adapters/monster-content.js",
    ],
    careerbuilder: [
      "lib/protocol.js",
      "lib/filter-lite.js",
      "lib/dom-runner.js",
      "adapters/careerbuilder-content.js",
    ],
    jobright: ["adapters/jobright-content.js"],
  };

  Sf.normalizeSources = function normalizeSources(list) {
    const allow = new Set(Sf.EXT_SOURCES);
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const s = String(raw || "").toLowerCase().trim();
      if (!allow.has(s) || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  };
})(typeof globalThis !== "undefined" ? globalThis : self);

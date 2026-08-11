/**
 * Background: schedule JobRight scrape every 8 hours using the user's
 * logged-in Chrome session (no Playwright login file needed).
 */

const API = "http://127.0.0.1:3847";
const ALARM = "jobright-capture-8h";
const PERIOD_MINUTES = 8 * 60;

/** Same role-family seeds as Playwright JOBRIGHT_TITLES (not title filters). */
const DEFAULT_TITLES = [
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
];

function buildSearchUrl(query = "Salesforce Administrator") {
  const taxonomy = encodeURIComponent(
    JSON.stringify([{ taxonomyId: "00-00-00", title: query }])
  );
  const value = encodeURIComponent(query);
  return (
    `https://jobright.ai/jobs/search?visit=search&value=${value}` +
    `&searchType=job_title&country=US&jobTaxonomyList=${taxonomy}`
  );
}

async function apiPost(path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Local API offline — run npm start (or schedule:api) on port 3847"
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function getTitles() {
  const stored = await chrome.storage.local.get(["jobrightTitles", "searchQ"]);
  if (Array.isArray(stored.jobrightTitles) && stored.jobrightTitles.length) {
    return stored.jobrightTitles.map(String).filter(Boolean);
  }
  if (typeof stored.jobrightTitles === "string" && stored.jobrightTitles.trim()) {
    return stored.jobrightTitles
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Prefer multi-title seeds; fall back to single searchQ only if set explicitly
  // to something other than bare Salesforce (which returns Salesforce-company jobs).
  return DEFAULT_TITLES;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["jobright-content.js"],
    });
  } catch {
    /* already injected or page not ready */
  }
}

async function scrapeTab(tabId, titles) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ensureContentScript(tabId);
    await sleep(800 + attempt * 500);
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "SCRAPE_JOBRIGHT",
        titles,
      });
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    lastErr?.message ||
      "Could not reach JobRight content script (reload the extension and stay signed in on jobright.ai)"
  );
}

/**
 * Open JobRight in a tab (uses existing login cookies), scrape, ingest, close.
 */
async function captureJobrightFromChrome() {
  const titles = await getTitles();
  const url = buildSearchUrl(titles[0] || "Salesforce Administrator");

  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id;

  try {
    await waitForTabComplete(tabId, 45000);
    await sleep(4000);

    const result = await scrapeTab(tabId, titles);

    if (!result?.ok) {
      throw new Error(result?.error || "JobRight scrape failed");
    }

    const ingest = await apiPost("/api/ingest", {
      source: "jobright",
      trusted: true,
      jobs: result.jobs || [],
    });

    await chrome.storage.local.set({
      lastJobrightCapture: {
        at: new Date().toISOString(),
        stats: result.stats,
        ingest,
      },
      lastJobrightError: null,
    });

    return { ok: true, stats: result.stats, ingest };
  } finally {
    try {
      if (tabId != null) await chrome.tabs.remove(tabId);
    } catch {
      /* ignore */
    }
  }
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) {
    chrome.alarms.create(ALARM, {
      delayInMinutes: 1,
      periodInMinutes: PERIOD_MINUTES,
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  captureJobrightFromChrome().catch((err) => {
    console.error("[jobright alarm]", err);
    chrome.storage.local.set({
      lastJobrightError: {
        at: new Date().toISOString(),
        error: String(err.message || err),
      },
    });
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CAPTURE_JOBRIGHT_NOW") {
    captureJobrightFromChrome()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === "GET_JOBRIGHT_STATUS") {
    chrome.storage.local
      .get(["lastJobrightCapture", "lastJobrightError"])
      .then((data) => sendResponse({ ok: true, ...data }));
    return true;
  }
  return false;
});

ensureAlarm();

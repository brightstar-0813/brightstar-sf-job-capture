/**
 * Background: schedule JobRight scrape every 8 hours using the user's
 * logged-in Chrome session (no Playwright login file needed).
 */

const API = "http://127.0.0.1:3847";
const ALARM = "jobright-capture-8h";
const PERIOD_MINUTES = 8 * 60;

function buildSearchUrl(query = "Salesforce") {
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
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function getQuery() {
  const stored = await chrome.storage.local.get(["searchQ"]);
  return stored.searchQ || "Salesforce";
}

/**
 * Open JobRight in a tab (uses existing login cookies), scrape, ingest, close.
 */
async function captureJobrightFromChrome() {
  const query = await getQuery();
  const url = buildSearchUrl(query);

  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id;

  try {
    // Wait for load
    await waitForTabComplete(tabId, 45000);
    await sleep(4000);

    // Ensure content script is present (SPA navigations)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["jobright-content.js"],
      });
    } catch {
      /* may already be injected */
    }

    await sleep(1500);

    const result = await chrome.tabs.sendMessage(tabId, {
      type: "SCRAPE_JOBRIGHT",
      query,
    });

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
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
      lastJobrightError: { at: new Date().toISOString(), error: String(err.message || err) },
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

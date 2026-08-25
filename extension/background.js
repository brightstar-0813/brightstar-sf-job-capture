/**
 * Background: schedule JobRight scrape every 8 hours (local time: 12 AM, 8 AM, 4 PM)
 * using the user's logged-in Chrome session. LinkedIn is not scraped.
 */

const API = "http://127.0.0.1:3847";
const ALARM = "salesforce-capture-8h";
const LEGACY_ALARMS = [
  "salesforce-capture-daily",
  "jobright-capture-daily",
  "jobright-capture-8h",
  "jobright-capture-12h",
];
/** Local hours (24h) when extension capture runs — every 8 hours. */
const RUN_HOURS = [0, 8, 16];

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
  "Health Cloud",
  "Data Cloud",
  "Service Cloud",
  "Agentforce",
  "OmniStudio",
  "Revenue Cloud",
  "Financial Services Cloud",
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
        // v3+ — old content scripts ignored this type (they only handled SCRAPE_JOBRIGHT)
        type: "SCRAPE_JOBRIGHT_V3",
        titles,
      });
      // Stale CS (pre-v3) still throws recommend/search HTTP 400 via ok:false.
      if (result && result.ok === false && /HTTP 400/i.test(String(result.error || ""))) {
        lastErr = new Error(result.error);
        // Force re-inject: clear version so next ensureContentScript upgrades.
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            try {
              delete window.__SF_JOBRIGHT_CS_VERSION__;
              delete window.__SF_JOBRIGHT_CS_LOADED__;
            } catch {
              /* ignore */
            }
          },
        });
        continue;
      }
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

async function runWithStoredError(capture, errorKey, label) {
  try {
    return await capture();
  } catch (err) {
    console.error(`[${label}]`, err);
    await chrome.storage.local.set({
      [errorKey]: {
        at: new Date().toISOString(),
        error: String(err.message || err),
      },
    });
    throw err;
  }
}

async function captureScheduledSources(sources = ["jobright"]) {
  const want = new Set(
    (Array.isArray(sources) ? sources : ["jobright"])
      .map((s) => String(s).toLowerCase())
      .filter((s) => s === "jobright")
  );
  const results = {};
  if (want.has("jobright") || want.size === 0) {
    try {
      results.jobright = await runWithStoredError(
        captureJobrightFromChrome,
        "lastJobrightError",
        "jobright alarm"
      );
    } catch {
      /* per-source error already stored */
    }
  }
  return results;
}

function nextRunMs(from = new Date()) {
  const now = from.getTime();
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of RUN_HOURS) {
      const d = new Date(from);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hour, 0, 0, 0);
      if (d.getTime() > now + 60_000) return d.getTime();
    }
  }
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(RUN_HOURS[0], 0, 0, 0);
  return fallback.getTime();
}

const POLL_ALARM = "extension-capture-poll";

async function ensureAlarm() {
  for (const name of LEGACY_ALARMS) {
    await chrome.alarms.clear(name);
  }
  const when = nextRunMs();
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || Math.abs((existing.scheduledTime || 0) - when) > 60_000) {
    await chrome.alarms.clear(ALARM);
    chrome.alarms.create(ALARM, { when });
  }
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
}

function scheduleNextAlarm() {
  chrome.alarms.create(ALARM, { when: nextRunMs() });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

async function setActionState(title, badgeText = "", badgeColor = "#0b6e4f") {
  try {
    await chrome.action.setTitle({ title });
    await chrome.action.setBadgeText({ text: badgeText });
    if (badgeText) {
      await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    }
  } catch {
    /* ignore badge failures in older Chrome */
  }
}

async function runCaptureNow(label, sources) {
  await setActionState(`${label} — capturing…`, "…", "#5c5c5c");
  const results = await captureScheduledSources(sources);
  const jrOk = !!results.jobright?.ok;
  const jrKept = results.jobright?.stats?.kept ?? 0;
  const ok = jrOk;
  const title = ok
    ? `Last capture OK — JobRight kept ${jrKept}`
    : "Last capture failed — check chrome://extensions service worker logs; keep npm start running";
  await setActionState(title, ok ? "OK" : "!", ok ? "#0b6e4f" : "#b42318");
  return results;
}

async function pollQueuedCapture() {
  let res;
  try {
    res = await fetch(`${API}/api/extension/poll`);
  } catch {
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!data?.run) return;
  const sources = Array.isArray(data.sources) ? data.sources : ["jobright"];
  await runCaptureNow("API-queued capture", sources);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollQueuedCapture().catch((err) => console.error("[poll capture]", err));
    return;
  }
  if (alarm.name !== ALARM) return;
  runCaptureNow("Scheduled capture", ["jobright"])
    .catch((err) => console.error("[scheduled capture]", err))
    .finally(() => {
      scheduleNextAlarm();
    });
});

/**
 * No popup — toolbar click runs a queued capture if one is waiting,
 * otherwise JobRight only.
 */
chrome.action.onClicked.addListener(() => {
  (async () => {
    let sources = ["jobright"];
    try {
      const res = await fetch(`${API}/api/extension/poll`);
      const data = await res.json().catch(() => ({}));
      if (data?.run && Array.isArray(data.sources) && data.sources.length) {
        sources = data.sources.filter((s) => s === "jobright");
        if (!sources.length) sources = ["jobright"];
      }
    } catch {
      /* API offline — still try JobRight */
    }
    await runCaptureNow("Manual capture", sources);
  })().catch((err) => {
    console.error("[manual capture]", err);
    setActionState(
      `Capture failed: ${err.message || err}`,
      "!",
      "#b42318"
    );
  });
});

ensureAlarm();

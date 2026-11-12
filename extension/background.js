/**
 * Extension orchestrator — scheduled + popup + API-queued DOM / JobRight capture.
 * Node API / Playwright path remains independent.
 */

importScripts("lib/protocol.js", "lib/filter-lite.js");

const Sf = self.SfCapture;
const API = Sf.API_BASE;
const ALARM = "salesforce-capture-5am5pm";
const POLL_ALARM = "extension-capture-poll";
const BUFFER_ALARM = "extension-buffer-flush";
const LEGACY_ALARMS = [
  "salesforce-capture-daily",
  "salesforce-capture-6h",
  "salesforce-capture-8h",
  "jobright-capture-daily",
  "jobright-capture-8h",
  "jobright-capture-12h",
];

/** @type {ReturnType<typeof emptyRunState>} */
let runState = emptyRunState();
let resumeResolver = null;
let activeTabId = null;

function emptyRunState() {
  return {
    running: false,
    paused: false,
    stopRequested: false,
    needUser: null,
    currentSource: null,
    sources: [],
    progress: { found: 0, kept: 0, page: 0, skipped: 0 },
    lastRun: null,
    enabledSources: Sf.DEFAULT_SETTINGS.enabledSources.slice(),
    bufferCount: 0,
    dryRun: false,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  const merged = { ...Sf.DEFAULT_SETTINGS, ...stored };
  if (!Array.isArray(merged.enabledSources) || !merged.enabledSources.length) {
    merged.enabledSources = Sf.DEFAULT_SETTINGS.enabledSources.slice();
  }
  if (!Array.isArray(merged.queries) || !merged.queries.length) {
    merged.queries = Sf.DEFAULT_QUERIES.slice();
  }
  if (!Array.isArray(merged.roleTitles) || !merged.roleTitles.length) {
    merged.roleTitles = Sf.DEFAULT_ROLE_TITLES.slice();
  }
  if (!Array.isArray(merged.runHours) || !merged.runHours.length) {
    merged.runHours = [5, 17];
  }
  return merged;
}

async function refreshBufferCount() {
  const { ingestBuffer } = await chrome.storage.local.get("ingestBuffer");
  runState.bufferCount = Array.isArray(ingestBuffer) ? ingestBuffer.length : 0;
}

async function persistRunSnapshot() {
  await chrome.storage.local.set({
    extensionRunState: {
      running: runState.running,
      paused: runState.paused,
      needUser: runState.needUser,
      currentSource: runState.currentSource,
      progress: runState.progress,
      lastRun: runState.lastRun,
      bufferCount: runState.bufferCount,
    },
  });
}

async function setActionState(title, badgeText = "", badgeColor = "#0b6e4f") {
  try {
    await chrome.action.setTitle({ title });
    await chrome.action.setBadgeText({ text: badgeText });
    if (badgeText) {
      await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    }
  } catch {
    /* ignore */
  }
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message: String(message || "").slice(0, 250),
      priority: 1,
    });
  } catch {
    /* notifications permission optional at runtime */
  }
}

async function apiFetch(path, opts = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, opts);
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

async function apiPost(path, body) {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function bufferJobs(source, jobs) {
  const { ingestBuffer } = await chrome.storage.local.get("ingestBuffer");
  const list = Array.isArray(ingestBuffer) ? ingestBuffer : [];
  list.push({
    at: new Date().toISOString(),
    source,
    jobs,
  });
  await chrome.storage.local.set({ ingestBuffer: list.slice(-40) });
  await refreshBufferCount();
}

async function ingestJobs(source, jobs, settings) {
  if (!jobs?.length) return { ok: true, received: 0, newCount: 0 };
  if (settings.dryRun) {
    return {
      ok: true,
      dryRun: true,
      received: jobs.length,
      newCount: 0,
      updatedCount: 0,
      skippedCount: 0,
    };
  }
  try {
    return await apiPost("/api/ingest", {
      source,
      trusted: true,
      jobs,
      excludeBidTracking: settings.excludeBidTracking !== false,
    });
  } catch (err) {
    await bufferJobs(source, jobs);
    throw err;
  }
}

async function flushIngestBuffer() {
  const { ingestBuffer } = await chrome.storage.local.get("ingestBuffer");
  const list = Array.isArray(ingestBuffer) ? ingestBuffer : [];
  if (!list.length) {
    await refreshBufferCount();
    return { ok: true, flushed: 0 };
  }
  const remaining = [];
  let flushed = 0;
  const settings = await getSettings();
  for (const item of list) {
    try {
      await apiPost("/api/ingest", {
        source: item.source || "extension",
        trusted: true,
        jobs: item.jobs || [],
        excludeBidTracking: settings.excludeBidTracking !== false,
        skipSlack: true,
      });
      flushed += 1;
    } catch {
      remaining.push(item);
    }
  }
  await chrome.storage.local.set({ ingestBuffer: remaining });
  await refreshBufferCount();
  return { ok: true, flushed, remaining: remaining.length };
}

function waitForResume() {
  runState.paused = true;
  return new Promise((resolve) => {
    resumeResolver = resolve;
  });
}

function signalResume() {
  runState.paused = false;
  runState.needUser = null;
  if (resumeResolver) {
    const r = resumeResolver;
    resumeResolver = null;
    r();
  }
  if (activeTabId != null) {
    chrome.tabs
      .sendMessage(activeTabId, { type: Sf.MSG.SCRAPE_RESUME })
      .catch(() => {});
  }
}

function requestStop() {
  runState.stopRequested = true;
  if (activeTabId != null) {
    chrome.tabs
      .sendMessage(activeTabId, { type: Sf.MSG.SCRAPE_STOP })
      .catch(() => {});
  }
  signalResume();
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

async function ensureScripts(tabId, source) {
  const files = Sf.ADAPTER_FILES[source];
  if (!files?.length) throw new Error(`No adapter for ${source}`);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  } catch {
    /* may already be injected via content_scripts */
  }
}

function buildSearchUrl(source, query, page, recentDays) {
  const q = query || "Salesforce";
  if (source === "indeed") {
    const days = Math.max(1, Number(recentDays) || 7);
    const fromage = days <= 1 ? "1" : days <= 3 ? "3" : days <= 7 ? "7" : "14";
    const params = new URLSearchParams({
      q,
      l: "Remote",
      fromage,
      sort: "date",
    });
    if (page > 0) params.set("start", String(page * 10));
    return `https://www.indeed.com/jobs?${params.toString()}`;
  }
  if (source === "ziprecruiter") {
    return `https://www.ziprecruiter.com/Jobs/Remote-${encodeURIComponent(
      String(q).replace(/\s+/g, "-")
    )}`;
  }
  if (source === "monster") {
    const params = new URLSearchParams({
      q,
      where: "Remote",
      page: String(Math.max(1, page + 1)),
      so: "m.h.sh",
    });
    return `https://www.monster.com/jobs/search?${params.toString()}`;
  }
  if (source === "careerbuilder") {
    const days = Math.max(1, Number(recentDays) || 7);
    const posted = days <= 1 ? "1" : days <= 3 ? "3" : days <= 7 ? "7" : "30";
    const params = new URLSearchParams({
      keywords: q,
      location: "Remote",
      posted,
    });
    return `https://www.careerbuilder.com/jobs?${params.toString()}`;
  }
  if (source === "jobright") {
    const taxonomy = encodeURIComponent(
      JSON.stringify([{ taxonomyId: "00-00-00", title: q }])
    );
    const value = encodeURIComponent(q);
    return (
      `https://jobright.ai/jobs/search?visit=search&value=${value}` +
      `&searchType=job_title&country=US&jobTaxonomyList=${taxonomy}`
    );
  }
  return Sf.SOURCE_HOME[source] || "about:blank";
}

async function handleNeedUser(payload) {
  runState.needUser = {
    reason: payload?.reason || "blocked",
    url: payload?.url || "",
    source: runState.currentSource,
  };
  await setActionState(
    `Action needed: ${runState.needUser.reason}`,
    "!",
    "#c9851a"
  );
  await notify(
    "SF Job Capture — action needed",
    `${runState.currentSource}: ${runState.needUser.reason}`
  );
  await persistRunSnapshot();
  await waitForResume();
  if (runState.stopRequested) return false;
  runState.needUser = null;
  await setActionState("Resuming capture…", "…", "#5c5c5c");
  await persistRunSnapshot();
  return true;
}

async function scrapeCurrentPage(tabId, source, payload) {
  await ensureScripts(tabId, source);
  await sleep(400);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        type: Sf.MSG.SCRAPE_PAGE,
        source,
        ...payload,
      });
    } catch (err) {
      lastErr = err;
      await ensureScripts(tabId, source);
      await sleep(700 + attempt * 400);
    }
  }
  throw lastErr || new Error(`Could not reach ${source} content script`);
}

async function navigateAndWait(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId, 60000);
  await sleep(2800);
}

async function runJobright(settings) {
  const titles = settings.roleTitles;
  const url = buildSearchUrl("jobright", titles[0]);
  const tab = await chrome.tabs.create({
    url,
    active: false,
  });
  activeTabId = tab.id;
  try {
    await waitForTabComplete(tab.id, 45000);
    await sleep(3500);
    await ensureScripts(tab.id, "jobright");
    await sleep(600);

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (runState.stopRequested) {
        return { ok: false, stopped: true, kept: 0 };
      }
      try {
        await ensureScripts(tab.id, "jobright");
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: Sf.MSG.SCRAPE_JOBRIGHT_V3,
          titles,
        });
        if (
          result &&
          result.ok === false &&
          /HTTP 400/i.test(String(result.error || ""))
        ) {
          lastErr = new Error(result.error);
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
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
        if (!result?.ok) {
          if (/login|sign in|auth/i.test(String(result?.error || ""))) {
            const cont = await handleNeedUser({
              reason: "login",
              url,
            });
            if (!cont) return { ok: false, stopped: true, kept: 0 };
            continue;
          }
          throw new Error(result?.error || "JobRight scrape failed");
        }
        const jobs = result.jobs || [];
        try {
          await ingestJobs("jobright", jobs, settings);
        } catch (err) {
          console.warn("[jobright ingest]", err.message);
        }
        return {
          ok: true,
          kept: result.stats?.kept ?? jobs.length,
          stats: result.stats,
        };
      } catch (err) {
        lastErr = err;
        await sleep(800 + attempt * 500);
      }
    }
    throw lastErr || new Error("JobRight content script unreachable");
  } finally {
    if (settings.autoCloseTabs !== false && tab.id != null) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        /* ignore */
      }
    }
    activeTabId = null;
  }
}

async function runDomSource(source, settings) {
  const queries = settings.queries;
  const seen = new Set();
  let found = 0;
  let kept = 0;
  let skipped = 0;
  const firstUrl = buildSearchUrl(
    source,
    queries[0],
    0,
    settings.recentDays
  );
  const tab = await chrome.tabs.create({ url: firstUrl, active: false });
  activeTabId = tab.id;

  try {
    await waitForTabComplete(tab.id, 60000);
    await sleep(2500);

    for (let qi = 0; qi < queries.length; qi += 1) {
      if (runState.stopRequested) break;
      const q = queries[qi];
      // ZipRecruiter SEO search is one URL per query (no start= pagination).
      const maxPages =
        source === "ziprecruiter"
          ? 1
          : Math.max(1, settings.maxPagesPerQuery || 3);

      for (let p = 0; p < maxPages; p += 1) {
        if (runState.stopRequested) break;
        while (runState.paused && !runState.stopRequested) {
          await sleep(400);
        }
        if (runState.stopRequested) break;

        const pageUrl = buildSearchUrl(source, q, p, settings.recentDays);
        await navigateAndWait(tab.id, pageUrl);

        let result;
        try {
          result = await scrapeCurrentPage(tab.id, source, {
            query: q,
            queries: [q],
            recentDays: settings.recentDays,
            maxPages,
            page: p,
          });
        } catch (err) {
          console.warn(`[${source}] page scrape`, err.message);
          break;
        }

        if (result?.needUser) {
          const cont = await handleNeedUser(result.needUser);
          if (!cont) {
            return { ok: false, stopped: true, kept, found };
          }
          // Retry same page after user action
          p -= 1;
          continue;
        }

        if (!result?.ok) {
          if (result?.error) {
            console.warn(`[${source}] ${result.error}`);
          }
          break;
        }

        found += result.found || 0;
        skipped += result.skipped || 0;
        const fresh = [];
        for (const job of result.jobs || []) {
          const id = job?.id || job?.url;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          fresh.push(job);
        }
        if (fresh.length) {
          kept += fresh.length;
          try {
            await ingestJobs(source, fresh, settings);
          } catch (err) {
            console.warn(`[${source} ingest]`, err.message);
          }
        }

        runState.progress = {
          found,
          kept,
          page: p + 1,
          skipped,
        };
        await persistRunSnapshot();

        if (!(result.hasMore) && (result.found || 0) === 0) break;
        if (!(result.jobs || []).length && p > 0) break;
        if (!result.hasMore && p > 0) break;

        // ZipRecruiter SEO URLs don't paginate via start= — scroll/next is limited
        if (source === "ziprecruiter" && p >= 0 && !result.hasMore) break;
      }
    }

    return { ok: true, kept, found, stats: { skipped, unique: seen.size } };
  } catch (err) {
    return { ok: false, error: err.message, kept, found };
  } finally {
    if (settings.autoCloseTabs !== false && tab.id != null) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        /* ignore */
      }
    }
    activeTabId = null;
  }
}

async function captureSources(sources) {
  if (runState.running) {
    throw new Error("Capture already running");
  }
  const settings = await getSettings();
  const list = Sf.normalizeSources(
    sources?.length ? sources : settings.enabledSources
  );
  if (!list.length) throw new Error("No extension sources selected");

  runState = {
    ...emptyRunState(),
    running: true,
    sources: list,
    enabledSources: settings.enabledSources,
    dryRun: !!settings.dryRun,
  };
  await refreshBufferCount();
  await setActionState("Capturing…", "…", "#5c5c5c");
  await persistRunSnapshot();

  const results = {};
  let totalKept = 0;
  let anyOk = false;

  try {
    await flushIngestBuffer().catch(() => {});

    for (const source of list) {
      if (runState.stopRequested) break;
      runState.currentSource = source;
      runState.progress = { found: 0, kept: 0, page: 0, skipped: 0 };
      await persistRunSnapshot();

      try {
        const r =
          source === "jobright"
            ? await runJobright(settings)
            : await runDomSource(source, settings);
        results[source] = r;
        if (r?.ok) anyOk = true;
        totalKept += r?.kept || 0;
      } catch (err) {
        results[source] = { ok: false, error: err.message };
        console.error(`[${source}]`, err);
      }
    }
  } finally {
    runState.running = false;
    runState.paused = false;
    runState.currentSource = null;
    runState.needUser = null;
    runState.lastRun = {
      ok: anyOk,
      kept: totalKept,
      at: new Date().toISOString(),
      results,
      dryRun: !!settings.dryRun,
    };
    await chrome.storage.local.set({
      lastExtensionCapture: runState.lastRun,
      lastExtensionError: anyOk
        ? null
        : {
            at: runState.lastRun.at,
            error: "One or more sources failed — check service worker logs",
            results,
          },
    });
    await refreshBufferCount();
    await persistRunSnapshot();
    await setActionState(
      anyOk
        ? `Last capture OK — kept ${totalKept}`
        : "Last capture failed — check logs; keep npm start running",
      anyOk ? "OK" : "!",
      anyOk ? "#0b6e4f" : "#b42318"
    );
  }

  return results;
}

function nextRunMs(from, runHours) {
  const hours = (runHours || [5, 17]).slice().sort((a, b) => a - b);
  const now = from.getTime();
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of hours) {
      const d = new Date(from);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hour, 0, 0, 0);
      if (d.getTime() > now + 60_000) return d.getTime();
    }
  }
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(hours[0] || 5, 0, 0, 0);
  return fallback.getTime();
}

async function ensureAlarm() {
  for (const name of LEGACY_ALARMS) {
    await chrome.alarms.clear(name);
  }
  const settings = await getSettings();
  if (settings.scheduleEnabled === false) {
    await chrome.alarms.clear(ALARM);
  } else {
    const when = nextRunMs(new Date(), settings.runHours);
    const existing = await chrome.alarms.get(ALARM);
    if (!existing || Math.abs((existing.scheduledTime || 0) - when) > 60_000) {
      await chrome.alarms.clear(ALARM);
      chrome.alarms.create(ALARM, { when });
    }
  }
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(BUFFER_ALARM, { periodInMinutes: 5 });
}

function scheduleNextAlarm() {
  getSettings().then((settings) => {
    if (settings.scheduleEnabled === false) return;
    chrome.alarms.create(ALARM, {
      when: nextRunMs(new Date(), settings.runHours),
    });
  });
}

async function pollQueuedCapture() {
  let data;
  try {
    data = await apiFetch("/api/extension/poll");
  } catch {
    return;
  }
  if (!data?.run) return;
  const sources = Sf.normalizeSources(data.sources);
  await captureSources(sources.length ? sources : undefined).catch((err) =>
    console.error("[poll capture]", err)
  );
}

async function publicState() {
  const settings = await getSettings();
  await refreshBufferCount();
  return {
    ...runState,
    enabledSources: settings.enabledSources,
    bufferCount: runState.bufferCount,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) return;

  if (msg.type === Sf.MSG.GET_STATE) {
    publicState().then(sendResponse);
    return true;
  }
  if (msg.type === Sf.MSG.RUN_CAPTURE) {
    captureSources(msg.sources)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === Sf.MSG.STOP_CAPTURE) {
    requestStop();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === Sf.MSG.RESUME_CAPTURE) {
    signalResume();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === Sf.MSG.OPEN_NEED_USER_URL) {
    const url =
      runState.needUser?.url ||
      Sf.SOURCE_HOME[runState.currentSource] ||
      Sf.SOURCE_HOME.indeed;
    chrome.tabs.create({ url, active: true });
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === Sf.MSG.FLUSH_BUFFER) {
    flushIngestBuffer()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "SETTINGS_UPDATED") {
    ensureAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollQueuedCapture().catch((err) => console.error("[poll]", err));
    return;
  }
  if (alarm.name === BUFFER_ALARM) {
    flushIngestBuffer().catch(() => {});
    return;
  }
  if (alarm.name !== ALARM) return;
  getSettings()
    .then((s) => captureSources(s.enabledSources))
    .catch((err) => console.error("[scheduled capture]", err))
    .finally(() => scheduleNextAlarm());
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

ensureAlarm();
refreshBufferCount();

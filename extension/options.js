(function () {
  const Sf = globalThis.SfCapture;
  const D = Sf.DEFAULT_SETTINGS;

  function listFromText(text) {
    return String(text || "")
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function paint(settings) {
    document.getElementById("queries").value = (settings.queries || []).join(
      "\n"
    );
    document.getElementById("roleTitles").value = (
      settings.roleTitles || []
    ).join("\n");
    document.getElementById("maxPages").value = String(
      settings.maxPagesPerQuery ?? D.maxPagesPerQuery
    );
    document.getElementById("recentDays").value = String(
      settings.recentDays ?? D.recentDays
    );
    document.getElementById("runHours").value = (
      settings.runHours || D.runHours
    ).join(",");
    document.getElementById("scheduleEnabled").checked =
      settings.scheduleEnabled !== false;
    document.getElementById("autoCloseTabs").checked =
      settings.autoCloseTabs !== false;
    document.getElementById("dryRun").checked = !!settings.dryRun;
    document.getElementById("excludeBidTracking").checked =
      settings.excludeBidTracking !== false;
  }

  async function load() {
    const stored = await chrome.storage.local.get(null);
    paint({ ...D, ...stored });
  }

  async function save() {
    const runHours = listFromText(document.getElementById("runHours").value)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23);
    const payload = {
      queries: listFromText(document.getElementById("queries").value),
      roleTitles: listFromText(document.getElementById("roleTitles").value),
      maxPagesPerQuery: Math.max(
        1,
        Math.min(12, Number(document.getElementById("maxPages").value) || 3)
      ),
      recentDays: Math.max(
        1,
        Math.min(30, Number(document.getElementById("recentDays").value) || 7)
      ),
      runHours: runHours.length ? runHours : D.runHours.slice(),
      scheduleEnabled: document.getElementById("scheduleEnabled").checked,
      autoCloseTabs: document.getElementById("autoCloseTabs").checked,
      dryRun: document.getElementById("dryRun").checked,
      excludeBidTracking: document.getElementById("excludeBidTracking").checked,
    };
    await chrome.storage.local.set(payload);
    const el = document.getElementById("saved");
    el.style.display = "block";
    setTimeout(() => {
      el.style.display = "none";
    }, 1500);
    chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" }).catch(() => {});
  }

  document.getElementById("btnSave").addEventListener("click", save);
  document.getElementById("btnReset").addEventListener("click", async () => {
    paint(D);
    await chrome.storage.local.set(D);
    document.getElementById("saved").style.display = "block";
  });

  load();
})();

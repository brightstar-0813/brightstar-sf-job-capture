(function () {
  const Sf = globalThis.SfCapture;
  const sourcesEl = document.getElementById("sources");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const btnResume = document.getElementById("btnResume");
  const btnOpen = document.getElementById("btnOpen");
  const btnFlush = document.getElementById("btnFlush");

  const LABELS = {
    indeed: "Indeed",
    ziprecruiter: "ZipRecruiter",
    monster: "Monster",
    careerbuilder: "CareerBuilder",
    jobright: "JobRight",
  };

  function renderSources(enabled) {
    const set = new Set(enabled || []);
    sourcesEl.innerHTML = "";
    for (const id of Sf.EXT_SOURCES) {
      const label = document.createElement("label");
      label.className = "source";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = id;
      cb.checked = set.has(id);
      cb.addEventListener("change", persistSources);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(LABELS[id] || id));
      sourcesEl.appendChild(label);
    }
  }

  function selectedSources() {
    return [...sourcesEl.querySelectorAll("input[type=checkbox]:checked")].map(
      (el) => el.value
    );
  }

  async function persistSources() {
    const enabledSources = selectedSources();
    await chrome.storage.local.set({ enabledSources });
  }

  function paint(state) {
    const running = !!state?.running;
    const needUser = state?.needUser || null;
    document.getElementById("stState").textContent = needUser
      ? `paused (${needUser.reason})`
      : running
        ? state.paused
          ? "paused"
          : "running"
        : "idle";
    document.getElementById("stSource").textContent =
      state?.currentSource || "—";
    const p = state?.progress || {};
    document.getElementById("stProgress").textContent = state?.currentSource
      ? `found ${p.found ?? 0} · kept ${p.kept ?? 0} · page ${p.page ?? "—"}`
      : "—";
    const last = state?.lastRun;
    document.getElementById("stLast").textContent = last
      ? `${last.ok ? "OK" : "fail"} · kept ${last.kept ?? 0} · ${last.at || ""}`
      : "—";
    document.getElementById("stBuffer").textContent = String(
      state?.bufferCount ?? 0
    );

    const box = document.getElementById("needUser");
    if (needUser) {
      box.classList.add("visible");
      document.getElementById("needReason").textContent =
        `${needUser.reason}${needUser.url ? ` — ${needUser.url}` : ""}`;
    } else {
      box.classList.remove("visible");
    }

    btnStart.disabled = running;
    btnStop.disabled = !running;
    btnResume.disabled = !(running && (state.paused || needUser));
    btnOpen.disabled = !needUser?.url;
    renderSources(state?.enabledSources || Sf.DEFAULT_SETTINGS.enabledSources);
  }

  async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: Sf.MSG.GET_STATE });
    paint(state || {});
  }

  btnStart.addEventListener("click", async () => {
    await persistSources();
    await chrome.runtime.sendMessage({
      type: Sf.MSG.RUN_CAPTURE,
      sources: selectedSources(),
    });
    await refresh();
  });

  btnStop.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: Sf.MSG.STOP_CAPTURE });
    await refresh();
  });

  btnResume.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: Sf.MSG.RESUME_CAPTURE });
    await refresh();
  });

  btnOpen.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: Sf.MSG.OPEN_NEED_USER_URL });
  });

  btnFlush.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: Sf.MSG.FLUSH_BUFFER });
    await refresh();
  });

  chrome.storage.onChanged.addListener(() => refresh());
  refresh();
  setInterval(refresh, 1500);
})();

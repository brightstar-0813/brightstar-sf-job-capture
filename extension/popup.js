const API = "http://127.0.0.1:3847";

const statusLine = document.getElementById("statusLine");
const jrLine = document.getElementById("jrLine");
const jobList = document.getElementById("jobList");
const messageEl = document.getElementById("message");
const btnRunDice = document.getElementById("btnRunDice");
const btnRunJr = document.getElementById("btnRunJr");
const btnRefresh = document.getElementById("btnRefresh");
const btnExport = document.getElementById("btnExport");

btnExport.href = `${API}/api/export.csv`;

function showMessage(text, isError = false) {
  messageEl.hidden = !text;
  messageEl.textContent = text || "";
  messageEl.style.borderColor = isError ? "#b42318" : "var(--line)";
}

async function api(path, options) {
  const res = await fetch(`${API}${path}`, options);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json")
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const err =
      (data && data.error) ||
      (typeof data === "string" ? data : `HTTP ${res.status}`);
    throw new Error(err);
  }
  return data;
}

function formatStatus(s) {
  if (!s) return "No status";
  const last = s.lastRun;
  const when = last?.finished_at || last?.started_at || "never";
  const counts = last
    ? `new ${last.new_count ?? 0} · updated ${last.updated_count ?? 0}`
    : "no runs yet";
  const cap = s.capturing ? " · capturing…" : "";
  return `Total ${s.totalJobs ?? 0} · API last: ${when} (${counts})${cap}`;
}

function renderJobs(jobs) {
  jobList.innerHTML = "";
  if (!jobs.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No new jobs yet. Run a capture.";
    jobList.appendChild(empty);
    return;
  }

  for (const job of jobs) {
    const li = document.createElement("li");
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = job.title || "(no title)";
    const company = document.createElement("p");
    company.className = "company";
    const src = job.source ? `[${job.source}] ` : "";
    company.textContent = `${src}${job.organization || ""}`;
    const row = document.createElement("div");
    row.className = "row";

    if (job.url) {
      const open = document.createElement("a");
      open.href = job.url;
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "Open";
      row.appendChild(open);
    }

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "linkish";
    copy.textContent = "Copy link";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(job.url || "");
        showMessage("Link copied");
      } catch {
        showMessage("Could not copy", true);
      }
    });
    row.appendChild(copy);

    li.appendChild(title);
    li.appendChild(company);
    li.appendChild(row);
    jobList.appendChild(li);
  }
}

async function refreshJrStatus() {
  try {
    const data = await chrome.runtime.sendMessage({ type: "GET_JOBRIGHT_STATUS" });
    const last = data?.lastJobrightCapture;
    const err = data?.lastJobrightError;
    if (last?.at) {
      const kept = last.stats?.kept ?? last.ingest?.newCount ?? "?";
      jrLine.textContent = `JobRight ext last: ${last.at} · kept ${kept}`;
    } else if (err?.at) {
      jrLine.textContent = `JobRight ext error: ${err.error}`;
    } else {
      jrLine.textContent =
        "JobRight ext: no capture yet (runs daily at 5 AM and 5 PM while Chrome is open)";
    }
  } catch {
    jrLine.textContent = "";
  }
}

async function refresh() {
  showMessage("");
  try {
    const status = await api("/api/status");
    statusLine.textContent = formatStatus(status);
    btnRunDice.disabled = !!status.capturing;
    const { jobs } = await api("/api/jobs?status=new&limit=50");
    renderJobs(jobs || []);
  } catch (err) {
    statusLine.textContent = "API offline — run npm start";
    jobList.innerHTML = "";
    showMessage(err.message || "Cannot reach local API", true);
  }
  await refreshJrStatus();
}

btnRefresh.addEventListener("click", () => refresh());

btnRunDice.addEventListener("click", async () => {
  showMessage("");
  btnRunDice.disabled = true;
  try {
    await api("/api/run", { method: "POST" });
    showMessage("Capture started — refresh in a minute");
    setTimeout(refresh, 3000);
  } catch (err) {
    showMessage(err.message || "Run failed", true);
    btnRunDice.disabled = false;
  }
});

btnRunJr.addEventListener("click", async () => {
  showMessage("");
  btnRunJr.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "CAPTURE_JOBRIGHT_NOW",
    });
    if (!result?.ok) {
      throw new Error(result?.error || "JobRight capture failed");
    }
    const kept = result.stats?.kept ?? 0;
    const neu = result.ingest?.newCount ?? 0;
    showMessage(`JobRight: kept ${kept} · ${neu} new`);
    await refresh();
  } catch (err) {
    showMessage(err.message || "JobRight capture failed", true);
  } finally {
    btnRunJr.disabled = false;
  }
});

refresh();

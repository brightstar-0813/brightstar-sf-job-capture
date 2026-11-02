/**
 * Run JobSpy's salesforce_jobs scrape as a feeder for sf-job-capture.
 * Writes a resolved config under download/jobspy/, spawns the sibling
 * Python package, then maps jobs.json into Node job objects.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { mapJobspyRows } from "./map.js";
import {
  JOBSPY_DEFAULT_SITES,
  JOBSPY_FULL_SITES,
  JOBSPY_SEED_EMPLOYERS,
} from "./sites.js";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pythonCandidates() {
  const out = [];
  if (config.jobspyPython) out.push(config.jobspyPython);
  out.push(
    path.join(config.root, ".venv-jobspy", "Scripts", "python.exe"),
    path.join(config.root, ".venv-jobspy", "bin", "python"),
    path.join(config.jobspyRoot, ".venv", "Scripts", "python.exe"),
    path.join(config.jobspyRoot, ".venv", "bin", "python"),
    process.platform === "win32" ? "python" : "python3"
  );
  return [...new Set(out.filter(Boolean))];
}

function buildPythonPath() {
  const parts = [
    config.jobspyRoot,
    config.jobspyPythonPath,
    process.env.PYTHONPATH || "",
  ].filter(Boolean);
  return [...new Set(parts)].join(path.delimiter);
}

function resolvePython() {
  for (const candidate of pythonCandidates()) {
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (!fileExists(candidate)) continue;
    }
    return candidate;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function hoursOld() {
  if (config.jobspyHoursOld > 0) return config.jobspyHoursOld;
  return Math.max(24, Number(config.recentDays || 3) * 24);
}

function selectedSites() {
  if (config.jobspySites.length) return config.jobspySites;
  return config.jobspyFull ? JOBSPY_FULL_SITES : JOBSPY_DEFAULT_SITES;
}

function buildFeederConfig(workDir) {
  const sites = selectedSites();
  return {
    search_terms: ["Salesforce", "SFDC"],
    search_profile: "role_families",
    role_families: [
      "admin",
      "developer",
      "architect",
      "consulting",
      "business",
      "clouds",
      "quality",
      "ecosystem",
    ],
    sites,
    results_per_source: config.jobspyResultsPerSource,
    hours_old: hoursOld(),
    require_posted_date: true,
    fetch_description: true,
    include_description_matches: true,
    include_adjacent_ecosystem: true,
    exclude_title_patterns: [
      "\\bAccount Executive\\b",
      "\\bSales Development Representative\\b",
      "\\bAccount Manager\\b",
      "\\bSales Representative\\b",
    ],
    max_pages: config.jobspyMaxPages,
    max_requests_per_source: config.jobspyMaxRequestsPerSource,
    request_delay_seconds: 0.4,
    cache_hours: 6,
    site_search_terms: {
      himalayas: [
        "Salesforce Administrator",
        "Salesforce Developer",
        "Salesforce Architect",
        "Salesforce Consultant",
        "Salesforce Business Analyst",
        "MuleSoft",
        "Agentforce",
        "nCino",
        "Veeva Developer",
      ],
      we_work_remotely: ["Salesforce", "SFDC", "MuleSoft", "Agentforce"],
      wellfound: ["Salesforce", "MuleSoft", "Agentforce"],
      no_desk: ["Salesforce", "MuleSoft"],
      employer_ats: [
        "Salesforce Developer",
        "Salesforce Administrator",
        "MuleSoft",
        "Agentforce",
        "nCino",
        "Veeva Developer",
      ],
    },
    database: "salesforce_jobs.sqlite3",
    output_dir: "output",
    browser_profiles: "browser_profiles",
    browser_channel: config.jobspyBrowserChannel,
    headless_browser: true,
    browser_sites: [],
    employers: JOBSPY_SEED_EMPLOYERS,
    company_registry: "employers.json",
    all_active: false,
    _meta: {
      work_dir: workDir,
      generated_at: new Date().toISOString(),
      sites,
    },
  };
}

function readJobsJson(outputDir) {
  const jsonPath = path.join(outputDir, "jobs.json");
  if (!fileExists(jsonPath)) {
    const csvPath = path.join(outputDir, "jobs.csv");
    if (fileExists(csvPath)) {
      console.warn(
        `[jobspy] jobs.json missing; found jobs.csv at ${csvPath} (JSON required)`
      );
    }
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.jobs)) return raw.jobs;
  return [];
}

function runProcess(python, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(python, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: buildPythonPath(),
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        code: null,
        signal: "TIMEOUT",
        stdout,
        stderr: `${stderr}\n[jobspy] timed out after ${timeoutMs}ms`.trim(),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-3)) {
        console.log(`[jobspy] ${line}`);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-2)) {
        console.warn(`[jobspy:err] ${line}`);
      }
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout, stderr: err.message });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

/**
 * @returns {Promise<{ jobs: object[], ok: boolean, skipped?: boolean, error?: string, sites?: string[], rawCount?: number }>}
 */
export async function searchJobspyJobs() {
  if (!config.captureJobspy) {
    return { jobs: [], ok: true, skipped: true };
  }

  const root = config.jobspyRoot;
  const moduleMarker = path.join(root, "salesforce_jobs", "__main__.py");
  if (!fileExists(moduleMarker)) {
    const error = `JobSpy root missing salesforce_jobs package: ${root}`;
    console.warn(`[jobspy] ${error}`);
    return { jobs: [], ok: false, error };
  }

  const workDir = config.jobspyWorkDir;
  const outputDir = path.join(workDir, "output");
  ensureDir(workDir);
  ensureDir(outputDir);

  const feeder = buildFeederConfig(workDir);
  const configPath = path.join(workDir, "feeder.config.json");
  // Strip Node-only metadata before writing JobSpy config (extra=forbid).
  const { _meta, ...jobspyConfig } = feeder;
  fs.writeFileSync(configPath, JSON.stringify(jobspyConfig, null, 2));
  fs.writeFileSync(
    path.join(workDir, "feeder.meta.json"),
    JSON.stringify(_meta, null, 2)
  );

  const python = resolvePython();
  const args = [
    "-m",
    "salesforce_jobs",
    "scrape",
    "--config",
    configPath,
    "--output-dir",
    outputDir,
  ];

  console.log(
    `[jobspy] starting scrape python=${python} sites=${feeder.sites.length} hours_old=${feeder.hours_old}`
  );

  const result = await runProcess(python, args, {
    cwd: root,
    timeoutMs: config.jobspyTimeoutMs,
  });

  if (result.signal === "TIMEOUT") {
    console.warn(`[jobspy] ${result.stderr}`);
    // Still try to ingest whatever export exists.
  } else if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim();
    console.warn(`[jobspy] scrape failed: ${detail.slice(-500)}`);
  }

  const raw = readJobsJson(outputDir);
  const jobs = mapJobspyRows(raw);
  console.log(
    `[jobspy] mapped ${jobs.length}/${raw.length} jobs` +
      (result.code === 0 ? "" : " (partial/failed scrape)")
  );

  return {
    jobs,
    ok: result.code === 0,
    error:
      result.code === 0
        ? undefined
        : (result.stderr || result.stdout || `exit ${result.code}`).slice(-500),
    sites: feeder.sites,
    rawCount: raw.length,
  };
}

export function jobspyCoversSite(site) {
  if (!config.captureJobspy) return false;
  const sites = selectedSites();
  return sites.includes(site);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("jobspy/search.js") ||
    process.argv[1].replace(/\\/g, "/").endsWith("/jobspy/search.js"));

if (isMain) {
  searchJobspyJobs()
    .then((result) => {
      console.log(
        `[jobspy] standalone done ok=${result.ok} jobs=${result.jobs?.length || 0}`
      );
      process.exit(result.ok || (result.jobs?.length || 0) > 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

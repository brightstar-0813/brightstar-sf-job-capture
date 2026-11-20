/**
 * SimplyHired — remote Salesforce jobs via the Python curl_cffi helper
 * (`scripts/simplyhired_fetch.py`). Node fetch and Playwright are blocked by
 * Cloudflare; the Safari-iOS TLS impersonation in curl_cffi is not.
 * Requires PYTHON_BIN with curl_cffi (`npm run py:setup`).
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { config } from "../config.js";
import {
  emptySkipCounts,
  isoDate,
  keepFeedJob,
  logKept,
} from "../feeds/keep.js";

const SCRIPT = path.join(config.root, "scripts", "simplyhired_fetch.py");

function runHelper(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      config.pythonBin,
      [SCRIPT, ...args],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        let payload = null;
        try {
          payload = stdout ? JSON.parse(stdout) : null;
        } catch {
          payload = null;
        }
        resolve({ err, payload, stderr: String(stderr || "") });
      }
    );
  });
}

function parseSalary(text) {
  const s = String(text || "");
  const nums = [...s.matchAll(/\$\s*([\d,.]+)\s*(k)?/gi)].map((m) => {
    const n = Number(m[1].replace(/,/g, ""));
    return Math.round(m[2] ? n * 1000 : n);
  });
  const unit = /hour/i.test(s)
    ? "HOUR"
    : /month/i.test(s)
      ? "MONTH"
      : /week/i.test(s)
        ? "WEEK"
        : /day/i.test(s)
          ? "DAY"
          : nums.length
            ? "YEAR"
            : "";
  return {
    min: nums[0] != null ? String(nums[0]) : "",
    max: nums[1] != null ? String(nums[1]) : "",
    unit,
  };
}

function mapJob(j) {
  const salary = parseSalary(j.salaryInfo);
  const remote =
    /remote/i.test(j.location || "") ||
    (Array.isArray(j.remoteAttributes) && j.remoteAttributes.length > 0);
  const skills = Array.isArray(j.uncategorized) ? j.uncategorized : [];
  const reqs = Array.isArray(j.requirements) ? j.requirements : [];
  const description = [
    String(j.snippet || "").trim(),
    reqs.length ? `Requirements:\n- ${reqs.join("\n- ")}` : "",
    skills.length ? `Skills:\n- ${skills.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    id: `simplyhired_${j.jobKey}`,
    title: j.title || "",
    organization: j.company || "",
    location: j.location || "",
    work_arrangement: remote ? "Remote" : "Onsite",
    remote_restricted_to: "",
    experience_level: "",
    employment_type: Array.isArray(j.jobTypes) ? j.jobTypes.join(", ") : "",
    salary_min: salary.min,
    salary_max: salary.max,
    salary_currency: "USD",
    salary_unit: salary.unit,
    key_skills: skills.slice(0, 15).join(", "),
    source: "simplyhired",
    date_posted: j.dateOnIndeed ? isoDate(j.dateOnIndeed) : "",
    url: `https://www.simplyhired.com/job/${encodeURIComponent(j.jobKey)}`,
    description,
  };
}

/** @returns {Promise<{ jobs: object[], status: string, note: string }>} */
export async function searchSimplyhiredJobs() {
  if (!fs.existsSync(config.pythonBin) && /[\\/]/.test(config.pythonBin)) {
    const note = `PYTHON_BIN not found (${config.pythonBin}) — run: npm run py:setup`;
    console.warn(`[simplyhired] ${note}`);
    return { jobs: [], status: "error", note };
  }

  const queries = config.simplyhiredQueries;
  const args = [
    "--queries",
    queries.join(","),
    "--pages",
    String(config.simplyhiredPages),
    "--days",
    String(config.recentDays),
  ];
  console.log(
    `[simplyhired] python helper: ${queries.length} queries × ${config.simplyhiredPages} pages`
  );
  const timeoutMs = Math.max(120000, queries.length * config.simplyhiredPages * 15000);
  const { err, payload, stderr } = await runHelper(args, timeoutMs);

  if (!payload) {
    const note =
      (err?.killed ? "helper timed out" : err?.message || "no output") +
      (stderr ? ` | ${stderr.trim().split("\n").pop()}` : "");
    console.warn(`[simplyhired] ${note}`);
    return { jobs: [], status: "error", note };
  }
  if (payload.errors?.length) {
    console.warn(`[simplyhired] helper errors: ${payload.errors.slice(0, 3).join(" | ")}`);
  }

  const seen = new Set();
  const kept = [];
  const counts = emptySkipCounts();
  let scanned = 0;
  for (const raw of payload.jobs || []) {
    if (!raw?.jobKey || seen.has(raw.jobKey)) continue;
    seen.add(raw.jobKey);
    scanned += 1;
    const job = mapJob(raw);
    if (keepFeedJob(job, counts)) kept.push(job);
  }
  logKept("simplyhired", kept.length, scanned, counts);

  let status = kept.length ? "ok" : "empty";
  let note = "";
  if (payload.blocked) {
    status = "blocked";
    note = "Cloudflare blocked every request";
  } else if (/curl_cffi not installed/.test((payload.errors || []).join(" "))) {
    status = "error";
    note = "curl_cffi not installed — run: npm run py:setup";
  }
  return { jobs: kept, status, note };
}

/**
 * Install JobSpy Python deps into download/jobspy-py (no venv required).
 * Used when the sibling JobSpy .venv points at a missing interpreter.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "download", "jobspy-py");
const jobspyRoot = path.resolve(root, process.env.JOBSPY_ROOT || "../JobSpy/JobSpy");

fs.mkdirSync(target, { recursive: true });

const python = process.env.JOBSPY_PYTHON || "python";
const packages = [
  "pydantic>=2.3.0",
  "pandas>=2.1.2",
  "beautifulsoup4>=4.12.2",
  "requests>=2.31.0",
  "curl_cffi>=0.16.2",
  "markdownify>=1.1.0",
  "playwright>=1.51.0",
];

console.log(`[jobspy:deps] target=${target}`);
console.log(`[jobspy:deps] jobspyRoot=${jobspyRoot}`);

const child = spawn(
  python,
  ["-m", "pip", "install", "--target", target, ...packages],
  { stdio: "inherit", windowsHide: true }
);

child.on("close", (code) => {
  if (code !== 0) {
    console.error(`[jobspy:deps] pip failed with exit ${code}`);
    process.exit(code || 1);
  }
  console.log("[jobspy:deps] done — CAPTURE_JOBSPY can use PYTHONPATH=download/jobspy-py");
  process.exit(0);
});

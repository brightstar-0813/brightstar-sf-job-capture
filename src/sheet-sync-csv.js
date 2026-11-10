/**
 * Sync jobs from a local CSV to the US-SF-Jobs warehouse tab.
 *
 * Usage:
 *   npm run sheet:sync
 *   npm run sheet:sync -- --limit 20
 *   npm run sheet:sync -- --replace
 *   npm run sheet:sync -- --csv download/01_builtin_jobs_latest.csv --limit 10
 *
 * --replace clears the tab, writes Role|Company|Link|JD|Salary, then appends.
 * Requires redeployed apps-script/Code.gs (appendWarehouse + replaceWarehouse).
 */

import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { readCsvFile } from "./csv.js";
import { appendJobsToSheet, resetWarehouseSheet } from "./sheet-append.js";

function parseArgs(argv) {
  const out = { limit: 0, csv: "", help: false, replace: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--replace" || a === "--reorganize") out.replace = true;
    else if (a === "--limit" || a === "-n") {
      out.limit = Math.max(0, Number(argv[i + 1] || 0));
      i += 1;
    } else if (a === "--csv") {
      out.csv = String(argv[i + 1] || "").trim();
      i += 1;
    } else if (!a.startsWith("-") && !out.csv) {
      out.csv = a;
    }
  }
  return out;
}

function resolveCsvPath(raw) {
  if (!raw) return config.csvLatestPath;
  if (path.isAbsolute(raw)) return raw;
  const fromCwd = path.resolve(raw);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(config.root, raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node src/sheet-sync-csv.js [--csv path] [--limit N] [--replace]

Appends (or replaces) warehouse rows on JOBS_SHEET_NAME via Apps Script.

  --replace   Clear tab + headers Role|Company|Link|JD|Salary, then append
  --limit N   Only first N CSV rows
  --csv path  Default: ${config.csvLatestPath}
`);
    return;
  }

  const csvPath = resolveCsvPath(args.csv);
  if (!fs.existsSync(csvPath)) {
    console.error(`[sheet-sync] CSV not found: ${csvPath}`);
    process.exit(1);
  }

  let rows = readCsvFile(csvPath);
  console.log(`[sheet-sync] csv=${csvPath} rows=${rows.length}`);
  if (args.limit > 0) {
    rows = rows.slice(0, args.limit);
    console.log(`[sheet-sync] limiting to ${rows.length}`);
  }

  if (args.replace) {
    console.log(`[sheet-sync] resetting warehouse tab ${config.jobsSheetName}…`);
    const reset = await resetWarehouseSheet();
    if (!reset.ok) {
      console.error(`[sheet-sync] reset failed: ${reset.error}`);
      console.error(
        "[sheet-sync] Redeploy apps-script/Code.gs (New version) so replaceWarehouse / appendWarehouse are live."
      );
      process.exit(1);
    }
    console.log(
      `[sheet-sync] headers=${(reset.headers || []).join(" | ")} on ${reset.sheetName}`
    );
  }

  const result = await appendJobsToSheet(rows, { force: true });
  console.log(
    `[sheet-sync] ${result.sheetName}: appended=${result.appended} duplicate=${result.duplicate} failed=${result.failed} total=${result.total}`
  );
  if (result.error) {
    console.warn(`[sheet-sync] ${result.error}`);
    if (/unknown action/i.test(result.error)) {
      console.error(
        "[sheet-sync] Redeploy apps-script/Code.gs (New version) so appendWarehouse is live."
      );
    }
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Experiment helper: append jobs from a local CSV to the configured sheet tab.
 *
 * Usage:
 *   npm run sheet:sync
 *   npm run sheet:sync -- --limit 20
 *   npm run sheet:sync -- --csv download/01_builtin_jobs_latest.csv
 */

import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { readCsvFile } from "./csv.js";
import { appendJobsToSheet } from "./sheet-append.js";

function parseArgs(argv) {
  const out = { limit: 0, csv: "", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
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
    console.log(`Usage: node src/sheet-sync-csv.js [--csv path] [--limit N]

Appends rows from a local capture CSV to JOBS_SHEET_NAME via the Apps Script
web app. Duplicates (same link) are skipped.

Defaults:
  --csv   ${config.csvLatestPath}
  --limit 0 (all rows)
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

  const result = await appendJobsToSheet(rows, { force: true });
  console.log(
    `[sheet-sync] ${result.sheetName}: appended=${result.appended} duplicate=${result.duplicate} failed=${result.failed} total=${result.total}`
  );
  if (result.error) console.warn(`[sheet-sync] ${result.error}`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

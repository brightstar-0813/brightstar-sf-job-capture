import fs from "fs";
import { CSV_HEADERS } from "./config.js";

/** Escape a CSV field (RFC 4180). */
export function escapeCsvField(value) {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowToCsvLine(row) {
  return CSV_HEADERS.map((h) => escapeCsvField(row[h] ?? "")).join(",");
}

export function ensureCsvHeader(csvPath) {
  if (!fs.existsSync(csvPath)) {
    fs.mkdirSync(pathDir(csvPath), { recursive: true });
    fs.writeFileSync(csvPath, `${CSV_HEADERS.join(",")}\n`, "utf8");
    return;
  }
  const existing = fs.readFileSync(csvPath, "utf8");
  if (!existing.trim()) {
    fs.writeFileSync(csvPath, `${CSV_HEADERS.join(",")}\n`, "utf8");
  }
}

function pathDir(filePath) {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx >= 0 ? filePath.slice(0, idx) : ".";
}

/**
 * Rewrite entire CSV from job rows (keeps one row per id).
 * @param {string} csvPath
 * @param {Record<string, string|number>[]} rows
 */
export function writeCsv(csvPath, rows) {
  ensureCsvHeader(csvPath);
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(rowToCsvLine(row));
  }
  fs.writeFileSync(csvPath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * Parse CSV text into objects keyed by header.
 * Handles quoted fields and embedded newlines.
 */
export function parseCsv(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      if (ch === "\r") i += 1;
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => c !== "")) rows.push(row);
  }

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => String(h || "").trim());
  const objects = rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    return obj;
  });
  return { headers, rows: objects };
}

export function readCsvFile(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, "utf8");
  return parseCsv(text).rows;
}

import path from "path";

/** Local stamp: YYYY-MM-DD_HHmmss */
export function formatStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function timestampedCsvFilename(prefix = "sf_jobs", date = new Date()) {
  return `${prefix}_${formatStamp(date)}.csv`;
}

export function resolveTimestampedCsvPath(
  dataDir,
  prefix = "sf_jobs",
  date = new Date()
) {
  return path.join(dataDir, timestampedCsvFilename(prefix, date));
}

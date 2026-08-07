import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const dataDir = path.resolve(root, process.env.DATA_DIR || "download");

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return String(raw).toLowerCase() !== "false";
}

export const config = {
  root,
  dataDir,
  /** Fixed “latest” copies per source */
  csvLatestDice: process.env.CSV_LATEST_DICE || "dice_jobs_latest.csv",
  csvLatestJobright: process.env.CSV_LATEST_JOBRIGHT || "jobright_jobs_latest.csv",
  csvPrefixDice: process.env.CSV_PREFIX_DICE || "dice_sf_jobs",
  csvPrefixJobright: process.env.CSV_PREFIX_JOBRIGHT || "jobright_sf_jobs",
  /** @deprecated combined latest — prefer per-source */
  csvLatestPath: path.join(
    dataDir,
    process.env.CSV_LATEST_FILE || "dice_jobs_latest.csv"
  ),
  csvPrefix: process.env.CSV_PREFIX_DICE || "dice_sf_jobs",
  storePath: path.join(dataDir, process.env.STORE_FILE || "store.json"),
  dbPath: path.join(dataDir, process.env.STORE_FILE || "store.json"),
  slackWebhookUrl: String(process.env.SLACK_WEBHOOK_URL || "").trim(),
  port: Number(process.env.PORT || 3847),
  searchQ: process.env.SEARCH_Q || "Salesforce",
  maxPages: Math.max(1, Number(process.env.MAX_PAGES || 5)),
  pageSize: Math.max(1, Math.min(100, Number(process.env.PAGE_SIZE || 20))),
  headless: bool("HEADLESS", true),
  delayMs: Math.max(0, Number(process.env.DELAY_MS || 800)),
  cronSchedule: process.env.CRON_SCHEDULE || "0 */8 * * *",
  apiBase: `http://127.0.0.1:${Number(process.env.PORT || 3847)}`,
  captureDice: bool("CAPTURE_DICE", true),
  captureJobright: bool("CAPTURE_JOBRIGHT", true),
  jobrightAuthPath: path.resolve(
    root,
    process.env.JOBRIGHT_AUTH_PATH || path.join("download", "jobright-auth.json")
  ),
  jobrightMaxPages: Math.max(1, Number(process.env.JOBRIGHT_MAX_PAGES || process.env.MAX_PAGES || 5)),
};

export const CSV_HEADERS = [
  "id",
  "title",
  "organization",
  "location",
  "work_arrangement",
  "remote_restricted_to",
  "experience_level",
  "employment_type",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_unit",
  "key_skills",
  "source",
  "date_posted",
  "url",
  "description",
  "first_seen_run_id",
  "last_seen_run_id",
  "first_seen_at",
  "last_seen_at",
  "status",
];

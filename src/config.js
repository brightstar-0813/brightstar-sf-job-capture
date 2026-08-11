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
  /** Single combined CSV with latest jobs from all sources. */
  csvLatestFile: process.env.CSV_LATEST_FILE || "jobs_latest.csv",
  csvLatestPath: path.join(
    dataDir,
    process.env.CSV_LATEST_FILE || "jobs_latest.csv"
  ),
  storePath: path.join(dataDir, process.env.STORE_FILE || "store.json"),
  dbPath: path.join(dataDir, process.env.STORE_FILE || "store.json"),
  slackWebhookUrl: String(process.env.SLACK_WEBHOOK_URL || "").trim(),
  port: Number(process.env.PORT || 3847),
  searchQ: process.env.SEARCH_Q || "Salesforce",
  maxPages: Math.max(1, Number(process.env.MAX_PAGES || 5)),
  /** Only capture/keep jobs posted within this many days (both sources). */
  recentDays: Math.max(1, Number(process.env.RECENT_DAYS || 3)),
  pageSize: Math.max(1, Math.min(100, Number(process.env.PAGE_SIZE || 20))),
  headless: bool("HEADLESS", true),
  delayMs: Math.max(0, Number(process.env.DELAY_MS || 800)),
  cronSchedule: process.env.CRON_SCHEDULE || "0 5,17 * * *",
  apiBase: `http://127.0.0.1:${Number(process.env.PORT || 3847)}`,
  captureDice: bool("CAPTURE_DICE", true),
  captureJobright: bool("CAPTURE_JOBRIGHT", true),
  captureBuiltin: bool("CAPTURE_BUILTIN", true),
  captureGreenhouse: bool("CAPTURE_GREENHOUSE", true),
  /** Often Cloudflare-blocked in headless — on by default but may yield 0. */
  captureZiprecruiter: bool("CAPTURE_ZIPRECRUITER", true),
  /** Often empty/blocked in headless — on by default but may yield 0. */
  captureMonster: bool("CAPTURE_MONSTER", true),
  /**
   * Greenhouse board tokens (boards.greenhouse.io/{token}). No global search —
   * we poll these company boards and keep remote Salesforce matches.
   */
  greenhouseBoards: String(
    process.env.GREENHOUSE_BOARDS ||
      [
        "affirm",
        "stripe",
        "datadog",
        "notion",
        "figma",
        "hubspot",
        "twilio",
        "snowflakecomputing",
        "gitlab",
        "cloudflare",
        "doordash",
        "instacart",
        "asana",
        "coinbase",
        "gusto",
        "rippling",
        "ramp",
        "brex",
        "airbnb",
        "dropbox",
        "boxinc",
        "zendesk",
        "plaid",
        "calendly",
        "canva",
        "discord",
        "robinhood",
        "square",
        "block",
        "okta",
        "hashicorp",
        "databricks",
        "mongodb",
        "elastic",
        "confluent",
        "docusign",
        "smartsheet",
        "qualtrics",
        "surveymonkey",
        "duolingo",
        "grammarly",
        "coursera",
        "udemy",
        "khanacademy",
        "vanta",
        "mercury",
        "flexport",
        "shippo",
        "faire",
        "whatnot",
      ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jobrightAuthPath: path.resolve(
    root,
    process.env.JOBRIGHT_AUTH_PATH || path.join("download", "jobright-auth.json")
  ),
  diceAuthPath: path.resolve(
    root,
    process.env.DICE_AUTH_PATH || path.join("download", "dice-auth.json")
  ),
  jobrightMaxPages: Math.max(1, Number(process.env.JOBRIGHT_MAX_PAGES || process.env.MAX_PAGES || 5)),
  /**
   * JobRight search SEEDS (not title filters). A plain "Salesforce" query on
   * JobRight returns almost only jobs AT the Salesforce company, so we seed the
   * search with several Salesforce role families to surface Salesforce-skill
   * roles across many employers. Whether a returned job is KEPT is decided by
   * the capture rule (word "Salesforce" in title OR description, minus the
   * Salesforce company) — never by matching one of these seed titles — so
   * differently-titled roles (e.g. "Software Engineer II (Salesforce)") are
   * still captured. Broaden/tune via the JOBRIGHT_TITLES env (comma-separated).
   */
  jobrightTitles: String(
    process.env.JOBRIGHT_TITLES ||
      [
        "Salesforce Administrator",
        "Salesforce Developer",
        "Salesforce Consultant",
        "Salesforce Business Analyst",
        "Salesforce Architect",
        "Salesforce Engineer",
        "Salesforce Marketing Cloud",
        "Salesforce CPQ",
        "Salesforce Technical Lead",
        "Salesforce Solution Architect",
        "Salesforce Project Manager",
        "Salesforce QA Engineer",
      ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

/** Known capture source ids (used for status counts). */
export const SOURCE_IDS = [
  "dice",
  "jobright",
  "builtin",
  "greenhouse",
  "ziprecruiter",
  "monster",
];

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

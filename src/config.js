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

function csvList(name, fallbackItems) {
  return String(process.env[name] || fallbackItems.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
  /**
   * Keyword searches used by Dice / Built In / Remotive. First query uses
   * MAX_PAGES; the rest use SEARCH_EXTRA_PAGES so product searches stay cheap.
   */
  searchQueries: csvList("SEARCH_QUERIES", [
    "Salesforce",
    "Health Cloud",
    "Data Cloud",
    "Marketing Cloud",
    "Service Cloud",
    "Agentforce",
    "OmniStudio",
    "Salesforce CPQ",
  ]),
  maxPages: Math.max(1, Number(process.env.MAX_PAGES || 8)),
  searchExtraPages: Math.max(1, Number(process.env.SEARCH_EXTRA_PAGES || 3)),
  /** Only capture/keep jobs posted within this many days (both sources). */
  recentDays: Math.max(1, Number(process.env.RECENT_DAYS || 3)),
  pageSize: Math.max(1, Math.min(100, Number(process.env.PAGE_SIZE || 50))),
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
  /** Needs `npm run indeed:login` — Cloudflare blocks anonymous headless. */
  captureIndeed: bool("CAPTURE_INDEED", true),
  captureCareerbuilder: bool("CAPTURE_CAREERBUILDER", true),
  /** Public JSON APIs — no browser, not Cloudflare-gated. */
  captureRemotive: bool("CAPTURE_REMOTIVE", true),
  captureJobicy: bool("CAPTURE_JOBICY", true),
  captureRemoteok: bool("CAPTURE_REMOTEOK", true),
  captureWwr: bool("CAPTURE_WWR", true),
  captureHimalayas: bool("CAPTURE_HIMALAYAS", true),
  captureJobgether: bool("CAPTURE_JOBGETHER", true),
  captureArbeitnow: bool("CAPTURE_ARBEITNOW", true),
  captureGooglejobs: bool("CAPTURE_GOOGLEJOBS", true),
  /** Optional. Google Jobs has no free API — SerpAPI google_jobs engine. */
  serpapiKey: String(process.env.SERPAPI_KEY || "").trim(),
  captureLever: bool("CAPTURE_LEVER", true),
  captureAshby: bool("CAPTURE_ASHBY", true),
  /**
   * Greenhouse board tokens (boards.greenhouse.io/{token}). No global search —
   * we poll Salesforce ISVs/partners plus employers that commonly hire
   * Salesforce talent. Tune via GREENHOUSE_BOARDS.
   */
  greenhouseBoards: csvList("GREENHOUSE_BOARDS", [
    "copado",
    "gearset",
    "ownbackup",
    "own",
    "ncino",
    "conga",
    "servicemax",
    "certinia",
    "financialforce",
    "heroku",
    "mulesoft",
    "tableau",
    "slack",
    "trailhead",
    "docusign",
    "workato",
    "celigo",
    "jitterbit",
    "informatica",
    "snaplogic",
    "odaseva",
    "flosum",
    "autorabit",
    "prodly",
    "salto",
    "slalom",
    "persistent",
    "osfdigital",
    "cloudkettle",
    "gong",
    "clari",
    "highspot",
    "seismic",
    "outreach",
    "salesloft",
    "zoominfo",
    "demandbase",
    "stripe",
    "twilio",
    "zendesk",
    "okta",
    "intuit",
    "adobe",
    "paypal",
    "block",
    "square",
    "snowflakecomputing",
    "databricks",
    "hubspot",
    "dropbox",
    "boxinc",
    "smartsheet",
    "qualtrics",
    "gusto",
    "rippling",
    "affirm",
    "sofi",
    "chime",
    "gitlab",
    "cloudflare",
    "datadog",
    "mongodb",
    "elastic",
    "confluent",
    "airbnb",
    "doordash",
    "instacart",
    "coinbase",
    "robinhood",
    "plaid",
    "brex",
    "ramp",
    "mercury",
    "vanta",
    "asana",
    "notion",
    "figma",
    "calendly",
    "intercom",
    "anthropic",
    "openai",
    "discord",
    "epam",
    "thoughtworks",
    "globant",
    "cloudforgood",
  ]),
  /**
   * Lever company tokens (jobs.lever.co/{token}). Same idea as Greenhouse.
   */
  leverBoards: csvList("LEVER_BOARDS", [
    "copado",
    "gearset",
    "ownbackup",
    "ncino",
    "conga",
    "certinia",
    "mulesoft",
    "tableau",
    "slack",
    "docusign",
    "workato",
    "celigo",
    "gong",
    "clari",
    "outreach",
    "salesloft",
    "highspot",
    "seismic",
    "zoominfo",
    "slalom",
    "netflix",
    "canva",
    "figma",
    "notion",
    "vercel",
    "linear",
    "anthropic",
    "openai",
    "stripe",
    "twilio",
    "zendesk",
    "okta",
    "hubspot",
    "databricks",
    "snowflake",
    "gitlab",
    "cloudflare",
    "datadog",
    "airbnb",
    "coinbase",
    "robinhood",
    "plaid",
    "brex",
    "ramp",
    "gusto",
    "rippling",
    "intercom",
    "asana",
  ]),
  /**
   * Ashby job-board tokens (jobs.ashbyhq.com/{token}).
   */
  ashbyBoards: csvList("ASHBY_BOARDS", [
    "copado",
    "gearset",
    "ownbackup",
    "ncino",
    "conga",
    "certinia",
    "workato",
    "gong",
    "clari",
    "outreach",
    "salesloft",
    "ramp",
    "notion",
    "linear",
    "vercel",
    "openai",
    "anthropic",
    "rippling",
    "vanta",
    "mercury",
    "brex",
    "plaid",
    "databricks",
    "snowflake",
    "asana",
    "figma",
    "canva",
    "intercom",
  ]),
  jobrightAuthPath: path.resolve(
    root,
    process.env.JOBRIGHT_AUTH_PATH || path.join("download", "jobright-auth.json")
  ),
  diceAuthPath: path.resolve(
    root,
    process.env.DICE_AUTH_PATH || path.join("download", "dice-auth.json")
  ),
  indeedAuthPath: path.resolve(
    root,
    process.env.INDEED_AUTH_PATH || path.join("download", "indeed-auth.json")
  ),
  indeedProfileDir: path.resolve(
    root,
    process.env.INDEED_PROFILE_DIR || path.join("download", "indeed-profile")
  ),
  /** Open a visible Chrome window for Indeed (helps after Cloudflare). */
  indeedHeaded: bool("INDEED_HEADED", false),
  /**
   * Google Sheet bid tracker (applied / resume-built jobs). Capture skips any
   * listing whose Link matches (URL or board id from the URL). Sheet must be
   * link-readable.
   */
  bidTrackingSheetUrl: String(
    process.env.BID_TRACKING_SHEET_URL ||
      process.env.BID_TRACKING_SHEET_ID ||
      "https://docs.google.com/spreadsheets/d/1UCHuLKjnEDvH-Q8NYBvspmyts0evq2lFT5ZQF_djmcE/edit?gid=0#gid=0"
  ).trim(),
  bidTrackingSheetGid: String(process.env.BID_TRACKING_SHEET_GID || "0").trim(),
  excludeBidTrackingSheet: bool("EXCLUDE_BID_TRACKING_SHEET", true),
  jobrightMaxPages: Math.max(1, Number(process.env.JOBRIGHT_MAX_PAGES || process.env.MAX_PAGES || 5)),
  /**
   * JobRight search SEEDS (not title filters). A plain "Salesforce" query on
   * JobRight returns almost only jobs AT the Salesforce company, so we seed the
   * search with several Salesforce role families to surface Salesforce-skill
   * roles across many employers. Whether a returned job is KEPT is decided by
   * the capture rule (Salesforce / Health Cloud / Data Cloud / … in title or as
   * a primary skill, minus the Salesforce company) — never by matching one of
   * these seed titles — so differently-titled roles (e.g. "Software Engineer II
   * (Salesforce)") are still captured. Broaden/tune via JOBRIGHT_TITLES.
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
        "Health Cloud",
        "Data Cloud",
        "Service Cloud",
        "Agentforce",
        "OmniStudio",
        "Revenue Cloud",
        "Financial Services Cloud",
      ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export function pagesForSearchQuery(index) {
  return Number(index) === 0 ? config.maxPages : config.searchExtraPages;
}

/** Known capture source ids (used for status counts). */
export const SOURCE_IDS = [
  "dice",
  "jobright",
  "builtin",
  "greenhouse",
  "lever",
  "ashby",
  "remotive",
  "jobicy",
  "remoteok",
  "wwr",
  "himalayas",
  "jobgether",
  "arbeitnow",
  "googlejobs",
  "ziprecruiter",
  "monster",
  "indeed",
  "careerbuilder",
];

/**
 * Preferred posting when the same role appears on several boards
 * (Salesforce priority: company careers → Indeed → Dice → Zip → …).
 * LinkedIn URLs win even if source is another board (LinkedIn is not scraped).
 * Lower index = higher priority.
 */
export const SOURCE_PRIORITY = [
  "greenhouse",
  "lever",
  "ashby",
  "indeed",
  "dice",
  "ziprecruiter",
  "glassdoor",
  "builtin",
  "careerbuilder",
  "monster",
  "jobgether",
  "himalayas",
  "remotive",
  "jobicy",
  "remoteok",
  "wwr",
  "arbeitnow",
  "googlejobs",
  "jobright",
];

/** CSV row order for older jobs — mirrors SOURCE_PRIORITY. */
export const CSV_SOURCE_ORDER = [...SOURCE_PRIORITY];

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

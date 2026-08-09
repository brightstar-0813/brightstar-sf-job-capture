/**
 * Capture Salesforce jobs from Dice + JobRight (autofill only).
 * Task Scheduler / cron entrypoint.
 */

import { chromium } from "playwright";
import { config } from "./config.js";
import { searchDiceJobs } from "./dice/search.js";
import { scrapeJobDetails } from "./dice/detail.js";
import { searchJobrightJobs } from "./jobright/search.js";
import { matchesCaptureRule } from "./filter.js";
import {
  beginRun,
  finishRun,
  upsertJob,
  syncCsv,
  closeStore,
  getMeta,
} from "./store.js";
import { notifyCaptureComplete, notifyJobrightLoginExpired } from "./slack.js";

let running = false;

function ingestJobs(jobs, runId, counts, newJobs) {
  for (const job of jobs) {
    if (!job?.id) {
      counts.skippedCount += 1;
      continue;
    }
    if (!matchesCaptureRule(job)) {
      counts.skippedCount += 1;
      console.log(
        `[filter] skip ${job.id}: no Salesforce in title/JD or employer is Salesforce`
      );
      continue;
    }
    const { status, job: saved } = upsertJob(job, runId);
    if (status === "new") {
      counts.newCount += 1;
      newJobs.push(saved);
    } else {
      counts.updatedCount += 1;
    }
  }
}

export async function runCapture({ skipSlack = false } = {}) {
  if (running) {
    return { ok: false, error: "Capture already in progress" };
  }
  running = true;
  const runId = beginRun();
  const counts = { newCount: 0, updatedCount: 0, skippedCount: 0 };
  const newJobs = [];
  let jobrightAuthExpired = false;

  console.log(
    `[capture] run #${runId} starting (q=${config.searchQ}) dice=${config.captureDice} jobright=${config.captureJobright}`
  );

  let browser;
  try {
    browser = await chromium.launch({ headless: config.headless });

    if (config.captureDice) {
      const stubs = await searchDiceJobs(browser);
      console.log(`[capture] dice listings: ${stubs.length}`);
      const details = await scrapeJobDetails(browser, stubs);
      console.log(`[capture] dice details: ${details.length}`);
      ingestJobs(details, runId, counts, newJobs);
    }

    if (config.captureJobright) {
      const { jobs: jrJobs, auth } = await searchJobrightJobs(browser);
      console.log(`[capture] jobright jobs: ${jrJobs.length}`);
      jobrightAuthExpired = !!auth?.unauthenticated;
      ingestJobs(jrJobs, runId, counts, newJobs);
    }

    const { dice, jobright } = syncCsv();
    console.log(
      `[capture] done — new=${counts.newCount} updated=${counts.updatedCount} skipped=${counts.skippedCount}`
    );
    if (dice) {
      console.log(`[capture] dice csv=${dice.csvPath}`);
      console.log(`[capture] dice latest=${dice.latestPath}`);
    }
    if (jobright) {
      console.log(`[capture] jobright csv=${jobright.csvPath}`);
      console.log(`[capture] jobright latest=${jobright.latestPath}`);
    }

    if (!skipSlack) {
      try {
        const sources = [];
        if (config.captureDice) sources.push("dice");
        if (config.captureJobright) sources.push("jobright");
        const source =
          sources.length === 2
            ? "dice+jobright"
            : sources[0] || "";
        await notifyCaptureComplete({
          webhookUrl: config.slackWebhookUrl,
          runId,
          source,
          ...counts,
          newJobs,
        });
        if (jobrightAuthExpired) {
          await notifyJobrightLoginExpired({
            webhookUrl: config.slackWebhookUrl,
            runId,
          });
        }
      } catch (slackErr) {
        console.warn(`[slack] ${slackErr.message}`);
      }
    }

    finishRun(runId, counts);
    return {
      ok: true,
      runId,
      ...counts,
      newJobs,
      dice,
      jobright,
      lastCsvDice: getMeta("last_csv_path_dice"),
      lastCsvJobright: getMeta("last_csv_path_jobright"),
    };
  } catch (err) {
    const error = err.message || String(err);
    console.error(`[capture] failed: ${error}`);
    finishRun(runId, counts, error);
    return { ok: false, runId, ...counts, error };
  } finally {
    if (browser) await browser.close().catch(() => {});
    running = false;
  }
}

export function isCaptureRunning() {
  return running;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("capture.js") ||
    process.argv[1].replace(/\\/g, "/").endsWith("/src/capture.js"));

if (isMain) {
  runCapture()
    .then((result) => {
      closeStore();
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      closeStore();
      process.exit(1);
    });
}

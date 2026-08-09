/**
 * One-time Dice login — saves Playwright storage state so the capture can read
 * your applied jobs (to exclude them) using your signed-in session.
 *
 * Usage: npm run dice:login
 * A browser window opens; sign in to Dice, then return here and press Enter.
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { chromium } from "playwright";
import { config } from "./config.js";

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  fs.mkdirSync(path.dirname(config.diceAuthPath), { recursive: true });
  console.log("Opening Dice — sign in in the browser window.");
  console.log(`Auth will be saved to: ${config.diceAuthPath}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("https://www.dice.com/dashboard/login", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await ask(
    "\nAfter you are logged in and can see your Dice dashboard, press Enter here… "
  );

  await context.storageState({ path: config.diceAuthPath });
  await browser.close();
  console.log(`Saved: ${config.diceAuthPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

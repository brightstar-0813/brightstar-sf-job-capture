/**
 * Read the user's already-applied jobs from Dice's "My Jobs → Applied" tab
 * (https://www.dice.com/my-jobs?type=applied). Dice has no clean JSON API here
 * (it uses Next.js server actions), so we scrape the /job-detail/ links, which
 * carry the same job id used as our store id.
 */

import { config } from "../config.js";
import { extractJobIdFromUrl } from "./search.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import('playwright').Page} page  A page in an authenticated Dice context.
 * @returns {Promise<{ ok: boolean, loginRedirect: boolean, ids: string[] }>}
 */
export async function collectDiceAppliedIds(page) {
  const ids = new Set();
  let loginRedirect = false;

  for (let p = 1; p <= 15; p += 1) {
    const url = `https://www.dice.com/my-jobs?type=applied&page=${p}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch {
      break;
    }
    await sleep(3000 + config.delayMs);

    // An expired session bounces to a login page.
    if (/\/login|\/dashboard\/login|signin|sign-in/i.test(page.url())) {
      loginRedirect = true;
      break;
    }

    // Load any lazy cards.
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, 1600).catch(() => {});
      await sleep(350);
    }

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/job-detail/"]')).map(
        (a) => (a.href || "").split("?")[0]
      )
    );

    const before = ids.size;
    for (const link of links) {
      const id = extractJobIdFromUrl(link);
      if (id) ids.add(id);
    }
    // Out-of-range pages redirect back to page 1 (no new ids) — stop then.
    if (ids.size === before) break;
  }

  return { ok: !loginRedirect, loginRedirect, ids: Array.from(ids) };
}

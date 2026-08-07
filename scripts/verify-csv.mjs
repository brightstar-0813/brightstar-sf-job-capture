import fs from "fs";
import { parseCsv } from "../src/csv.js";
import { containsSalesforce } from "../src/filter.js";
import { isSlackWebhookUrl } from "../src/slack.js";

const rows = parseCsv(fs.readFileSync("data/jobs.csv", "utf8")).rows;
const ids = rows.map((r) => r.id);
const unique = new Set(ids);
const noSf = rows.filter((r) => !containsSalesforce(r.title, r.description));
const blankCore = rows.filter(
  (r) => !r.title || !r.url || !r.description
);

console.log(
  JSON.stringify(
    {
      rows: rows.length,
      uniqueIds: unique.size,
      duplicateIds: ids.length - unique.size,
      missingSalesforceWord: noSf.length,
      blankTitleUrlOrJd: blankCore.length,
      sources: [...new Set(rows.map((r) => r.source))],
      statuses: rows.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {}),
      sample: {
        title: rows[0]?.title,
        organization: rows[0]?.organization,
        url: rows[0]?.url,
        descriptionChars: (rows[0]?.description || "").length,
      },
      slackUrlShapeOk: isSlackWebhookUrl(
        "https://hooks.slack.com/services/T00/B00/XXX"
      ),
      slackUrlRejectsGarbage: !isSlackWebhookUrl("https://example.com"),
    },
    null,
    2
  )
);

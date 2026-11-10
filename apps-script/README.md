# Brightstar sheet web app

Paste [`Code.gs`](Code.gs) into the spreadsheet’s Apps Script project and **Deploy → Manage deployments → Edit → New version** (or New deployment) so `appendWarehouse` is live.

## Tabs

| Tab type | Columns | Action |
|----------|---------|--------|
| Bid tracker (`Lewis-SF`, …) | No \| Date \| Title \| Company \| Link \| Salary \| Status \| Bid mode | `append` / `markApplied` |
| Warehouse (`US-SF-Jobs`) | **Role \| Company \| Link \| JD \| Salary** | `appendWarehouse` |

## Reorganize US-SF-Jobs

1. Paste updated `Code.gs` → **Deploy → Manage deployments → New version**
2. Reset + refill from local CSV:

```bash
npm run sheet:sync -- --replace
```

This clears the tab, writes **Role | Company | Link | JD | Salary**, then appends jobs (no Ready / Auto bid).

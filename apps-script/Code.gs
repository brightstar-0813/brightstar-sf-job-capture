/**
 * Brightstar Bid bot sheet web app — bid-tracker tabs + jobs warehouse.
 *
 * Deploy: Extensions → Apps Script → paste → Deploy → Web app
 *   Execute as: Me | Who has access: Anyone
 * Redeploy after updates so new actions are live.
 *
 * Actions:
 *   append           — bid-tracker row (No|Date|Title|Company|Link|Salary|Status|Bid mode)
 *   appendWarehouse  — warehouse row (Role|Company|Link|JD|Salary)  ← US-SF-Jobs
 *   replaceWarehouse — clear tab, write warehouse headers, optionally append rows[]
 *   listRows | listLinks | markApplied
 *
 * Warehouse POST fields: jobTitle, companyName, jobLink, jd, salary
 * replaceWarehouse may include rows: [{ jobTitle, companyName, jobLink, jd, salary }, ...]
 */

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!data.spreadsheetId) {
      throw new Error("spreadsheetId is required.");
    }

    const ss = SpreadsheetApp.openById(String(data.spreadsheetId));
    const action = String(data.action || "append").toLowerCase().replace(/_/g, "");
    const warehouse =
      action === "appendwarehouse" ||
      String(data.mode || "").toLowerCase() === "warehouse";

    const sheet = resolveSheet_(ss, data.sheetName, warehouse);

    if (action === "listlinks") {
      ensureSheetLayout_(sheet);
      const links = collectJobLinks_(sheet);
      const companies = collectCompanies_(sheet);
      const companyRows = collectCompanyLinkPairs_(sheet);
      const linkStatuses = collectLinkStatusPairs_(sheet);
      const appliedLinks = linkStatuses
        .filter(function (row) {
          return statusLooksApplied_(row.status);
        })
        .map(function (row) {
          return row.link;
        });
      return json_({
        ok: true,
        sheetName: sheet.getName(),
        links: links,
        companies: companies,
        companyRows: companyRows,
        linkStatuses: linkStatuses,
        appliedLinks: appliedLinks,
        count: links.length,
        companyCount: companies.length,
        appliedCount: appliedLinks.length
      });
    }

    if (action === "listrows") {
      const pruned = ensureSheetLayout_(sheet);
      const rows = collectJobRows_(sheet);
      return json_({
        ok: true,
        sheetName: sheet.getName(),
        rows: rows,
        count: rows.length,
        prunedBlankRows: pruned
      });
    }

    const jobLink = String(data.jobLink || "").trim();
    const companyName = String(data.companyName || "").trim();
    const jobTitle = String(data.jobTitle || "").trim();

    if (action === "markapplied" || action === "applied") {
      ensureSheetLayout_(sheet);
      const appliedOn = String(data.applicationDate || "").trim();
      const status =
        String(data.status || "").trim() || (appliedOn ? "Applied " + appliedOn : "Applied");
      const bidMode = normalizeBidMode_(data.bidMode);
      const row = findRowByLink_(sheet, jobLink);
      if (row > 0) {
        sheet.getRange(row, statusColumnForRow_(sheet, row)).setValue(status);
        if (bidMode) {
          sheet.getRange(row, bidModeColumnForRow_(sheet, row)).setValue(bidMode);
        }
        var appliedHeader = headerRow_(sheet);
        var appliedJobNoCol =
          (rowLooksLikeHeader_(appliedHeader) ? jobNoColumnIndex_(appliedHeader) : 0) + 1;
        var appliedJobNo = String(sheet.getRange(row, appliedJobNoCol).getValue() || "").trim();
        return json_({
          ok: true,
          updated: true,
          appended: false,
          row: row,
          jobNo: appliedJobNo,
          sheetName: sheet.getName()
        });
      }
      if (!rowHasJobIdentity_(jobTitle, companyName, jobLink)) {
        throw new Error("Cannot mark Applied: job not on sheet and title/company/link missing.");
      }
      sheet.appendRow(buildDataRow_(data, status));
      var markAppendedRow = sheet.getLastRow();
      return json_({
        ok: true,
        updated: false,
        appended: true,
        row: markAppendedRow,
        jobNo: String(data.jobNo || ""),
        sheetName: sheet.getName()
      });
    }

    if (action === "replacewarehouse") {
      return replaceWarehouse_(sheet, data);
    }

    if (warehouse || action === "appendwarehouse") {
      return appendWarehouse_(sheet, data, jobTitle, companyName, jobLink);
    }

    if (action && action !== "append") {
      throw new Error(
        'Unknown action "' +
          String(data.action || "") +
          '". Supported: append, appendWarehouse, replaceWarehouse, listRows, listLinks, markApplied.'
      );
    }

    if (!rowHasJobIdentity_(jobTitle, companyName, jobLink)) {
      throw new Error("Refusing to append an empty row (need title, company, or link).");
    }

    if (jobLink && linkExists_(sheet, jobLink)) {
      var dupRow = findRowByLink_(sheet, jobLink);
      var dupJobNo = "";
      if (dupRow > 0) {
        var dupHeader = headerRow_(sheet);
        var dupJobNoCol = (rowLooksLikeHeader_(dupHeader) ? jobNoColumnIndex_(dupHeader) : 0) + 1;
        dupJobNo = String(sheet.getRange(dupRow, dupJobNoCol).getValue() || "").trim();
      }
      return json_({
        ok: true,
        duplicate: true,
        reason: "link",
        sheetName: sheet.getName(),
        row: dupRow > 0 ? dupRow : 0,
        jobNo: dupJobNo
      });
    }

    ensureSheetLayout_(sheet);
    sheet.appendRow(buildDataRow_(data, data.status || "Ready"));
    var appendedRow = sheet.getLastRow();

    return json_({
      ok: true,
      duplicate: false,
      sheetName: sheet.getName(),
      row: appendedRow,
      jobNo: String(data.jobNo || "")
    });
  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function doGet() {
  return ContentService.createTextOutput(
    "Brightstar Bid bot sheet append + warehouse + duplicate-check endpoint is running."
  );
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

var WAREHOUSE_HEADERS = ["Role", "Company", "Link", "JD", "Salary"];

function appendWarehouse_(sheet, data, jobTitle, companyName, jobLink) {
  if (!rowHasJobIdentity_(jobTitle, companyName, jobLink)) {
    throw new Error("Refusing to append an empty row (need title, company, or link).");
  }
  ensureWarehouseLayout_(sheet);
  // Only match the Link column — scanning JD false-positives on URLs in descriptions.
  if (jobLink) {
    var dupRow = findWarehouseLinkRow_(sheet, jobLink);
    if (dupRow > 0) {
      return json_({
        ok: true,
        duplicate: true,
        reason: "link",
        sheetName: sheet.getName(),
        row: dupRow
      });
    }
  }
  sheet.appendRow(buildWarehouseRow_(data));
  return json_({
    ok: true,
    duplicate: false,
    warehouse: true,
    sheetName: sheet.getName(),
    row: sheet.getLastRow()
  });
}

/** Warehouse dedupe: exact normalized match on Link column only (ignore JD body URLs). */
function findWarehouseLinkRow_(sheet, jobLink) {
  var target = normalizeLink_(jobLink);
  if (!target) return -1;
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return -1;
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var linkCol = hasHeader ? linkColumnIndex_(values[0]) : 2;
  for (var r = start; r < values.length; r++) {
    var cell = String((values[r] || [])[linkCol] || "").trim();
    if (!cell) continue;
    if (normalizeLink_(cell) === target) return r + 1;
  }
  return -1;
}

/**
 * Wipe the tab, write Role|Company|Link|JD|Salary, then optionally append rows.
 * Used to reorganize US-SF-Jobs from the old Ready/Auto-bid layout.
 */
function replaceWarehouse_(sheet, data) {
  sheet.clear();
  sheet.getRange(1, 1, 1, WAREHOUSE_HEADERS.length).setValues([WAREHOUSE_HEADERS]);
  var rows = Array.isArray(data.rows) ? data.rows : [];
  var appended = 0;
  var skipped = 0;
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    var title = String(row.jobTitle || row.title || row.role || "").trim();
    var company = String(row.companyName || row.company || "").trim();
    var link = String(row.jobLink || row.link || row.url || "").trim();
    if (!rowHasJobIdentity_(title, company, link)) {
      skipped += 1;
      continue;
    }
    var key = normalizeLink_(link) || (title + "|" + company).toLowerCase();
    if (key && seen[key]) {
      skipped += 1;
      continue;
    }
    if (key) seen[key] = true;
    sheet.appendRow(
      buildWarehouseRow_({
        jobTitle: title,
        companyName: company,
        jobLink: link,
        jd: row.jd || row.description || "",
        salary: row.salary || ""
      })
    );
    appended += 1;
  }
  return json_({
    ok: true,
    replaced: true,
    warehouse: true,
    sheetName: sheet.getName(),
    appended: appended,
    skipped: skipped,
    headers: WAREHOUSE_HEADERS
  });
}

/** Role | Company | Link | JD | Salary */
function buildWarehouseRow_(data) {
  var jd = String(data.jd || data.description || data.jobDescription || "").trim();
  if (jd.length > 45000) jd = jd.slice(0, 44999) + "…";
  return [
    String(data.jobTitle || data.title || data.role || "").trim(),
    String(data.companyName || data.company || "").trim(),
    String(data.jobLink || data.link || data.url || "").trim(),
    jd,
    String(data.salary || "").trim()
  ];
}

function ensureWarehouseLayout_(sheet) {
  var headers = headerRow_(sheet);
  var looksWarehouse =
    rowLooksLikeHeader_(headers) &&
    findNamedColumnIndex_(headers, ["role", "title", "job title"]) >= 0 &&
    findNamedColumnIndex_(headers, ["jd", "job description", "description"]) >= 0 &&
    findNamedColumnIndex_(headers, ["status", "bid mode", "bidmode"]) < 0;

  if (!looksWarehouse) {
    sheet.getRange(1, 1, 1, WAREHOUSE_HEADERS.length).setValues([WAREHOUSE_HEADERS]);
  } else {
    // Normalize header labels if present under aliases.
    var roleIdx = findNamedColumnIndex_(headers, ["role", "title", "job title"]);
    var companyIdx = findNamedColumnIndex_(headers, ["company", "compay", "company name"]);
    var linkIdx = findNamedColumnIndex_(headers, ["link", "job link", "url"]);
    var jdIdx = findNamedColumnIndex_(headers, ["jd", "job description", "description"]);
    var salaryIdx = findNamedColumnIndex_(headers, ["salary", "comp", "compensation"]);
    if (roleIdx >= 0) sheet.getRange(1, roleIdx + 1).setValue("Role");
    if (companyIdx >= 0) sheet.getRange(1, companyIdx + 1).setValue("Company");
    if (linkIdx >= 0) sheet.getRange(1, linkIdx + 1).setValue("Link");
    if (jdIdx >= 0) sheet.getRange(1, jdIdx + 1).setValue("JD");
    if (salaryIdx >= 0) sheet.getRange(1, salaryIdx + 1).setValue("Salary");
  }
}

/** Pick an existing tab by name, or create it with the right header row. */
function resolveSheet_(ss, sheetName, warehouse) {
  var name = String(sheetName || "")
    .trim()
    .replace(/[:\\\/\?\*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length > 100) name = name.slice(0, 100).trim();
  if (!name) {
    var sheets = ss.getSheets();
    return sheets && sheets.length ? sheets[0] : ss.insertSheet("Sheet1");
  }
  var existing = ss.getSheetByName(name);
  if (existing) return existing;
  var created = ss.insertSheet(name);
  if (warehouse) {
    created.getRange(1, 1, 1, WAREHOUSE_HEADERS.length).setValues([WAREHOUSE_HEADERS]);
  } else {
    created.getRange(1, 1, 1, 8).setValues([
      ["No", "Date", "Title", "Company", "Link", "Salary", "Status", "Bid mode"]
    ]);
  }
  return created;
}

/** One data row A–H: No | Date | Title | Company | Link | Salary | Status | Bid mode */
function buildDataRow_(data, status) {
  return [
    data.jobNo || "",
    data.applicationDate || "",
    data.jobTitle || "",
    String(data.companyName || "").trim(),
    String(data.jobLink || "").trim(),
    data.salary || "",
    status || "Ready",
    normalizeBidMode_(data.bidMode)
  ];
}

function normalizeBidMode_(value) {
  var raw = String(value || "").trim();
  if (!raw) return "Auto bid";
  if (/^auto\s*bid$/i.test(raw)) return "Auto bid";
  if (/^manual\s*bid$/i.test(raw)) return "Manual bid";
  if (/^email\s*bid$/i.test(raw)) return "Email bid";
  if (/^profile\s*apply$/i.test(raw)) return "Profile apply";
  var src = raw.toLowerCase().replace(/_/g, "-");
  if (src === "email-bid" || src === "email") return "Email bid";
  if (
    src === "profile-apply" ||
    src === "profile" ||
    src === "one-click" ||
    src === "1-click"
  ) {
    return "Profile apply";
  }
  if (src === "one-off" || src === "manual" || src === "manual-bid" || src === "oneoff") {
    return "Manual bid";
  }
  return "Auto bid";
}

function normalizeLink_(url) {
  var raw = String(url || "").trim();
  if (!raw) return "";
  try {
    var u = raw;
    u = u.replace(/[?#].*$/, function (m) {
      if (m.charAt(0) === "#") return "";
      var q = m.slice(1);
      var keep = q.split("&").filter(function (part) {
        var key = part.split("=")[0].toLowerCase();
        return (
          key &&
          key.indexOf("utm_") !== 0 &&
          key !== "fbclid" &&
          key !== "gclid" &&
          key !== "ref" &&
          key !== "source"
        );
      });
      return keep.length ? "?" + keep.join("&") : "";
    });
    u = u.replace(/\/+$/, "");
    return u.toLowerCase();
  } catch (err) {
    return raw.toLowerCase();
  }
}

function headerRow_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 8);
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
}

function rowLooksLikeHeader_(row) {
  var joined = (row || [])
    .map(function (h) {
      return String(h || "").trim().toLowerCase();
    })
    .join(" ");
  if (!joined) return false;
  if (/https?:\/\//i.test(joined)) return false;
  return /\b(link|title|role|company|compay|status|date|salary|jd|bid\s*mode|bid\s*source)\b/.test(
    joined
  );
}

function cellLooksLikeUrl_(value) {
  var s = String(value || "").trim();
  return /^https?:\/\//i.test(s) || /hyperlink\s*\(/i.test(s);
}

function linkColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["link", "job link", "job url", "url", "jd link"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 4;
}

function statusColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["status", "applied", "state"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 6;
}

function bidModeColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["bid mode", "bidmode", "bid source", "mode", "source"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return statusColumnIndex_(headerRow) + 1;
}

function findNamedColumnIndex_(headerRow, names) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function titleColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["role", "title", "job title", "position"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 2;
}

function salaryColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["salary", "comp", "compensation", "pay"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 5;
}

function dateColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["date", "created date", "application date", "created"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 1;
}

function jobNoColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["no", "job no", "jobno", "#", "number"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 0;
}

function rowHasJobIdentity_(title, company, link) {
  if (String(link || "").trim()) return true;
  if (String(title || "").trim()) return true;
  if (String(company || "").trim()) return true;
  return false;
}

function ensureStatusHeader_(sheet) {
  var headers = headerRow_(sheet);
  if (!rowLooksLikeHeader_(headers)) return;
  var idx = statusColumnIndex_(headers);
  if (!String(headers[idx] || "").trim()) {
    sheet.getRange(1, idx + 1).setValue("Status");
  }
}

function ensureBidModeHeader_(sheet) {
  var headers = headerRow_(sheet);
  if (!rowLooksLikeHeader_(headers)) {
    return;
  }
  var statusIdx = statusColumnIndex_(headers);
  var names = ["bid mode", "bidmode", "bid source", "mode"];
  var found = -1;
  for (var i = 0; i < names.length; i++) {
    var idx = headers
      .map(function (h) {
        return String(h || "")
          .trim()
          .toLowerCase();
      })
      .indexOf(names[i]);
    if (idx >= 0) {
      found = idx;
      break;
    }
  }
  if (found >= 0) {
    if (!String(headers[found] || "").trim()) {
      sheet.getRange(1, found + 1).setValue("Bid mode");
    }
    return;
  }
  var bidCol = statusIdx + 2;
  sheet.getRange(1, bidCol).setValue("Bid mode");
}

function dropJdColumnIfPresent_(sheet) {
  var headers = headerRow_(sheet);
  if (!rowLooksLikeHeader_(headers)) return;
  // Warehouse tabs keep JD.
  if (findNamedColumnIndex_(headers, ["role"]) >= 0 && findNamedColumnIndex_(headers, ["jd", "job description", "description"]) >= 0) {
    return;
  }
  var jdIdx = findNamedColumnIndex_(headers, ["jd", "job description", "description", "job desc"]);
  if (jdIdx >= 0) sheet.deleteColumn(jdIdx + 1);
}

function trimColumnsPastBidMode_(sheet) {
  var headers = headerRow_(sheet);
  if (findNamedColumnIndex_(headers, ["role"]) >= 0 && findNamedColumnIndex_(headers, ["jd", "job description"]) >= 0) {
    return;
  }
  var lastKeep;
  if (rowLooksLikeHeader_(headers)) {
    lastKeep = Math.max(statusColumnIndex_(headers), bidModeColumnIndex_(headers)) + 1;
  } else {
    lastKeep = 8;
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol > lastKeep) {
    sheet.deleteColumns(lastKeep + 1, lastCol - lastKeep);
  }
}

function pruneBlankReadyRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return 0;
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var header = hasHeader ? values[0] : [];
  var titleCol = hasHeader ? titleColumnIndex_(header) : 2;
  var companyCol = hasHeader ? companyColumnIndex_(header) : 3;
  var linkCol = hasHeader ? linkColumnIndex_(header) : 4;
  var removed = 0;
  for (var r = values.length - 1; r >= start; r--) {
    var row = values[r] || [];
    var title = String(row[titleCol] || "").trim();
    var company = String(row[companyCol] || "").trim();
    var link = String(row[linkCol] || "").trim();
    if (!link) {
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c] || "").trim();
        if (cellLooksLikeUrl_(cell)) {
          link = cell;
          break;
        }
      }
    }
    if (rowHasJobIdentity_(title, company, link)) continue;
    var any = false;
    for (var i = 0; i < row.length; i++) {
      if (String(row[i] || "").trim()) {
        any = true;
        break;
      }
    }
    if (!any) continue;
    sheet.deleteRow(r + 1);
    removed += 1;
  }
  return removed;
}

function ensureSheetLayout_(sheet) {
  var headers = headerRow_(sheet);
  if (
    rowLooksLikeHeader_(headers) &&
    findNamedColumnIndex_(headers, ["role"]) >= 0 &&
    findNamedColumnIndex_(headers, ["jd", "job description", "description"]) >= 0
  ) {
    return 0;
  }
  ensureStatusHeader_(sheet);
  ensureBidModeHeader_(sheet);
  dropJdColumnIfPresent_(sheet);
  trimColumnsPastBidMode_(sheet);
  return pruneBlankReadyRows_(sheet);
}

function statusColumnForRow_(sheet, row) {
  var headers = headerRow_(sheet);
  if (rowLooksLikeHeader_(headers)) return statusColumnIndex_(headers) + 1;
  return 7;
}

function bidModeColumnForRow_(sheet, row) {
  var headers = headerRow_(sheet);
  if (rowLooksLikeHeader_(headers)) return bidModeColumnIndex_(headers) + 1;
  return 8;
}

function companyColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["company", "compay", "company name", "employer", "organization", "org"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 3;
}

function collectJobRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var header = hasHeader ? values[0] : [];
  var jobNoCol = hasHeader ? jobNoColumnIndex_(header) : 0;
  var dateCol = hasHeader ? dateColumnIndex_(header) : 1;
  var titleCol = hasHeader ? titleColumnIndex_(header) : 2;
  var companyCol = hasHeader ? companyColumnIndex_(header) : 3;
  var linkCol = hasHeader ? linkColumnIndex_(header) : 4;
  var salaryCol = hasHeader ? salaryColumnIndex_(header) : 5;
  var statusCol = hasHeader ? statusColumnIndex_(header) : 6;
  var bidModeCol = hasHeader ? bidModeColumnIndex_(header) : 7;
  var out = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    var title = String(row[titleCol] || "").trim();
    var company = String(row[companyCol] || "").trim();
    var link = String(row[linkCol] || "").trim();
    if (!link) {
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c] || "").trim();
        if (cellLooksLikeUrl_(cell)) {
          link = cell;
          break;
        }
      }
    }
    if (!rowHasJobIdentity_(title, company, link)) continue;
    if (!company && /^(ready|saved|new|applied)$/i.test(title)) continue;
    out.push({
      row: r + 1,
      jobNo: String(row[jobNoCol] || "").trim(),
      date: String(row[dateCol] || "").trim(),
      title: title,
      company: company,
      link: link,
      salary: String(row[salaryCol] || "").trim(),
      status: String(row[statusCol] || "").trim(),
      bidMode: String(row[bidModeCol] || "").trim()
    });
  }
  return out;
}

function normalizeCompanyName_(name) {
  var s = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(incorporated|inc|llc|corp|corporation|company|co|ltd|limited|plc|gmbh|ag|pvt|private)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

function collectCompanies_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var col = hasHeader ? companyColumnIndex_(values[0]) : 3;
  var out = [];
  var seen = {};
  for (var r = start; r < values.length; r++) {
    var raw = String((values[r] || [])[col] || "").trim();
    var n = normalizeCompanyName_(raw);
    if (!n || seen[n]) continue;
    seen[n] = true;
    out.push(raw);
  }
  return out;
}

function statusLooksApplied_(status) {
  return /^\s*applied\b/i.test(String(status || "").trim());
}

function collectLinkStatusPairs_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var linkCol = hasHeader ? linkColumnIndex_(values[0]) : 4;
  var statusCol = hasHeader ? statusColumnIndex_(values[0]) : 6;
  var out = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    var link = String(row[linkCol] || "").trim();
    if (!link) {
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c] || "").trim();
        if (cellLooksLikeUrl_(cell)) {
          link = cell;
          break;
        }
      }
    }
    if (!link) continue;
    out.push({
      link: link,
      status: String(row[statusCol] || "").trim()
    });
  }
  return out;
}

function collectCompanyLinkPairs_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var companyCol = hasHeader ? companyColumnIndex_(values[0]) : 3;
  var linkCol = hasHeader ? linkColumnIndex_(values[0]) : 4;
  var out = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    var company = String(row[companyCol] || "").trim();
    if (!normalizeCompanyName_(company)) continue;
    var link = String(row[linkCol] || "").trim();
    if (!link) {
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c] || "").trim();
        if (cellLooksLikeUrl_(cell)) {
          link = cell;
          break;
        }
      }
    }
    out.push({ company: company, link: link });
  }
  return out;
}

function collectJobLinks_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var start = rowLooksLikeHeader_(values[0]) ? 1 : 0;
  var links = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    for (var c = 0; c < row.length; c++) {
      var v = String(row[c] || "").trim();
      if (cellLooksLikeUrl_(v)) links.push(v);
    }
  }
  return links;
}

function findRowByLink_(sheet, jobLink) {
  var target = normalizeLink_(jobLink);
  if (!target) return -1;
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return -1;
  var start = rowLooksLikeHeader_(values[0]) ? 1 : 0;
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] || "").trim();
      if (!cell) continue;
      var n = normalizeLink_(cell);
      if (n === target) return r + 1;
      if (target.length >= 12 && (n.indexOf(target) >= 0 || cell.toLowerCase().indexOf(target) >= 0)) {
        return r + 1;
      }
    }
  }
  return -1;
}

function linkExists_(sheet, jobLink) {
  return findRowByLink_(sheet, jobLink) > 0;
}

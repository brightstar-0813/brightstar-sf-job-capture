/**
 * Client-side pre-filter (mirrors Node filter.js loosely).
 * Final gate remains matchesCaptureRule on the server.
 */
(function (g) {
  const Sf = (g.SfCapture = g.SfCapture || {});

  const SF_PRODUCT_RE =
    /salesforce|salesfoce|salseforce|health\s*cloud|healthcloud|salesforce\s+data\s*cloud|datacloud|marketing\s*cloud|service\s*cloud|commerce\s*cloud|experience\s*cloud|community\s*cloud|revenue\s*cloud|sales\s*cloud|industry\s*cloud|financial\s*services\s*cloud|nonprofit\s*cloud|education\s*cloud|manufacturing\s*cloud|consumer\s*goods\s*cloud|public\s*sector\s*cloud|communications\s*cloud|\bnpsp\b|agentforce|omnistudio|vlocity|\bsfmc\b|\bsfcc\b|pardot|account\s+engagement|lightning\s+web\s+components|\blwc\b|steelbrick|salesforce\s+cpq|salesforce\s+flow|\bsoql\b|\bsosl\b|\bmulesoft\b|einstein\s+(gpt|copilot|analytics|for\s+sales|for\s+service)|apex\s+(class(?:es)?|trigger(?:s)?|code|developer|programming)/i;
  const SF_STRONG_JD_RE =
    /health\s*cloud|healthcloud|salesforce\s+data\s*cloud|datacloud|marketing\s*cloud|service\s*cloud|commerce\s*cloud|experience\s*cloud|community\s*cloud|revenue\s*cloud|sales\s*cloud|financial\s*services\s*cloud|nonprofit\s*cloud|\bnpsp\b|agentforce|omnistudio|vlocity|\bsfmc\b|\bsfcc\b|pardot|account\s+engagement|lightning\s+web\s+components|\blwc\b|steelbrick|salesforce\s+cpq|\bsoql\b|\bsosl\b|\bmulesoft\b|apex\s+(class(?:es)?|trigger(?:s)?|code|developer|programming)/i;
  const SF_ROLE_IN_JD_RE =
    /\bsalesforce\s+(admin(?:istrator)?|developer|architect|consultant|engineer|platform|cpq|commerce|flow|lightning|certified|experience|marketing\s+cloud|service\s+cloud|health\s+cloud|data\s+cloud)/i;
  const OTHER_CRM_RE =
    /hubspot|microsoft\s*dynamics|dynamics\s*365|zoho|pipedrive|oracle\s*(crm|sales)?|sap\s*crm|freshsales|sugarcrm|zendesk|servicenow|veeva|salesloft/i;
  const COMPETING_PLATFORM_RE =
    /\b(magento|shopify|woocommerce|servicenow|workday|veeva|hubspot|salesloft|docusign|sap\b|oracle|epic\b|netsuite)\b/i;
  const SALESFORCE_EMPLOYER_RE =
    /^\s*salesforce(?:\.com|,?\s*inc\.?)?\s*$/i;
  const ICF_EMPLOYER_RE = /^\s*icf\b/i;
  const SALES_TITLE_RE =
    /\b(account\s+executive|account\s+manager|sales\s+representative|sales\s+force\s+effectiveness|sales\s+force\s+management|regional\s+sales)\b/i;

  function isPassingCrmMention(description) {
    const d = String(description || "");
    if (/salesforce\s*[,;/|&]\s*/i.test(d) && OTHER_CRM_RE.test(d)) return true;
    if (OTHER_CRM_RE.test(d) && /[,;/|&]\s*salesforce\b/i.test(d)) return true;
    if (
      /(such as|including|e\.g\.|for example|like)\s+[^\n.]{0,60}salesforce/i.test(
        d
      )
    ) {
      return true;
    }
    if (
      /salesforce\s+(or|and)\s+(similar|equivalent|other|hubspot|dynamics)/i.test(
        d
      )
    ) {
      return true;
    }
    return false;
  }

  Sf.looksSalesforceTitle = function looksSalesforceTitle(title) {
    const t = String(title || "");
    if (!t.trim()) return false;
    if (SALES_TITLE_RE.test(t) && !SF_PRODUCT_RE.test(t)) return false;
    return (
      SF_PRODUCT_RE.test(t) ||
      (/\bcpq\b/i.test(t) && !/\b(oracle|sap)\b/i.test(t)) ||
      (/\bcrm\b/i.test(t) && !OTHER_CRM_RE.test(t))
    );
  };

  Sf.containsSalesforce = function containsSalesforce(title, description) {
    const t = String(title || "");
    const d = String(description || "");
    if (
      SF_PRODUCT_RE.test(t) ||
      (/\bcpq\b/i.test(t) && !/\b(oracle|sap)\b/i.test(t))
    ) {
      /* title ok — still check JD quality below when title is weak */
    } else if (COMPETING_PLATFORM_RE.test(t) && !SF_PRODUCT_RE.test(t)) {
      return false;
    }
    if (!t.trim()) {
      return (
        (SF_STRONG_JD_RE.test(d) || SF_ROLE_IN_JD_RE.test(d)) &&
        !isPassingCrmMention(d)
      );
    }
    if (!Sf.looksSalesforceTitle(t)) return false;
    if (isPassingCrmMention(d)) return false;
    if (!d.trim()) return true;
    return SF_STRONG_JD_RE.test(d) || SF_ROLE_IN_JD_RE.test(d) || SF_PRODUCT_RE.test(t);
  };

  Sf.isBlockedEmployer = function isBlockedEmployer(organization) {
    const o = String(organization || "").trim();
    return SALESFORCE_EMPLOYER_RE.test(o) || ICF_EMPLOYER_RE.test(o);
  };

  Sf.isRemoteArrangement = function isRemoteArrangement(workArrangement) {
    const w = String(workArrangement || "").toLowerCase().trim();
    if (!w) return true;
    if (/hybrid/.test(w)) return false;
    if (/on[-\s]?site|onsite|in[-\s]?office|in[-\s]?person/.test(w)) return false;
    return /\bremote\b/.test(w);
  };

  Sf.isLinkedinUrl = function isLinkedinUrl(url) {
    return /linkedin\.com/i.test(String(url || ""));
  };

  Sf.parsePostedDate = function parsePostedDate(value, now) {
    now = now || new Date();
    if (value == null || value === "") return null;
    if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      const ms = String(Math.trunc(n)).length <= 10 ? n * 1000 : n;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const s = String(value).trim().toLowerCase();
    if (
      /(^|\b)(just posted|today|moments? ago|minutes? ago|hours? ago|<\s*1\s*day)/.test(
        s
      )
    ) {
      return now;
    }
    if (/\byesterday\b/.test(s)) return new Date(now.getTime() - 864e5);
    const rel = s.match(/(\d+)\+?\s*(hour|day|week|month|year)s?\s*ago/);
    if (rel) {
      const unit = {
        hour: 36e5,
        day: 864e5,
        week: 6048e5,
        month: 2592e6,
        year: 31536e6,
      }[rel[2]];
      return new Date(now.getTime() - Number(rel[1]) * unit);
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  };

  Sf.isWithinRecentDays = function isWithinRecentDays(value, days, now) {
    now = now || new Date();
    const d = Sf.parsePostedDate(value, now);
    if (!d) return null;
    const age = now.getTime() - d.getTime();
    if (age < 0) return true;
    return age <= days * 864e5;
  };

  Sf.isExpiredPosting = function isExpiredPosting(text) {
    return /no longer available|this job has expired|job has been filled|posting has expired|not accepting applications/i.test(
      String(text || "")
    );
  };

  Sf.looksBlockedPage = function looksBlockedPage(title, bodySnippet) {
    const t = `${title || ""}\n${bodySnippet || ""}`;
    return /just a moment|additional verification required|unusual traffic|verify you are (a )?human|cf-browser-verification|attention required|security verification|access denied|captcha|are you a robot/i.test(
      t
    );
  };

  Sf.looksLoginPage = function looksLoginPage(title, bodySnippet, href) {
    const h = String(href || "").toLowerCase();
    if (/\/(login|signin|sign-in|auth|account\/login)/i.test(h)) return true;
    const t = `${title || ""}\n${bodySnippet || ""}`.toLowerCase();
    return (
      /\bsign in\b/.test(t) &&
      /\b(password|email|continue with)\b/.test(t) &&
      !/\bjob\b/.test(t.slice(0, 200))
    );
  };

  Sf.dismissConsent = function dismissConsent(doc) {
    doc = doc || document;
    const selectors = [
      "#onetrust-accept-btn-handler",
      "button#accept-cookie-notification",
      'button[aria-label*="Accept" i]',
      'button[id*="accept" i]',
      'button[class*="accept" i]',
      'button[data-testid*="accept" i]',
    ];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        try {
          el.click();
          return true;
        } catch {
          /* ignore */
        }
      }
    }
    return false;
  };

  Sf.keepDomJob = function keepDomJob(job, recentDays) {
    if (!job?.id) return false;
    if (Sf.isLinkedinUrl(job.url)) return false;
    if (Sf.isExpiredPosting(`${job.title}\n${job.description}`)) return false;
    if (Sf.isBlockedEmployer(job.organization)) return false;
    if (!Sf.isRemoteArrangement(job.work_arrangement || "Remote")) return false;
    if (!Sf.containsSalesforce(job.title, job.description)) return false;
    if (Sf.isWithinRecentDays(job.date_posted, recentDays) === false) {
      return false;
    }
    return true;
  };

  Sf.emptyJob = function emptyJob(source, extra) {
    return {
      id: "",
      title: "",
      organization: "",
      location: "",
      work_arrangement: "Remote",
      remote_restricted_to: "",
      experience_level: "",
      employment_type: "",
      salary_min: "",
      salary_max: "",
      salary_currency: "USD",
      salary_unit: "",
      key_skills: "",
      source,
      date_posted: "",
      url: "",
      description: "",
      ...(extra || {}),
    };
  };
})(typeof globalThis !== "undefined" ? globalThis : self);

/**
 * Normalizers. Each takes whatever a person typed and returns the canonical
 * value, null for "left blank", or throws a ProfileFieldError with a message
 * fit to show next to the box.
 *
 * Deliberately lenient about form and strict about meaning: "Acme.com/about",
 * "https://www.acme.com" and "@acme.com" are all the domain acme.com, but a URL
 * in a name box is spam and is refused. What is never done is "correcting" a
 * person's name: McDonald, de la Cruz and O'Neil stay as typed.
 */

export class ProfileFieldError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "ProfileFieldError";
    this.field = field;
  }
}

const blank = (v) => v === undefined || v === null || String(v).trim() === "";

/** Collapse runs of whitespace and drop control characters. */
export function cleanText(v) {
  return String(v)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const looksLikeUrlOrEmail = (s) => /(https?:\/\/|www\.|@|\.(com|net|org|io|ru|xyz|top|info)\b)/i.test(s);

// Addresses that are a person's own and say nothing about where they work.
// Shared relay and temp-mail hosts are here too: their domain is nobody's company.
export const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com", "passport.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "aim.com",
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me",
  "gmx.com", "gmx.net", "gmx.de", "web.de", "mail.com", "email.com",
  "yandex.com", "yandex.ru", "ya.ru", "mail.ru", "inbox.ru", "list.ru", "bk.ru",
  "qq.com", "163.com", "126.com", "sina.com", "foxmail.com",
  "fastmail.com", "fastmail.fm", "hey.com", "tutanota.com", "tuta.io", "tutamail.com",
  "duck.com", "passmail.net", "passmail.com", "aleeas.com", "simplelogin.com",
  "anonaddy.me", "addy.io", "relay.firefox.com", "mozmail.com", "privaterelay.appleid.com",
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org", "yopmail.com",
  "hushmail.com", "zohomail.com", "rediffmail.com", "libero.it", "orange.fr", "free.fr",
  "laposte.net", "btinternet.com", "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
  "cox.net", "charter.net", "earthlink.net", "t-online.de", "seznam.cz", "naver.com",
  "daum.net", "hanmail.net", "uol.com.br", "bol.com.br", "terra.com.br",
]);

export function isFreemail(domain) {
  if (!domain) return false;
  const d = String(domain).toLowerCase();
  if (FREEMAIL.has(d)) return true;
  // yahoo.co.uk, hotmail.fr, outlook.de and friends.
  return /^(yahoo|hotmail|outlook|live|gmx|yandex)\.[a-z.]+$/.test(d);
}

export function normalizeEmail(v) {
  if (blank(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[a-z0-9-]{2,}$/i.test(s)) {
    throw new ProfileFieldError("email", "Enter an email address like you@company.com.");
  }
  return s;
}

function personName(field, label) {
  return (v) => {
    if (blank(v)) return null;
    const s = cleanText(v);
    if (s.length > 100) throw new ProfileFieldError(field, `${label} is too long.`);
    if (looksLikeUrlOrEmail(s)) throw new ProfileFieldError(field, `${label} cannot be a link or an email.`);
    return s;
  };
}

export const normalizeFirstName = personName("first_name", "First name");
export const normalizeLastName = personName("last_name", "Last name");

/**
 * A company domain from a domain, a URL or an email address. Lower-case, no
 * scheme, no www., no path, no port. IDNs pass through as typed (the browser
 * gives us punycode or Unicode; both are the same company).
 */
export function normalizeDomain(v) {
  if (blank(v)) return null;
  let s = String(v).trim().toLowerCase();
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0].split(":")[0].replace(/\.$/, "");
  s = s.replace(/^www\d*\./, "");
  const label = "[a-z0-9\\u00a1-\\uffff](?:[a-z0-9\\u00a1-\\uffff-]{0,61}[a-z0-9\\u00a1-\\uffff])?";
  const ok = new RegExp(`^(?:${label}\\.)+(?:[a-z\\u00a1-\\uffff]{2,63}|xn--[a-z0-9-]{1,59})$`);
  if (s.length > 253 || !ok.test(s)) {
    throw new ProfileFieldError("company_domain", "Enter your company's website, like company.com.");
  }
  return s;
}

/** The company domain an email implies, or null when it is a personal mailbox. */
export function domainFromEmail(email) {
  if (blank(email)) return null;
  let domain;
  try {
    domain = normalizeDomain(String(email).split("@").pop());
  } catch {
    return null;
  }
  return isFreemail(domain) ? null : domain;
}

export function normalizeJobTitle(v) {
  if (blank(v)) return null;
  const s = cleanText(v);
  if (s.length > 120) throw new ProfileFieldError("job_title", "Job title is too long.");
  if (/(https?:\/\/|www\.)/i.test(s)) throw new ProfileFieldError("job_title", "Job title cannot be a link.");
  return s;
}

/**
 * The canonical public profile URL: https://www.linkedin.com/in/<slug>.
 * Accepts the full URL with tracking junk, a country subdomain, a bare
 * "linkedin.com/in/x", "in/x", or just the vanity name. Company pages are
 * refused: this field is the person.
 */
export function normalizeLinkedin(v) {
  if (blank(v)) return null;
  const err = () =>
    new ProfileFieldError("linkedin_url", "Enter your LinkedIn profile, like linkedin.com/in/yourname.");
  let s = String(v).trim();
  let slug;
  const bare = s.replace(/^@/, "").replace(/^\/?in\//i, "").replace(/\/$/, "");
  if (!/[.:]/.test(s) && /^[\p{L}\p{N}%_-]{3,100}$/u.test(bare)) {
    slug = bare;
  } else {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
    let url;
    try {
      url = new URL(s);
    } catch {
      throw err();
    }
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) throw err();
    const m = url.pathname.match(/^\/(?:in|pub)\/([^/]+)/i);
    if (!m) throw err();
    slug = m[1];
  }
  try {
    slug = decodeURIComponent(slug);
  } catch {
    throw err();
  }
  slug = slug.toLowerCase();
  if (!/^[\p{L}\p{N}_-]{3,100}$/u.test(slug)) throw err();
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
}

export const NORMALIZERS = Object.freeze({
  email: normalizeEmail,
  first_name: normalizeFirstName,
  last_name: normalizeLastName,
  company_domain: normalizeDomain,
  job_title: normalizeJobTitle,
  linkedin_url: normalizeLinkedin,
});

/**
 * "Ada King Lovelace" -> { first_name: "Ada", last_name: "King Lovelace" }.
 * For backfilling a table that only ever kept a full name. A single word is a
 * first name; nothing is guessed about particles or order.
 */
export function splitFullName(full) {
  if (blank(full)) return { first_name: null, last_name: null };
  const parts = cleanText(full).split(" ");
  return { first_name: parts[0], last_name: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

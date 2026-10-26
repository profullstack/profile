import { COLUMNS, DEFAULT_REQUIRED, FIELD_BY_NAME } from "./fields.js";
import { NORMALIZERS, ProfileFieldError, domainFromEmail } from "./normalize.js";

// Names apps and libraries already send, so a form need not be rewritten
// before it can be validated here.
const ALIASES = {
  firstName: "first_name", given_name: "first_name", givenName: "first_name",
  lastName: "last_name", family_name: "last_name", familyName: "last_name", surname: "last_name",
  companyDomain: "company_domain", company: "company_domain", company_website: "company_domain",
  website: "company_domain", domain: "company_domain",
  jobTitle: "job_title", title: "job_title", position: "job_title",
  linkedinUrl: "linkedin_url", linkedin: "linkedin_url", linkedIn: "linkedin_url",
};

/** Read fields from FormData, URLSearchParams, a Map or a plain object. */
export function readProfileInput(input) {
  const out = {};
  if (!input) return out;
  const entries =
    typeof input.entries === "function" && !(input.constructor === Object)
      ? [...input.entries()]
      : Object.entries(input);
  for (const [rawKey, value] of entries) {
    const key = FIELD_BY_NAME[rawKey] ? rawKey : ALIASES[rawKey];
    // A canonical key wins over an alias for the same field.
    if (!key || (key in out && !FIELD_BY_NAME[rawKey])) continue;
    out[key] = typeof value === "string" || value === null ? value : value?.toString?.() ?? null;
  }
  return out;
}

/**
 * Validate and normalize a profile.
 *
 * - `required`: field names that must be present (default email, first and
 *   last name). Pass `LEAD_REQUIRED` on a B2B signup.
 * - `partial`: an update. Only fields present in the input are checked and
 *   returned, `required` applies only to those, and an explicit empty value
 *   clears the field (returned as null).
 * - `deriveDomain` (default true): a blank company domain is filled from a work
 *   email. Personal mailboxes (gmail, proton, relays) never fill it.
 *
 * Returns `{ ok, profile, errors }`; `errors` maps a field to a message.
 */
export function validateProfile(input, { required = DEFAULT_REQUIRED, partial = false, deriveDomain = true } = {}) {
  const raw = readProfileInput(input);
  const profile = {};
  const errors = {};
  for (const name of COLUMNS) {
    if (partial && !(name in raw)) continue;
    try {
      profile[name] = NORMALIZERS[name](raw[name]);
    } catch (e) {
      if (!(e instanceof ProfileFieldError)) throw e;
      errors[name] = e.message;
    }
  }
  // Not on an update: there the stored domain may be one the person typed, and
  // changing an email address is no reason to overwrite it.
  if (deriveDomain && !partial && !errors.company_domain && !profile.company_domain && profile.email) {
    profile.company_domain = domainFromEmail(profile.email);
  }
  for (const name of required) {
    if (partial && !(name in raw)) continue;
    if (!errors[name] && !profile[name]) errors[name] = `${FIELD_BY_NAME[name]?.label ?? name} is required.`;
  }
  return { ok: Object.keys(errors).length === 0, profile, errors };
}

/** Like validateProfile, but throws a ProfileValidationError carrying `errors`. */
export function parseProfile(input, options) {
  const result = validateProfile(input, options);
  if (!result.ok) throw new ProfileValidationError(result.errors);
  return result.profile;
}

export class ProfileValidationError extends Error {
  constructor(errors) {
    super(Object.values(errors)[0] ?? "Invalid profile.");
    this.name = "ProfileValidationError";
    this.status = 400;
    this.errors = errors;
  }
}

/** Which of `fields` a stored profile is still missing. */
export function missingFields(profile, fields = DEFAULT_REQUIRED) {
  return fields.filter((f) => !profile?.[f]);
}

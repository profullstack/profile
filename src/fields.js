/**
 * The profile contract: six fields, in this order, everywhere.
 *
 * The order is not cosmetic. It is the column order of the CSV every sales tool
 * we feed expects (Explee, Apollo, our own `user-export --full`), so an export
 * from any property can be imported anywhere without remapping. Add a field at
 * the end or not at all.
 */
export const COLUMNS = Object.freeze([
  "email",
  "first_name",
  "last_name",
  "company_domain",
  "job_title",
  "linkedin_url",
]);

/**
 * What a signup form asks for out of the box. Email is the account, and a name
 * is what makes a person out of an address; the rest is asked for, not demanded,
 * because every required box costs signups. A site that sells to companies can
 * require more by passing its own list.
 */
export const DEFAULT_REQUIRED = Object.freeze(["email", "first_name", "last_name"]);

/** The fields a lead needs before an outbound tool will accept it at all. */
export const LEAD_REQUIRED = Object.freeze([
  "email",
  "first_name",
  "last_name",
  "company_domain",
  "job_title",
]);

/**
 * Form metadata. `autocomplete` uses the HTML tokens so browsers and password
 * managers fill the right box; `inputmode` picks a phone keyboard that has the
 * characters the field needs.
 */
export const FIELDS = Object.freeze([
  {
    name: "email",
    label: "Email",
    type: "email",
    autocomplete: "email",
    inputmode: "email",
    maxLength: 254,
    placeholder: "you@company.com",
  },
  {
    name: "first_name",
    label: "First name",
    type: "text",
    autocomplete: "given-name",
    maxLength: 100,
  },
  {
    name: "last_name",
    label: "Last name",
    type: "text",
    autocomplete: "family-name",
    maxLength: 100,
  },
  {
    name: "company_domain",
    label: "Company website",
    type: "text",
    autocomplete: "url",
    inputmode: "url",
    maxLength: 253,
    placeholder: "company.com",
    hint: "Filled from a work email.",
  },
  {
    name: "job_title",
    label: "Job title",
    type: "text",
    autocomplete: "organization-title",
    maxLength: 120,
  },
  {
    name: "linkedin_url",
    label: "LinkedIn",
    type: "url",
    autocomplete: "url",
    inputmode: "url",
    maxLength: 200,
    placeholder: "linkedin.com/in/you",
  },
]);

export const FIELD_BY_NAME = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.name, f])));

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNS,
  LEAD_REQUIRED,
  normalizeDomain,
  normalizeLinkedin,
  normalizeEmail,
  normalizeFirstName,
  normalizeJobTitle,
  domainFromEmail,
  splitFullName,
  validateProfile,
  parseProfile,
  ProfileValidationError,
  missingFields,
  renderProfileFields,
  toCsv,
} from "../src/index.js";

describe("the contract", () => {
  test("columns are the import order sales tools expect", () => {
    assert.deepEqual(COLUMNS, ["email", "first_name", "last_name", "company_domain", "job_title", "linkedin_url"]);
  });
});

describe("company domain", () => {
  for (const [input, want] of [
    ["acme.com", "acme.com"],
    ["https://www.Acme.com/about?x=1", "acme.com"],
    ["http://acme.co.uk:8080", "acme.co.uk"],
    ["@acme.io", "acme.io"],
    ["ada@sub.acme.dev", "sub.acme.dev"],
    ["WWW2.acme.com.", "acme.com"],
    ["münchen.de", "münchen.de"],
  ]) {
    test(`${input} -> ${want}`, () => assert.equal(normalizeDomain(input), want));
  }
  for (const bad of ["acme", "not a domain.com", "http://", "a..com", "-acme.com"]) {
    test(`refuses ${JSON.stringify(bad)}`, () => assert.throws(() => normalizeDomain(bad), /company/));
  }
  test("blank is null, not an error", () => assert.equal(normalizeDomain("  "), null));
});

describe("domain from email", () => {
  test("a work address gives its company", () => assert.equal(domainFromEmail("Ada@Acme.com"), "acme.com"));
  test("personal and relay mailboxes give nothing", () => {
    for (const e of ["a@gmail.com", "a@proton.me", "a@yahoo.co.uk", "a@passmail.net", "a@hotmail.fr", "a@icloud.com"]) {
      assert.equal(domainFromEmail(e), null, e);
    }
  });
});

describe("linkedin", () => {
  const want = "https://www.linkedin.com/in/ada-lovelace";
  for (const input of [
    "https://www.linkedin.com/in/ada-lovelace/",
    "linkedin.com/in/Ada-Lovelace?trk=public_profile",
    "https://uk.linkedin.com/in/ada-lovelace",
    "in/ada-lovelace",
    "ada-lovelace",
    "@ada-lovelace",
    "http://linkedin.com/in/ada-lovelace/details/experience/",
  ]) {
    test(`${input}`, () => assert.equal(normalizeLinkedin(input), want));
  }
  test("unicode vanity names survive", () =>
    assert.equal(normalizeLinkedin("linkedin.com/in/jos%C3%A9-p"), "https://www.linkedin.com/in/jos%C3%A9-p"));
  for (const bad of ["https://linkedin.com/company/acme", "https://evil.com/in/ada", "linkedin.com", "a b"]) {
    test(`refuses ${bad}`, () => assert.throws(() => normalizeLinkedin(bad), /LinkedIn/));
  }
});

describe("names, titles, email", () => {
  test("names keep their case and lose extra space", () => {
    assert.equal(normalizeFirstName("  Mary   Ann "), "Mary Ann");
    assert.equal(normalizeFirstName("McDonald"), "McDonald");
    assert.equal(normalizeFirstName("de la Cruz"), "de la Cruz");
  });
  test("a link in a name is spam", () => {
    assert.throws(() => normalizeFirstName("Win $$$ at http://x.ru"));
    assert.throws(() => normalizeFirstName("bob@spam.com"));
  });
  test("titles", () => {
    assert.equal(normalizeJobTitle(" VP,\tEngineering "), "VP, Engineering");
    assert.throws(() => normalizeJobTitle("see www.x.com"));
  });
  test("email is lower-cased and checked", () => {
    assert.equal(normalizeEmail(" Ada@Acme.COM "), "ada@acme.com");
    assert.throws(() => normalizeEmail("ada@acme"));
  });
  test("splitFullName", () => {
    assert.deepEqual(splitFullName("Ada King Lovelace"), { first_name: "Ada", last_name: "King Lovelace" });
    assert.deepEqual(splitFullName("Cher"), { first_name: "Cher", last_name: null });
  });
});

describe("validateProfile", () => {
  test("a signup with a work email gets its company filled in", () => {
    const r = validateProfile({ email: "ada@acme.com", firstName: "Ada", last_name: "Lovelace" });
    assert.ok(r.ok);
    assert.equal(r.profile.company_domain, "acme.com");
    assert.equal(r.profile.job_title, null);
  });
  test("a typed company beats the email's", () => {
    const r = validateProfile({ email: "ada@gmail.com", first_name: "A", last_name: "L", company_domain: "https://acme.com" });
    assert.equal(r.profile.company_domain, "acme.com");
  });
  test("required fields are reported per field", () => {
    const r = validateProfile({ email: "x" });
    assert.equal(r.ok, false);
    assert.match(r.errors.email, /email/);
    assert.match(r.errors.first_name, /required/);
    assert.match(r.errors.last_name, /required/);
  });
  test("LEAD_REQUIRED asks for title and company", () => {
    const r = validateProfile({ email: "a@gmail.com", first_name: "A", last_name: "B" }, { required: LEAD_REQUIRED });
    assert.deepEqual(Object.keys(r.errors).sort(), ["company_domain", "job_title"]);
  });
  test("partial only touches what was sent, and blank clears", () => {
    const r = validateProfile({ job_title: "CTO", linkedin_url: "" }, { partial: true });
    assert.deepEqual(r.profile, { job_title: "CTO", linkedin_url: null });
  });
  test("partial never derives a domain over a stored one", () => {
    const r = validateProfile({ email: "a@acme.com" }, { partial: true });
    assert.deepEqual(r.profile, { email: "a@acme.com" });
  });
  test("FormData works", () => {
    const fd = new FormData();
    fd.set("email", "a@acme.com");
    fd.set("first_name", "A");
    fd.set("last_name", "B");
    fd.set("linkedin", "in/abc");
    assert.equal(validateProfile(fd).profile.linkedin_url, "https://www.linkedin.com/in/abc");
  });
  test("parseProfile throws with the errors attached", () => {
    try {
      parseProfile({});
      assert.fail("should throw");
    } catch (e) {
      assert.ok(e instanceof ProfileValidationError);
      assert.equal(e.status, 400);
      assert.ok(e.errors.email);
    }
  });
  test("missingFields", () => {
    assert.deepEqual(missingFields({ email: "a@b.co", first_name: "A" }, LEAD_REQUIRED), [
      "last_name",
      "company_domain",
      "job_title",
    ]);
  });
});

describe("rendering", () => {
  test("html fields carry names, autocomplete and errors, escaped", () => {
    const html = renderProfileFields({ values: { first_name: '"><script>' }, errors: { email: "Bad <email>" } });
    assert.match(html, /name="first_name"/);
    assert.match(html, /autocomplete="given-name"/);
    assert.match(html, /autocomplete="organization-title"/);
    assert.match(html, /&quot;&gt;&lt;script&gt;/);
    assert.match(html, /Bad &lt;email&gt;/);
    assert.ok(!html.includes("<script>"));
    assert.match(html, /Job title <span[^>]*>\(optional\)/);
  });
  test("csv keeps order, quotes and defuses formulas", () => {
    const csv = toCsv([{ email: "a@acme.com", first_name: "=HYPERLINK()", last_name: 'O"Neil, Jr', job_title: "-1 CTO" }]);
    assert.equal(
      csv,
      'email,first_name,last_name,company_domain,job_title,linkedin_url\na@acme.com,\'=HYPERLINK(),"O""Neil, Jr",,-1 CTO,\n',
    );
  });
});

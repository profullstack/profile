import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileFields } from "../src/react.js";
import { renderProfileFields } from "../src/index.js";

test("React renders the same fields as the HTML renderer", () => {
  const html = renderToStaticMarkup(createElement(ProfileFields, { errors: { job_title: "Too long" } }));
  for (const n of ["email", "first_name", "last_name", "company_domain", "job_title", "linkedin_url"]) {
    assert.match(html, new RegExp(`name="${n}"`));
    assert.match(renderProfileFields(), new RegExp(`name="${n}"`));
  }
  assert.match(html, /autoComplete="given-name"|autocomplete="given-name"/);
  assert.match(html, /role="alert"[^>]*>Too long/);
  assert.match(html, /<input(?=[^>]*name="email")(?=[^>]*required)/);
});

test("a chosen subset and labels", () => {
  const html = renderToStaticMarkup(
    createElement(ProfileFields, { fields: ["email", "job_title"], labels: { job_title: "Role" } }),
  );
  assert.ok(!html.includes('name="first_name"'));
  assert.match(html, />Role</);
});

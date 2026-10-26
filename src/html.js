/**
 * The signup fields as HTML, for server-rendered pages (Hono, static sites,
 * anything that is not React). Inputs are named by the column, so the posted
 * form goes straight into validateProfile().
 */
import { COLUMNS, DEFAULT_REQUIRED, FIELD_BY_NAME } from "./fields.js";
import { FREEMAIL } from "./normalize.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Options: `values`, `errors` (from validateProfile), `required`, `fields`
 * (which to show, default all six), `idPrefix`, `className` (wrapper class,
 * each row is `${className}__row`), `labels` (override text per field).
 */
export function renderProfileFields({
  values = {},
  errors = {},
  required = DEFAULT_REQUIRED,
  fields = COLUMNS,
  idPrefix = "profile-",
  className = "pfs-profile",
  labels = {},
} = {}) {
  const rows = fields.map((name) => {
    const f = FIELD_BY_NAME[name];
    if (!f) throw new Error(`profile: unknown field ${name}`);
    const id = `${idPrefix}${name}`;
    const req = required.includes(name);
    const err = errors[name];
    const attrs = [
      `id="${esc(id)}"`,
      `name="${name}"`,
      `type="${f.type}"`,
      `autocomplete="${f.autocomplete}"`,
      f.inputmode && `inputmode="${f.inputmode}"`,
      `maxlength="${f.maxLength}"`,
      f.placeholder && `placeholder="${esc(f.placeholder)}"`,
      values[name] != null && `value="${esc(values[name])}"`,
      req && "required",
      err && `aria-invalid="true" aria-describedby="${esc(id)}-error"`,
      name === "email" && "spellcheck=\"false\" autocapitalize=\"off\"",
    ].filter(Boolean);
    return `<div class="${esc(className)}__row" data-field="${name}">
  <label for="${esc(id)}">${esc(labels[name] ?? f.label)}${req ? "" : ` <span class="${esc(className)}__optional">(optional)</span>`}</label>
  <input ${attrs.join(" ")}>${err ? `\n  <p class="${esc(className)}__error" id="${esc(id)}-error" role="alert">${esc(err)}</p>` : ""}
</div>`;
  });
  return `<fieldset class="${esc(className)}">\n${rows.join("\n")}\n</fieldset>`;
}

/**
 * A small script that fills the company box from a work email when the person
 * leaves the email box and the company box is still empty. Inline it once
 * after the form, inside the page's CSP nonce if it has one.
 */
export const PROFILE_ENHANCE_SCRIPT = `(()=>{const free=new Set(${JSON.stringify([...FREEMAIL])});
document.querySelectorAll('input[name="email"]').forEach(e=>{const f=e.form;const d=f&&f.querySelector('input[name="company_domain"]');if(!d)return;
e.addEventListener('blur',()=>{if(d.value.trim())return;const h=(e.value.split('@')[1]||'').trim().toLowerCase();
if(h.includes('.')&&!free.has(h)&&!/^(yahoo|hotmail|outlook|live|gmx|yandex)\\./.test(h))d.value=h;});});})();`;

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
  importOpenProfile = false,
  importEndpoint = "/api/v1/me/profile",
} = {}) {
  const importer = importOpenProfile ? `<div class="${esc(className)}__import" data-pfs-openprofile-import data-endpoint="${esc(importEndpoint)}" style="display:grid;gap:.5rem;margin-bottom:1rem">
  <label for="${esc(`${idPrefix}openprofile-url`)}">Prefill from OpenProfile.md</label>
  <div style="display:flex;flex-wrap:wrap;gap:.5rem">
    <input id="${esc(`${idPrefix}openprofile-url`)}" type="url" autocomplete="url" placeholder="https://example.com/.well-known/openprofile.md" data-pfs-openprofile-url style="flex:1 1 18rem;min-width:0;padding:.5rem .75rem;border:1px solid currentColor;border-radius:.375rem;background:transparent;color:inherit;font:inherit">
    <button type="button" data-pfs-openprofile-button disabled style="padding:.5rem .75rem;border:1px solid currentColor;border-radius:.375rem;background:transparent;color:inherit;font:inherit">Fetch and prefill</button>
  </div>
  <p class="${esc(className)}__import-status" data-pfs-openprofile-status role="status" aria-live="polite" style="min-height:1.25em;margin:0">Fetch to fill the fields, then review or edit them before saving.</p>
</div>` : "";
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
  return `<fieldset class="${esc(className)}">\n${importer}${rows.join("\n")}\n</fieldset>`;
}

/**
 * A small script that fills the company box from a work email when the person
 * leaves the email box and the company box is still empty. Inline it once
 * after the form, inside the page's CSP nonce if it has one.
 */
export const PROFILE_ENHANCE_SCRIPT = `(()=>{const free=new Set(${JSON.stringify([...FREEMAIL])});
document.querySelectorAll('input[name="email"]').forEach(e=>{const f=e.form;const d=f&&f.querySelector('input[name="company_domain"]');if(!d)return;
e.addEventListener('blur',()=>{if(d.value.trim())return;const h=(e.value.split('@')[1]||'').trim().toLowerCase();
if(h.includes('.')&&!free.has(h)&&!/^(yahoo|hotmail|outlook|live|gmx|yandex)\\./.test(h))d.value=h;});});
document.querySelectorAll('[data-pfs-openprofile-import]').forEach(box=>{if(box.dataset.pfsBound)return;box.dataset.pfsBound='1';
const input=box.querySelector('[data-pfs-openprofile-url]');const button=box.querySelector('[data-pfs-openprofile-button]');const status=box.querySelector('[data-pfs-openprofile-status]');const endpoint=box.dataset.endpoint||'/api/v1/me/profile';if(!input||!button||!status)return;
input.addEventListener('input',()=>{button.disabled=!input.value.trim();});button.addEventListener('click',async()=>{button.disabled=true;button.textContent='Fetching…';status.textContent='';status.setAttribute('role','status');
try{const profileUrl=new URL(input.value.trim());if(profileUrl.protocol!=='https:')throw new Error('Use an HTTPS OpenProfile URL.');
const target=new URL(endpoint,location.href);target.searchParams.set('openprofile',profileUrl.href);const response=await fetch(target,{credentials:'same-origin',cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error||'Could not fetch that OpenProfile.md.');
const fields=box.closest('form')||box.parentElement;let count=0;Object.entries(body.profile||{}).forEach(([name,value])=>{if(typeof value!=='string'||!value.trim())return;const field=fields.querySelector('[name="'+name+'"]');if(!field)return;field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));count++;});
if(!count)throw new Error('No contact details were found in that OpenProfile.md.');status.textContent='Fetched. Review or edit the fields before saving.';
}catch(error){status.textContent=error instanceof Error?error.message:'Could not fetch that OpenProfile.md.';status.setAttribute('role','alert');}
finally{button.textContent='Fetch and prefill';button.disabled=!input.value.trim();}});});})();`;

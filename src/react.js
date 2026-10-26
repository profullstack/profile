"use client";
/**
 * <ProfileFields> for React signup forms. Written with createElement so the
 * package needs no JSX build. Renders the same markup as renderProfileFields,
 * so one stylesheet serves both.
 *
 * Uncontrolled by default (inputs post with the form, or read them with
 * FormData); pass `values` and `onChange(values)` to control it.
 */
import { createElement as h, useRef } from "react";
import { COLUMNS, DEFAULT_REQUIRED, FIELD_BY_NAME } from "./fields.js";
import { domainFromEmail } from "./normalize.js";

export function ProfileFields({
  values,
  defaultValues = {},
  onChange,
  errors = {},
  required = DEFAULT_REQUIRED,
  fields = COLUMNS,
  idPrefix = "profile-",
  className = "pfs-profile",
  labels = {},
  disabled = false,
}) {
  const domainRef = useRef(null);
  const controlled = values !== undefined && typeof onChange === "function";

  const onEmailBlur = (e) => {
    const derived = domainFromEmail(e.target.value);
    if (!derived) return;
    if (controlled) {
      if (!values.company_domain) onChange({ ...values, company_domain: derived });
    } else if (domainRef.current && !domainRef.current.value.trim()) {
      domainRef.current.value = derived;
    }
  };

  return h(
    "fieldset",
    { className, disabled },
    fields.map((name) => {
      const f = FIELD_BY_NAME[name];
      const id = `${idPrefix}${name}`;
      const req = required.includes(name);
      const err = errors[name];
      const input = {
        id,
        name,
        type: f.type,
        autoComplete: f.autocomplete,
        inputMode: f.inputmode,
        maxLength: f.maxLength,
        placeholder: f.placeholder,
        required: req,
        "aria-invalid": err ? true : undefined,
        "aria-describedby": err ? `${id}-error` : undefined,
        ref: name === "company_domain" ? domainRef : undefined,
        onBlur: name === "email" ? onEmailBlur : undefined,
      };
      if (name === "email") Object.assign(input, { spellCheck: false, autoCapitalize: "off" });
      if (controlled) {
        input.value = values[name] ?? "";
        input.onChange = (e) => onChange({ ...values, [name]: e.target.value });
      } else {
        input.defaultValue = defaultValues[name] ?? undefined;
      }
      return h(
        "div",
        { key: name, className: `${className}__row`, "data-field": name },
        h(
          "label",
          { htmlFor: id },
          labels[name] ?? f.label,
          req ? null : h("span", { className: `${className}__optional` }, " (optional)"),
        ),
        h("input", input),
        err ? h("p", { id: `${id}-error`, className: `${className}__error`, role: "alert" }, err) : null,
      );
    }),
  );
}

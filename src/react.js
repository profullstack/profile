"use client";
/**
 * <ProfileFields> for React signup forms. Written with createElement so the
 * package needs no JSX build. Renders the same markup as renderProfileFields,
 * so one stylesheet serves both.
 *
 * Uncontrolled by default (inputs post with the form, or read them with
 * FormData); pass `values` and `onChange(values)` to control it.
 */
import { createElement as h, useRef, useState } from "react";
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
  importOpenProfile = false,
  importEndpoint = "/api/v1/me/profile",
  importOpenProfileFetcher,
}) {
  const domainRef = useRef(null);
  const fieldsetRef = useRef(null);
  const controlled = values !== undefined && typeof onChange === "function";
  const [profileUrl, setProfileUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState(null);

  const fetchOpenProfile = async () => {
    setImporting(true);
    setImportMessage(null);
    try {
      const url = new URL(profileUrl.trim());
      if (url.protocol !== "https:") throw new Error("Use an HTTPS OpenProfile URL.");
      let profile;
      if (typeof importOpenProfileFetcher === "function") {
        profile = await importOpenProfileFetcher(url.toString());
      } else {
        const endpoint = new URL(importEndpoint, window.location.href);
        endpoint.searchParams.set("openprofile", url.toString());
        const response = await fetch(endpoint.toString(), { credentials: "same-origin", cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not fetch that OpenProfile.md.");
        profile = body.profile;
      }
      const imported = Object.fromEntries(
        COLUMNS.filter((name) => typeof profile?.[name] === "string" && profile[name].trim())
          .map((name) => [name, profile[name]]),
      );
      if (Object.keys(imported).length === 0) throw new Error("No contact details were found in that OpenProfile.md.");

      if (controlled) onChange({ ...values, ...imported });
      else {
        for (const [name, value] of Object.entries(imported)) {
          const input = fieldsetRef.current?.querySelector(`[name="${name}"]`);
          if (!input) continue;
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      setImportMessage({ ok: true, text: "Fetched. Review or edit the fields before saving." });
    } catch (error) {
      setImportMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Could not fetch that OpenProfile.md.",
      });
    } finally {
      setImporting(false);
    }
  };

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
    { className, disabled: disabled || importing, ref: fieldsetRef },
    importOpenProfile
      ? h(
          "div",
          { className: `${className}__import`, style: { display: "grid", gap: "0.5rem", marginBottom: "1rem" } },
          h("label", { htmlFor: `${idPrefix}openprofile-url` }, "Prefill from OpenProfile.md"),
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: "0.5rem" } },
            h("input", {
              id: `${idPrefix}openprofile-url`,
              className: `${className}__import-url`,
              type: "url",
              autoComplete: "url",
              placeholder: "https://example.com/.well-known/openprofile.md",
              value: profileUrl,
              onChange: (event) => setProfileUrl(event.target.value),
              style: {
                flex: "1 1 18rem",
                minWidth: 0,
                padding: "0.5rem 0.75rem",
                border: "1px solid currentColor",
                borderRadius: "0.375rem",
                background: "transparent",
                color: "inherit",
                font: "inherit",
              },
            }),
            h(
              "button",
              {
                type: "button",
                onClick: () => void fetchOpenProfile(),
                disabled: !profileUrl.trim(),
                style: {
                  padding: "0.5rem 0.75rem",
                  border: "1px solid currentColor",
                  borderRadius: "0.375rem",
                  background: "transparent",
                  color: "inherit",
                  font: "inherit",
                  cursor: profileUrl.trim() ? "pointer" : "not-allowed",
                },
              },
              importing ? "Fetching…" : "Fetch and prefill",
            ),
          ),
          h(
            "p",
            {
              className: `${className}__import-status`,
              role: importMessage?.ok === false ? "alert" : "status",
              "aria-live": "polite",
              style: { minHeight: "1.25em", margin: 0 },
            },
            importMessage?.text ?? "Fetch to fill the fields, then review or edit them before saving.",
          ),
        )
      : null,
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

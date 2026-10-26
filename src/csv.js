/**
 * CSV in the contract's column order, which is what Explee, Apollo and our own
 * `user-export --full` read, so an export from any property imports anywhere.
 */
import { COLUMNS } from "./fields.js";

// A cell a spreadsheet would run as a formula gets a leading apostrophe.
const FORMULA = /^[=+@\t\r]|^-(?![\d.])/;

export function csvCell(v, delimiter = ",") {
  if (v == null) return "";
  let s = String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvHeader({ columns = COLUMNS, delimiter = "," } = {}) {
  return columns.join(delimiter);
}

export function csvRow(profile, { columns = COLUMNS, delimiter = "," } = {}) {
  return columns.map((c) => csvCell(profile?.[c], delimiter)).join(delimiter);
}

export function toCsv(profiles, opts = {}) {
  return [csvHeader(opts), ...profiles.map((p) => csvRow(p, opts))].join("\n") + "\n";
}

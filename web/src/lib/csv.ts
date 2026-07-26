/**
 * RFC 4180 CSV encoding. Small enough to inline everywhere the app writes a
 * CSV response, but centralized once so escaping rules (the part that's easy
 * to get subtly wrong) live in one place.
 */

/** Quotes a single field only when it needs it (contains a comma, quote, or
 *  line break), doubling any internal quotes. Leaves plain fields bare so the
 *  common case stays readable. */
export function csvField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** One CSV row (no trailing newline — callers control the line ending so a
 *  stream writer can pick \n consistently regardless of platform). */
export function csvRow(fields: Array<string | number | null | undefined>): string {
  return fields.map(csvField).join(",");
}

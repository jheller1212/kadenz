import { describe, expect, it } from "vitest";
import { csvField, csvRow } from "../csv";

describe("csvField", () => {
  it("leaves a plain field bare", () => {
    expect(csvField("easy run")).toBe("easy run");
    expect(csvField(5.2)).toBe("5.2");
  });

  it("returns an empty string for null/undefined", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes a field containing a comma", () => {
    expect(csvField("tempo, 10k")).toBe('"tempo, 10k"');
  });

  it("quotes and doubles internal quotes", () => {
    expect(csvField('felt "great" today')).toBe('"felt ""great"" today"');
  });

  it("quotes a field containing a newline", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a field containing a carriage return", () => {
    expect(csvField("line one\r\nline two")).toBe('"line one\r\nline two"');
  });

  it("quotes a field with both a comma and a quote", () => {
    expect(csvField('5k, "the fast one"')).toBe('"5k, ""the fast one"""');
  });
});

describe("csvRow", () => {
  it("joins fields with commas", () => {
    expect(csvRow(["2026-07-24T00:00:00.000Z", "easy", 5, 1800])).toBe(
      "2026-07-24T00:00:00.000Z,easy,5,1800"
    );
  });

  it("escapes only the fields that need it, leaving the rest bare", () => {
    expect(csvRow(["10k, personal best", 42.2, "felt \"great\""])).toBe(
      '"10k, personal best",42.2,"felt ""great"""'
    );
  });

  it("round-trips a row through a minimal CSV parser", () => {
    // A tiny RFC 4180 parser, just enough to prove the escaping above
    // survives being read back rather than merely looking plausible.
    function parseCsvLine(line: string): string[] {
      const fields: string[] = [];
      let i = 0;
      while (i <= line.length) {
        if (line[i] === '"') {
          let field = "";
          i++;
          while (i < line.length) {
            if (line[i] === '"' && line[i + 1] === '"') {
              field += '"';
              i += 2;
            } else if (line[i] === '"') {
              i++;
              break;
            } else {
              field += line[i];
              i++;
            }
          }
          fields.push(field);
          i++; // skip the following comma, if any
        } else {
          const next = line.indexOf(",", i);
          const end = next === -1 ? line.length : next;
          fields.push(line.slice(i, end));
          i = end + 1;
        }
      }
      return fields;
    }

    const original = ['comma, here', 'quote " here', "plain"];
    const line = csvRow(original);
    expect(parseCsvLine(line)).toEqual(original);
  });
});

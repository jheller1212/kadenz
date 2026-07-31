import { describe, expect, it } from "vitest";
import { mergeTokenBlocks, parseCssTokens } from "../parseTokens";

const FIXTURE = `:root {
  --k-bg: #0B0B0F;
  --k-danger: #E03A3A;
  --k-shadow-card:
    0 1px 1px rgba(0,0,0,0.03),
    0 2px 6px rgba(0,0,0,0.05);
}

html.light {
  --k-bg: #F4F4EE;
  --k-danger: #FF0000;
}

.some-override {
  --k-bg: #FF00FF;
}
`;

describe("parseCssTokens", () => {
  const blocks = parseCssTokens(FIXTURE);

  it("finds the :root and html.light blocks, not the indented override", () => {
    expect(blocks.map((b) => b.selector)).toEqual([":root", "html.light"]);
  });

  it("reports a known-present token with its line", () => {
    const root = blocks.find((b) => b.selector === ":root")!;
    const bg = root.tokens.find((t) => t.name === "--k-bg");
    expect(bg).toBeDefined();
    expect(bg!.value).toBe("#0B0B0F");
    expect(bg!.line).toBe(2);
  });

  it("collects a multi-line value up to the terminating semicolon", () => {
    const root = blocks.find((b) => b.selector === ":root")!;
    const shadow = root.tokens.find((t) => t.name === "--k-shadow-card");
    expect(shadow).toBeDefined();
    expect(shadow!.value).toContain("0 1px 1px rgba(0,0,0,0.03)");
    expect(shadow!.value).toContain("0 2px 6px rgba(0,0,0,0.05)");
  });

  it("does not report a token that was never declared", () => {
    const root = blocks.find((b) => b.selector === ":root")!;
    expect(root.tokens.find((t) => t.name === "--k-does-not-exist")).toBeUndefined();
  });

  it("merges light and dark values per token by selector", () => {
    const dark = mergeTokenBlocks(blocks, ":root");
    const light = mergeTokenBlocks(blocks, "html.light");
    expect(dark.get("--k-danger")?.value).toBe("#E03A3A");
    expect(light.get("--k-danger")?.value).toBe("#FF0000");
  });
});

// Pure parser for the `--k-*` / `--vi-*` design tokens declared in
// globals.css. Only top-level, unindented selector blocks are tracked
// (":root", "html.light", and any other bare selector at column 0); nested
// or indented rules (media queries, .k-dark-surface overrides) are
// deliberately out of scope because they are element-level overrides, not
// the theme's base token set the design brief transcribes by hand.

export interface TokenDef {
  name: string;
  value: string;
  /** 1-based line number of the declaration. */
  line: number;
}

export interface TokenBlock {
  selector: string;
  line: number;
  tokens: TokenDef[];
}

const SELECTOR_START = /^(:root|html\.[\w-]+)\s*\{\s*$/;
const TOKEN_LINE = /^\s*(--[\w-]+):\s*(.*)$/;

/** Parses top-level `:root` / `html.light` blocks and the custom properties inside them. */
export function parseCssTokens(source: string): TokenBlock[] {
  const lines = source.split("\n");
  const blocks: TokenBlock[] = [];
  let current: TokenBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!current) {
      const selMatch = SELECTOR_START.exec(line);
      if (selMatch) current = { selector: selMatch[1], line: i + 1, tokens: [] };
      continue;
    }

    if (line.trim() === "}") {
      blocks.push(current);
      current = null;
      continue;
    }

    const tokenMatch = TOKEN_LINE.exec(line);
    if (!tokenMatch) continue;

    const [, name] = tokenMatch;
    const startLine = i + 1;
    let value = tokenMatch[2];
    // A declaration's value can span multiple lines (multi-shadow
    // box-shadow values, gradients with a comment). Keep consuming lines
    // until we see the terminating semicolon.
    while (!/;\s*$/.test(value) && i + 1 < lines.length) {
      i++;
      value += " " + lines[i].trim();
    }
    value = value.replace(/;\s*$/, "").trim();

    current.tokens.push({ name, value, line: startLine });
  }

  return blocks;
}

/** Merges same-selector blocks into a name -> definition map, later declarations winning (CSS cascade order within one effective scope). */
export function mergeTokenBlocks(blocks: TokenBlock[], selector: string): Map<string, TokenDef> {
  const merged = new Map<string, TokenDef>();
  for (const block of blocks) {
    if (block.selector !== selector) continue;
    for (const token of block.tokens) merged.set(token.name, token);
  }
  return merged;
}

// Generates the iOS `apple-touch-startup-image` PNGs into public/splash/.
//
// iOS home-screen PWAs ignore the manifest's splash fields, so pixel control
// needs one PNG per device resolution. Run this only when the splash design
// changes; the output is committed, never generated at build time.
//
//   npm run splash:generate
//
// sharp is not declared here on purpose: next depends on it, and declaring it
// meant regenerating the lockfile, which this npm version rewrites wholesale
// (dropping ~500 lines of other platforms' optional binaries). If a future
// install stops hoisting it, add sharp to devDependencies.
//
// The mark is composited from public/icon-512.png rather than re-rendered from
// the SVG so the launch screen is pixel-identical to the home-screen icon the
// user just tapped. Its ink squircle is the same colour as the canvas, so only
// the volt K reads — which is the intent: the badge is invisible here.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(root, "public", "splash");
const MARK = path.join(root, "public", "icon-512.png");

// Must stay in sync with SPLASH_BG in src/components/BootSplash.tsx and the
// manifest's background_color.
const BG = "#0A0A0B";
const TAGLINE = "Running, structured.";
const TAGLINE_COLOR = "#83838F"; // --k-text-3 (dark)

// Design reference frame: 430 × 932 logical px (iPhone 15 Pro Max).
const REF_W = 430;
const LOGO = 150;
const TAGLINE_BOTTOM = 58;
const TAGLINE_SIZE = 13;

// Portrait only — the manifest pins orientation to portrait.
// [logical width, logical height, devicePixelRatio]
const DEVICES = [
  [440, 956, 3], // iPhone 16 Pro Max
  [430, 932, 3], // iPhone 16 Plus / 15 Pro Max / 14 Pro Max
  [402, 874, 3], // iPhone 16 Pro
  [393, 852, 3], // iPhone 16 / 15 / 14 Pro
  [428, 926, 3], // iPhone 14 Plus / 13 Pro Max / 12 Pro Max
  [390, 844, 3], // iPhone 14 / 13 / 12
  [375, 812, 3], // iPhone 13 mini / 12 mini / X / XS / 11 Pro
  [414, 896, 3], // iPhone XS Max / 11 Pro Max
  [414, 896, 2], // iPhone XR / 11
  [414, 736, 3], // iPhone 8 Plus
  [375, 667, 2], // iPhone SE (2nd/3rd gen) / 8
  [320, 568, 2], // iPhone SE (1st gen)
  [1024, 1366, 2], // iPad Pro 12.9"
  [834, 1194, 2], // iPad Pro 11"
  [834, 1112, 2], // iPad Air 10.5"
  [810, 1080, 2], // iPad 10.2"
  [768, 1024, 2], // iPad mini / Air 9.7"
];

/** Scales the layout up a little on tablets without ballooning it. */
const scaleFor = (w) => Math.min(1.6, Math.max(1, w / REF_W));

async function build([w, h, dpr]) {
  const s = scaleFor(w);
  const px = (v) => Math.round(v * s * dpr);
  const W = w * dpr;
  const H = h * dpr;
  const logo = px(LOGO);

  const mark = await sharp(MARK).resize(logo, logo).toBuffer();

  // Tagline is drawn as SVG text: no webfont is available to the rasteriser,
  // and this is a sub-second static image, so the system grotesque is fine.
  const fontSize = px(TAGLINE_SIZE);
  const tagline = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${fontSize * 2}">` +
      `<text x="50%" y="${fontSize}" text-anchor="middle" ` +
      `font-family="Helvetica Neue, Helvetica, Arial, sans-serif" ` +
      `font-size="${fontSize}" font-weight="600" letter-spacing="${0.2 * s * dpr}" ` +
      `fill="${TAGLINE_COLOR}">${TAGLINE}</text></svg>`,
  );

  const name = `splash-${W}x${H}.png`;
  await sharp({
    create: { width: W, height: H, channels: 4, background: BG },
  })
    .composite([
      { input: mark, top: Math.round((H - logo) / 2), left: Math.round((W - logo) / 2) },
      { input: tagline, top: H - px(TAGLINE_BOTTOM) - fontSize, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, name));

  return { name, w, h, dpr, W, H };
}

await mkdir(OUT_DIR, { recursive: true });
const built = [];
for (const d of DEVICES) built.push(await build(d));

// Emit the <link> list as JSON so layout.tsx never drifts from what exists on
// disk — regenerating the images regenerates the markup that references them.
await writeFile(
  path.join(OUT_DIR, "index.json"),
  JSON.stringify(
    built.map(({ name, w, h, dpr }) => ({
      href: `/splash/${name}`,
      media:
        `(device-width: ${w}px) and (device-height: ${h}px) and ` +
        `(-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
    })),
    null,
    2,
  ) + "\n",
);

console.log(`Generated ${built.length} splash images in public/splash/`);

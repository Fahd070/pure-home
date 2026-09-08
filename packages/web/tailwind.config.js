/**
 * The web build's own, separate Tailwind pipeline. It must resolve every
 * token-bound utility (bg-canvas, text-fg, h-commandbar, z-drawer, text-2xs,
 * the ph-radius/ph-shadow scale, …) exactly the way packages/unified-app's
 * Tailwind config does — every component under unified-app/src/ui/ and every
 * redesigned page is written against those classes, and they only exist if
 * this config extends the same theme. Sharing the object (not retyping it)
 * is what keeps the two builds from drifting apart.
 *
 * Base typography is applied directly to `body` in the shared globals.css
 * via `font-family: var(--ph-font)`, not through a `font-sans` utility class,
 * so there is nothing to override here — see web.css for the web-specific
 * --ph-font value (it leads with Cairo, the webfont this app actually loads,
 * ahead of the desktop stack's Windows-first choice).
 */
const desktopConfig = require("../unified-app/tailwind.config.js");

module.exports = {
  content: [
    "../unified-app/src/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./index.html",
  ],
  theme: {
    extend: { ...desktopConfig.theme.extend },
  },
  plugins: [],
};

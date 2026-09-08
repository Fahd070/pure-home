/**
 * Pure Home design system -- Tailwind is bound to the CSS custom properties in
 * src/ui/tokens.css rather than to literal palette values, so theme, contrast
 * and density settings switch every surface at once with no class churn.
 */
module.exports = {
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--ph-font)"],
        mono: ["var(--ph-font-mono)"],
      },
      colors: {
        canvas: "var(--ph-canvas)",
        surface: {
          DEFAULT: "var(--ph-surface)",
          raised:  "var(--ph-surface-raised)",
          subtle:  "var(--ph-surface-subtle)",
          hover:   "var(--ph-surface-hover)",
          active:  "var(--ph-surface-active)",
        },
        nav: {
          DEFAULT:  "var(--ph-nav-bg)",
          fg:       "var(--ph-nav-fg)",
          muted:    "var(--ph-nav-fg-muted)",
          hover:    "var(--ph-nav-hover)",
          active:   "var(--ph-nav-active-bg)",
          activefg: "var(--ph-nav-active-fg)",
        },
        titlebar: {
          DEFAULT: "var(--ph-titlebar-bg)",
          fg:      "var(--ph-titlebar-fg)",
          border:  "var(--ph-titlebar-border)",
        },
        line: {
          DEFAULT: "var(--ph-border)",
          subtle:  "var(--ph-border-subtle)",
          strong:  "var(--ph-border-strong)",
        },
        fg: {
          DEFAULT:   "var(--ph-fg)",
          secondary: "var(--ph-fg-secondary)",
          muted:     "var(--ph-fg-muted)",
          inverse:   "var(--ph-fg-inverse)",
        },
        accent: {
          DEFAULT:   "var(--ph-accent)",
          hover:     "var(--ph-accent-hover)",
          pressed:   "var(--ph-accent-pressed)",
          fg:        "var(--ph-accent-fg)",
          subtle:    "var(--ph-accent-subtle)",
          subtlefg:  "var(--ph-accent-subtle-fg)",
          border:    "var(--ph-accent-border)",
        },
        success:  { bg: "var(--ph-success-bg)",  fg: "var(--ph-success-fg)",  border: "var(--ph-success-border)",  solid: "var(--ph-success-solid)" },
        warning:  { bg: "var(--ph-warning-bg)",  fg: "var(--ph-warning-fg)",  border: "var(--ph-warning-border)",  solid: "var(--ph-warning-solid)" },
        danger:   { bg: "var(--ph-danger-bg)",   fg: "var(--ph-danger-fg)",   border: "var(--ph-danger-border)",   solid: "var(--ph-danger-solid)" },
        info:     { bg: "var(--ph-info-bg)",     fg: "var(--ph-info-fg)",     border: "var(--ph-info-border)",     solid: "var(--ph-info-solid)" },
        urgent:   { bg: "var(--ph-urgent-bg)",   fg: "var(--ph-urgent-fg)",   border: "var(--ph-urgent-border)",   solid: "var(--ph-urgent-solid)" },
        pending:  { bg: "var(--ph-pending-bg)",  fg: "var(--ph-pending-fg)",  border: "var(--ph-pending-border)",  solid: "var(--ph-pending-solid)" },
        progress: { bg: "var(--ph-progress-bg)", fg: "var(--ph-progress-fg)", border: "var(--ph-progress-border)", solid: "var(--ph-progress-solid)" },
        neutral:  { bg: "var(--ph-neutral-bg)",  fg: "var(--ph-neutral-fg)",  border: "var(--ph-neutral-border)",  solid: "var(--ph-neutral-solid)" },
      },
      borderRadius: {
        sm: "var(--ph-radius-sm)",
        DEFAULT: "var(--ph-radius-sm)",
        md: "var(--ph-radius-md)",
        lg: "var(--ph-radius-lg)",
      },
      boxShadow: {
        sm: "var(--ph-shadow-sm)",
        DEFAULT: "var(--ph-shadow-sm)",
        md: "var(--ph-shadow-md)",
        lg: "var(--ph-shadow-lg)",
      },
      spacing: {
        row: "var(--ph-row-h)",
        control: "var(--ph-control-h)",
        titlebar: "var(--ph-titlebar-h)",
        commandbar: "var(--ph-commandbar-h)",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      zIndex: {
        drawer: "60",
        dialog: "70",
        toast: "90",
      },
    },
  },
  plugins: [],
};

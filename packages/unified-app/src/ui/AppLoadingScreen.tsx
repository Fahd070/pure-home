import React from "react";
import { cx } from "./cx";

const logoUrl = new URL("../../assets/icon.png", import.meta.url).href;

/**
 * Full-surface transition shown while the app is establishing a department
 * session -- the moment between submitting an access code and the workspace
 * being ready.
 *
 * This is PRESENTATION ONLY. It renders whenever the caller is already in its
 * existing loading state; it does not perform, delay, gate or observe any
 * authentication work, and removing it would change nothing but the pixels.
 *
 * Restraint is the point: two slow, shallow movements (a breathing mark and a
 * single rotating arc) on a plain application surface. No particles, no
 * gradients, no scaling logo, no bouncing. It should read as a desktop
 * application preparing itself, not as a splash animation.
 *
 * Both movements are infinite, so `prefers-reduced-motion` (handled globally)
 * reduces this to a still logo above the label -- which is still a correct,
 * legible loading state.
 */
export function AppLoadingScreen({
  label, sublabel, className,
}: {
  /** Primary line under the mark. Defaults to a bilingual "Loading". */
  label?: React.ReactNode;
  /** Optional second line -- e.g. which workspace is being opened. */
  sublabel?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cx(
        "fixed inset-0 z-toast flex flex-col items-center justify-center bg-canvas",
        "ph-scrim-enter select-none",
        className
      )}
    >
      <div className="relative flex items-center justify-center">
        {/* Arc: a single accent segment on an otherwise neutral ring, turning
            slowly. Sized off the mark so it stays concentric at any density. */}
        <span
          aria-hidden="true"
          className={cx(
            "absolute w-[104px] h-[104px] rounded-full",
            "border-2 border-line border-t-accent",
            "animate-[ph-orbit_1.6s_linear_infinite]"
          )}
        />

        {/* The mark itself only breathes -- opacity plus a sub-2% scale. */}
        <img
          src={logoUrl}
          alt=""
          className="w-16 h-16 object-contain rounded-lg animate-[ph-breathe_2.8s_ease-in-out_infinite]"
        />
      </div>

      <p className="mt-7 text-sm font-medium text-fg tracking-tight">
        {label ?? "Loading"}
      </p>

      {sublabel && (
        <p className="mt-1 text-2xs text-fg-muted">{sublabel}</p>
      )}
    </div>
  );
}

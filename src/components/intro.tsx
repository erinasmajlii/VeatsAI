"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo, LogoBolt } from "./brand";
import { useT } from "./i18n";

const SEEN_KEY = "veats-intro";

/** A jagged "electric arc" from the bolt outwards, in a 200×200 box centred on the bolt. */
function ray(angleDeg: number, seed: number): string {
  const steps: [number, number][] = [[20, 0], [36, 5], [50, -6], [66, 5], [80, -4], [98, 0]];
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return steps
    .map(([r, off], i) => {
      const o = off * (1 + ((seed + i) % 3) * 0.25);
      const x = r * c - o * s;
      const y = r * s + o * c;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
const RAYS = Array.from({ length: 10 }, (_, i) => ({ d: ray(i * 36 + (i % 2 ? 7 : 0), i), delay: -((i * 0.37) % 0.95) }));

/**
 * First-page intro: the VEATSAI bolt is centred and spins two full turns (720°) while electrical signals
 * (pulse rings + travelling arcs) radiate from it; the signals fade, the full logo scales in, and a
 * "Continue to Login" button slides up. All colours come from the theme tokens, so it works in light and dark.
 * Only transform / opacity / stroke-dashoffset are animated (GPU friendly). Skipped for reduced motion users
 * (logo + button immediately) and for the rest of the browser session after the first visit.
 */
export function Intro() {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<"pending" | "play" | "logo" | "done" | "hidden">("pending");

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {}
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("hidden");
      return;
    }
    if (reduced) {
      setPhase("done");
      return;
    }
    setPhase("play");
    const toLogo = setTimeout(() => setPhase("logo"), 3500); // signals and bolt are removed from the DOM
    const toDone = setTimeout(() => setPhase("done"), 4450); // the logo has finished appearing → show the button
    return () => {
      clearTimeout(toLogo);
      clearTimeout(toDone);
    };
  }, []);

  // the page behind the intro must not scroll while it is showing
  const hidden = phase === "hidden";
  useEffect(() => {
    if (hidden) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = prev; };
  }, [hidden]);

  function proceed() {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    router.push("/login");
  }

  if (phase === "hidden") return null;
  const started = phase !== "pending";

  return (
    <div className="intro-gate fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-background text-foreground" role="dialog" aria-label="VEATSAI">
      {phase === "play" && (
        <div className="intro-stage pointer-events-none absolute grid place-items-center" aria-hidden>
          <div className="intro-signals absolute inset-0">
            {[0, 1, 2].map((i) => (
              <span key={i} className="intro-ring" style={{ animationDelay: `${0.3 + i * 0.38}s` }} />
            ))}
            <svg viewBox="-100 -100 200 200" className="intro-spin absolute inset-0 h-full w-full overflow-visible">
              {RAYS.map((r, i) => (
                <path key={i} d={r.d} pathLength={100} className="intro-ray" style={{ animationDelay: `${r.delay}s` }} />
              ))}
            </svg>
          </div>
          <div className="intro-bolt-wrap">
            <LogoBolt className="intro-spin block h-auto w-[clamp(84px,19vmin,170px)]" />
          </div>
        </div>
      )}

      {started && (
        <div className="intro-logo relative">
          <Logo className="h-auto w-[min(78vw,480px)]" title="VEATSAI" />
          {phase === "done" && (
            <div className="absolute left-0 right-0 top-full mt-10 flex justify-center">
              <button type="button" onClick={proceed} autoFocus className="intro-cta btn-primary px-7 py-3 text-sm">
                {t("intro.continue")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

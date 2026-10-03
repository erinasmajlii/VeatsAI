/** Minimal 24px stroke icons (no icon dependency). */

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const PATHS = {
  dashboard: "M4 4h6v8H4z M14 4h6v5h-6z M14 13h6v7h-6z M4 16h6v4H4z",
  projects: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  requests: "M4 5h16v14H4z M12 9v6 M9 12h6",
  quotes: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6",
  inventory: "M12 3l9 4.5v9L12 21l-9-4.5v-9L12 3z M3 7.5l9 4.5 9-4.5 M12 12v9",
  standards: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z M5 17a3 3 0 013-3h11",
  about: "M12 21a9 9 0 100-18 9 9 0 000 18z M12 11v6 M12 7.5v.01",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "M6 6l12 12 M18 6L6 18",
  chat: "M4 5h16v11H9l-5 4V5z",
  logout: "M10 5H5v14h5 M15 8l4 4-4 4 M19 12H9",
  check: "M5 12.5l4.5 4.5L19 7.5",
  upload: "M12 16V4 M7 9l5-5 5 5 M5 20h14",
  file: "M7 3h7l5 5v13H7z M14 3v5h5",
  plus: "M12 5v14 M5 12h14",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
  send: "M12 19V6 M6 12l6-6 6 6",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

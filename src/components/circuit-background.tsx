/**
 * Subtle circuit / signal background for the landing hero: thin circuit traces with soft signal pulses travelling
 * along them and a few glowing nodes. Pure SVG + CSS (stroke-dashoffset / opacity only), faded towards the text.
 */

const TRACES: { d: string; delay: number; dur: number }[] = [
  { d: "M120 90 L300 90 L300 170 L520 170 L520 110 L760 110 L760 200 L1000 200", delay: 0, dur: 9 },
  { d: "M0 260 L220 260 L220 330 L460 330 L460 250 L700 250 L700 360 L1000 360", delay: -3, dur: 11 },
  { d: "M180 520 L380 520 L380 440 L640 440 L640 520 L860 520 L860 430 L1000 430", delay: -6, dur: 10 },
  { d: "M420 0 L420 60 L580 60 L580 140 L860 140 L860 60 L1000 60", delay: -2, dur: 8 },
  { d: "M560 600 L560 540 L700 540 L700 470 L960 470 L960 560 L1000 560", delay: -5, dur: 12 },
  { d: "M60 400 L140 400 L140 470 L300 470 L300 390 L420 390 L420 330", delay: -8, dur: 9 },
];
const NODES: [number, number, number][] = [
  [300, 170, 0], [520, 110, 1.1], [760, 200, 2.2], [460, 330, 0.6], [700, 360, 1.7], [640, 440, 2.8], [860, 140, 0.9], [220, 330, 2.4], [380, 440, 1.4], [700, 470, 0.3],
];

export function CircuitBackground() {
  return (
    <svg
      className="pointer-events-none absolute inset-y-0 right-0 h-full w-[min(100%,1000px)] [mask-image:linear-gradient(to_left,black_40%,transparent_92%)]"
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMaxYMid slice"
      aria-hidden
    >
      <g>
        <circle cx="900" cy="300" r="120" className="circuit-ring" />
        <circle cx="900" cy="300" r="230" className="circuit-ring" />
        <circle cx="900" cy="300" r="350" className="circuit-ring" />
      </g>
      {TRACES.map((t, i) => (
        <path key={`t${i}`} d={t.d} className="circuit-trace" />
      ))}
      {TRACES.map((t, i) => (
        <path key={`s${i}`} d={t.d} pathLength={200} className="circuit-signal" style={{ animationDelay: `${t.delay}s`, animationDuration: `${t.dur}s` }} />
      ))}
      {NODES.map(([x, y, d], i) => (
        <circle key={i} cx={x} cy={y} r={3.2} className="circuit-node" style={{ animationDelay: `${d}s` }} />
      ))}
    </svg>
  );
}

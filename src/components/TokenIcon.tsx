import type { ClassicToken, NaijaToken, PlayerToken } from "@/game/types";
import { isClassicToken } from "@/lib/tokens";

// Original artwork: plain geometric silhouettes built from basic shapes
// (rects/circles/polygons), not traced from or resembling any existing
// game's pieces — generic representations of the object named by the
// token id, nothing more.
const CLASSIC_TOKEN_SHAPES: Record<ClassicToken, React.ReactNode> = {
  tophat: (
    <>
      <rect x="4" y="16" width="16" height="2.4" rx="1.2" />
      <rect x="7" y="4.5" width="10" height="11.5" rx="0.6" />
    </>
  ),
  racecar: (
    <>
      <rect x="3" y="11" width="18" height="4.5" rx="1.5" />
      <polygon points="7,11 9.5,7 15,7 17,11" />
      <circle cx="7" cy="16.8" r="1.9" />
      <circle cx="17" cy="16.8" r="1.9" />
    </>
  ),
  dog: (
    <>
      <ellipse cx="12" cy="15.5" rx="5.5" ry="4" />
      <circle cx="7.5" cy="9.5" r="3.2" />
      <circle cx="5.2" cy="11.2" r="1.7" />
      <ellipse cx="5.6" cy="7" rx="1.5" ry="2.3" transform="rotate(-25 5.6 7)" />
      <path d="M17 13.6c1.2 .2 2.1 1.4 1.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  boot: (
    <path d="M8 3.5h4v9.2l5.8 3.1a1.6 1.6 0 01.9 1.4v.8a1 1 0 01-1 1H5a1 1 0 01-1-1v-3.3a1 1 0 01.3-.7l2.7-2.6V3.5z" />
  ),
  ship: (
    <>
      <path d="M4 15h16l-2.2 4.3a1.5 1.5 0 01-1.34.7H7.54a1.5 1.5 0 01-1.34-.7z" />
      <rect x="10.5" y="10.5" width="3" height="4.5" />
      <rect x="11.2" y="5" width="1.6" height="5.5" />
    </>
  ),
  thimble: (
    <>
      <path d="M8 12.5V10a4 4 0 018 0v2.5l1.3 6.1a1 1 0 01-1 1.2H7.7a1 1 0 01-1-1.2z" />
      <circle cx="9.6" cy="10.6" r="0.55" fill="rgba(0,0,0,0.35)" />
      <circle cx="12" cy="9.8" r="0.55" fill="rgba(0,0,0,0.35)" />
      <circle cx="14.4" cy="10.6" r="0.55" fill="rgba(0,0,0,0.35)" />
      <circle cx="9.6" cy="13.2" r="0.55" fill="rgba(0,0,0,0.35)" />
      <circle cx="12" cy="12.4" r="0.55" fill="rgba(0,0,0,0.35)" />
      <circle cx="14.4" cy="13.2" r="0.55" fill="rgba(0,0,0,0.35)" />
    </>
  ),
  wheelbarrow: (
    <>
      <path d="M6 10h10l2 5.5H7.3z" />
      <circle cx="6.2" cy="17.3" r="2" />
      <rect x="17" y="9.5" width="1.6" height="8" rx="0.5" />
      <rect x="9" y="15.5" width="9.5" height="1.4" rx="0.7" />
    </>
  ),
  iron: (
    <>
      <path d="M4.5 18.5a1 1 0 001 1h12a1 1 0 001-1v-2.7c0-.5-.2-1-.6-1.3L10 8.3a2.3 2.3 0 00-1.5-.6H6.5a2 2 0 00-2 2z" />
      <path d="M9.5 7c0-1.1 1.1-2 2.5-2s2.5.9 2.5 2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
};

// (Task 3) Original artwork, drawn to match the classic set's own
// language: flat currentColor silhouette plus a single low-opacity black
// accent for interior detail (a window, a fold, a dimple) — never a
// second saturated colour, so the shape still recolours cleanly via
// PLAYER_COLOR_HEX the same way every other token does. Emoji render
// differently per device/OS and were the loudest inconsistency in the
// token set; these replace PLAYER_TOKEN_EMOJI entirely.
const NAIJA_TOKEN_SHAPES: Record<NaijaToken, React.ReactNode> = {
  // Danfo: the yellow-and-black Lagos minibus, three windows along the side.
  danfo: (
    <>
      <rect x="2.5" y="8" width="19" height="7.6" rx="1.6" />
      <rect x="4" y="4.6" width="16" height="4.2" rx="1" />
      <rect x="5.4" y="9.3" width="3.6" height="2.9" rx="0.4" fill="rgba(0,0,0,0.32)" />
      <rect x="10.2" y="9.3" width="3.6" height="2.9" rx="0.4" fill="rgba(0,0,0,0.32)" />
      <rect x="15" y="9.3" width="3" height="2.9" rx="0.4" fill="rgba(0,0,0,0.32)" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  // Keke: the three-wheeled keke napep, cab body over two rear wheels
  // and one front wheel.
  keke: (
    <>
      <path d="M4.5 9.8h9.5l3 4.2v3H4.5z" />
      <rect x="5.6" y="6" width="6.8" height="4.1" rx="1" />
      <rect x="7.2" y="9.5" width="3.6" height="2.7" rx="0.3" fill="rgba(0,0,0,0.32)" />
      <circle cx="6.8" cy="17.6" r="2.1" />
      <circle cx="16.2" cy="17.6" r="2.1" />
    </>
  ),
  // Okada: motorcycle-taxi outline — two wheels, frame, headlamp.
  okada: (
    <>
      <circle cx="5.6" cy="17" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="17" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5.6 17l3.8-6.2h5l3.6 6.2M9.4 10.8h4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="15.4" cy="8.4" r="1.5" />
    </>
  ),
  // Jollof: the pot, lid, and rising steam.
  jollof: (
    <>
      <path d="M5 11.2h14l-1.3 7a1.5 1.5 0 01-1.5 1.2H7.8a1.5 1.5 0 01-1.5-1.2z" />
      <rect x="4" y="9.4" width="16" height="2.1" rx="1" />
      <circle cx="12" cy="8.2" r="1.1" />
      <path
        d="M9 4c0 1.3-1.1 1.3-1.1 2.6M12 4c0 1.3-1.1 1.3-1.1 2.6M15 4c0 1.3-1.1 1.3-1.1 2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.55"
      />
    </>
  ),
  // Gele: the folded, fanned head-wrap.
  gele: (
    <>
      <path d="M4 15.6c0-5.1 3.6-9.1 8-9.1s8 4 8 9.1c0 1.7-1.3 2.8-2.8 2.2-1.6-2.6-3.6-4-5.2-4s-3.6 1.4-5.2 4c-1.5.6-2.8-.5-2.8-2.2z" />
      <path
        d="M8 17.7c1-1.7 2.4-2.6 4-2.6s3 .9 4 2.6"
        fill="none"
        stroke="rgba(0,0,0,0.3)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </>
  ),
  // Agbada: the wide-sleeved flowing robe, front view.
  agbada: (
    <>
      <path d="M12 3.6l-3.2 2.2-4.3 2.7v10.8a1 1 0 001 1h13a1 1 0 001-1V8.5l-4.3-2.7z" />
      <path d="M12 3.6v16.7" stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <circle cx="12" cy="7.1" r="1.4" fill="rgba(0,0,0,0.3)" />
    </>
  ),
  // Suya: skewered meat over a single stick.
  suya: (
    <>
      <rect x="3" y="10.9" width="18" height="1.7" rx="0.85" />
      <rect x="5.4" y="8.3" width="3.5" height="6.9" rx="1.1" />
      <rect x="10.25" y="8.3" width="3.5" height="6.9" rx="1.1" />
      <rect x="15.1" y="8.3" width="3.5" height="6.9" rx="1.1" />
    </>
  ),
  // Bottle: a soft-drink bottle, cap to base.
  bottle: (
    <>
      <path d="M10 3.2h4v3l1.7 2.5c.26.36.4.8.4 1.24v9.06a1 1 0 01-1 1H8.9a1 1 0 01-1-1V9.94c0-.44.14-.88.4-1.24L10 6.2z" />
      <rect x="10" y="2.1" width="4" height="1.6" rx="0.3" fill="rgba(0,0,0,0.3)" />
    </>
  ),
};

interface TokenIconProps {
  token: PlayerToken;
  className?: string;
}

// Every token (naija and classic alike) is a currentColor SVG silhouette
// on the same 24x24 grid — sized the same way font-size-driven emoji
// used to be (className="text-2xl" etc still works, since h-[1em]/w-[1em]
// track the inherited font-size).
export function TokenIcon({ token, className = "" }: TokenIconProps) {
  const shape = isClassicToken(token) ? CLASSIC_TOKEN_SHAPES[token] : NAIJA_TOKEN_SHAPES[token];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={`inline-block h-[1em] w-[1em] shrink-0 align-[-0.15em] ${className}`}
    >
      {shape}
    </svg>
  );
}

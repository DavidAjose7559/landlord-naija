import type { ClassicToken, PlayerToken } from "@/game/types";
import { isClassicToken, PLAYER_TOKEN_EMOJI } from "@/lib/tokens";

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

interface TokenIconProps {
  token: PlayerToken;
  className?: string;
}

// Drop-in replacement for interpolating PLAYER_TOKEN_EMOJI directly: size
// it the same way (font-size via className, e.g. "text-2xl") and it scales
// whether the token renders as an emoji or an SVG.
export function TokenIcon({ token, className = "" }: TokenIconProps) {
  if (isClassicToken(token)) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={`inline-block h-[1em] w-[1em] shrink-0 align-[-0.15em] ${className}`}
      >
        {CLASSIC_TOKEN_SHAPES[token]}
      </svg>
    );
  }
  return <span className={className}>{PLAYER_TOKEN_EMOJI[token]}</span>;
}

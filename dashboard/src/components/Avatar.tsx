import type { CSSProperties } from "react";
import { hueOf } from "../lib/agents";
import type { PartyKind } from "../lib/directory";
import type { PartyView } from "../lib/world";

/** FNV-1a, all 32 bits (hueOf keeps only the hue). */
function fnv(value: string): number {
  let h = 0x811c9dc5;
  for (const ch of value) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function isImage(avatar?: string): avatar is string {
  return Boolean(avatar && /^(data:image\/|https?:\/\/)/.test(avatar));
}

/** "bot:<hue>:<variant>" or "person:<hue>" pins a generated face; anything else derives it from the seed. */
export function faceSpec(avatar: string | undefined, seed: string): { hue: number; variant: number } {
  const m = avatar?.match(/^(?:bot|person):(\d+)(?::(\d+))?$/);
  if (m) return { hue: Number(m[1]) % 360, variant: Number(m[2] ?? 0) };
  return { hue: hueOf(seed), variant: fnv(`${seed}:face`) >>> 7 };
}

/** A different generated robot for the same agent (the Manage page's "shuffle"). */
export function shuffledBot(avatar: string | undefined, seed: string): string {
  const { hue, variant } = faceSpec(avatar, seed);
  return `bot:${(hue + 47) % 360}:${(variant * 7 + 13) % 324}`;
}

/** A robot face: antenna, head shape, eyes and mouth each vary, 108 combinations per hue. */
function RobotFace({ hue, variant }: { hue: number; variant: number }) {
  const antenna = variant % 4;
  const eyes = Math.floor(variant / 4) % 3;
  const mouth = Math.floor(variant / 12) % 3;
  const head = Math.floor(variant / 36) % 3;
  const face = `hsl(${hue} 70% 93%)`;
  const dark = `hsl(${hue} 45% 20%)`;
  const glow = `hsl(${(hue + 40) % 360} 95% 66%)`;
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" fill={`hsl(${hue} 62% 46%)`} />
      {antenna === 0 && (
        <>
          <line x1="32" y1="9" x2="32" y2="17" stroke={face} strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="32" cy="8" r="3.3" fill={glow} />
        </>
      )}
      {antenna === 1 && (
        <>
          <line x1="24" y1="10" x2="26" y2="17" stroke={face} strokeWidth="2.4" strokeLinecap="round" />
          <line x1="40" y1="10" x2="38" y2="17" stroke={face} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="23.6" cy="8.6" r="2.6" fill={glow} />
          <circle cx="40.4" cy="8.6" r="2.6" fill={glow} />
        </>
      )}
      {antenna === 2 && (
        <>
          <rect x="7" y="25" width="6" height="12" rx="3" fill={face} />
          <rect x="51" y="25" width="6" height="12" rx="3" fill={face} />
        </>
      )}
      {antenna === 3 && <rect x="25" y="9.5" width="14" height="6" rx="3" fill={glow} />}
      <rect x="13" y="16" width="38" height="31" rx={[9, 15, 5][head]} fill={face} />
      {eyes === 0 && (
        <>
          <circle cx="24.5" cy="29" r="4.3" fill={dark} />
          <circle cx="39.5" cy="29" r="4.3" fill={dark} />
          <circle cx="25.9" cy="27.6" r="1.4" fill="#fff" />
          <circle cx="40.9" cy="27.6" r="1.4" fill="#fff" />
        </>
      )}
      {eyes === 1 && (
        <>
          <rect x="18" y="23.5" width="28" height="11" rx="5.5" fill={dark} />
          <circle cx="25.5" cy="29" r="2.1" fill={glow} />
          <circle cx="38.5" cy="29" r="2.1" fill={glow} />
        </>
      )}
      {eyes === 2 && (
        <>
          <rect x="20.5" y="25" width="8" height="8" rx="2.2" fill={dark} />
          <rect x="35.5" y="25" width="8" height="8" rx="2.2" fill={dark} />
        </>
      )}
      {mouth === 0 && (
        <path d="M25 39 Q32 44.5 39 39" stroke={dark} strokeWidth="2.3" fill="none" strokeLinecap="round" />
      )}
      {mouth === 1 && (
        <>
          <rect x="24" y="37.5" width="16" height="5.5" rx="2" fill={dark} />
          <line x1="29.3" y1="37.5" x2="29.3" y2="43" stroke={face} strokeWidth="1.3" />
          <line x1="34.7" y1="37.5" x2="34.7" y2="43" stroke={face} strokeWidth="1.3" />
        </>
      )}
      {mouth === 2 && (
        <line x1="26" y1="40.5" x2="38" y2="40.5" stroke={dark} strokeWidth="2.5" strokeLinecap="round" />
      )}
      <rect x="20" y="50.5" width="24" height="16" rx="5" fill={face} opacity="0.9" />
    </svg>
  );
}

/** A person: head and shoulders. */
function PersonFace({ hue }: { hue: number }) {
  const skin = `hsl(${hue} 65% 94%)`;
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" fill={`hsl(${hue} 58% 52%)`} />
      <circle cx="32" cy="25" r="11" fill={skin} />
      <path d="M9 66 C9 47 21 41 32 41 C43 41 55 47 55 66 Z" fill={skin} />
    </svg>
  );
}

const KIND_PATHS: Record<PartyKind, JSX.Element> = {
  you: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  agent: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V5" />
      <circle cx="12" cy="3.6" r="1.3" />
      <circle cx="9.3" cy="13.3" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="13.3" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  employer: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7.5h1.2M13.8 7.5H15M9 11.5h1.2M13.8 11.5H15M10.5 21v-4h3v4" />
    </>
  ),
  government: (
    <>
      <path d="M3 10l9-6 9 6" />
      <path d="M5.5 10v8M10 10v8M14 10v8M18.5 10v8" />
      <path d="M3 21h18M4 18h16" />
    </>
  ),
  manager: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18" />
    </>
  ),
  org: <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />,
  unknown: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.9" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
};

/** Line icon for an issuer kind. */
export function KindIcon({ kind, size = 16 }: { kind: PartyKind; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {KIND_PATHS[kind]}
    </svg>
  );
}

export type IconName = "clock" | "flame" | "check" | "plus" | "mcp" | "web" | "contract" | "alert" | "block" | "dot";

const ICON_PATHS: Record<IconName, JSX.Element> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  flame: <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 .2 1.6 1 2.6 2 3 0-3 .2-5.5 1-9z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  mcp: (
    <>
      <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0z" />
      <path d="M12 16v5" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.8 2.6 15.2 0 18M12 3c-2.6 2.8-2.6 15.2 0 18" />
    </>
  ),
  contract: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.4" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.7 5.7l12.6 12.6" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
};

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/**
 * A party's picture. People are round, agents are rounded squares with a
 * robot face, and every other issuer is a seal in its kind's colour — so
 * a human and an agent are told apart by shape before anything is read.
 */
export function PartyAvatar({ party, size = 40 }: { party: PartyView; size?: number }) {
  const shape = party.kind === "agent" ? "square" : "round";
  const style = { width: size, height: size, flex: `0 0 ${size}px` } as CSSProperties;
  const cls = `avatar avatar-${shape} k-${party.kind}`;
  if (isImage(party.avatar)) {
    return (
      <span className={cls} style={style}>
        <img src={party.avatar} alt="" />
      </span>
    );
  }
  if (party.kind === "agent") {
    return (
      <span className={cls} style={style}>
        <RobotFace {...faceSpec(party.avatar, party.seed)} />
      </span>
    );
  }
  if (party.kind === "you") {
    return (
      <span className={cls} style={style}>
        <PersonFace hue={faceSpec(party.avatar, party.seed).hue} />
      </span>
    );
  }
  return (
    <span className={`${cls} avatar-seal`} style={style}>
      <KindIcon kind={party.kind} size={Math.round(size * 0.56)} />
    </span>
  );
}

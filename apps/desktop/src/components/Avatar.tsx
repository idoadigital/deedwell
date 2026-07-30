/**
 * Reusable Avatar: friendly illustrated person, deterministic per identity
 * (never changes between renders), with image support, initials fallback,
 * presence indicator, and size variants. Illustrations are inline SVG so the
 * app stays self-contained under the strict CSP.
 */

const SKIN = ["#f2c9a7", "#e8b48c", "#c98d5f", "#a06a42", "#7c4f2e", "#f7d9bc"];
const HAIR = ["#2f2a26", "#4a3524", "#6b4a2a", "#8a8078", "#b5651d", "#1f1c1a"];
const SHIRT = ["#1fa055", "#2273b8", "#b07a1e", "#7c5cbf", "#c05574", "#3a8f8a"];
const BG = ["#e7f5ec", "#eaf3fa", "#faf3e4", "#f0ecf9", "#fbeef2", "#e9f4f3"];

function hash(key: string): number {
  return [...key].reduce((n, c) => (n * 33 + c.charCodeAt(0)) >>> 0, 5381);
}

export function Avatar({
  id,
  name,
  size = 36,
  presence = false,
  imageUrl,
}: {
  id: string;
  name: string;
  size?: number;
  presence?: boolean;
  imageUrl?: string | null;
}) {
  const h = hash(id);
  const skin = SKIN[h % SKIN.length]!;
  const hair = HAIR[(h >> 3) % HAIR.length]!;
  const shirt = SHIRT[(h >> 6) % SHIRT.length]!;
  const bg = BG[(h >> 9) % BG.length]!;
  const hairstyle = (h >> 12) % 3;

  return (
    <span className="avatar" style={{ width: size, height: size }} role="img" aria-label={name}>
      {imageUrl ? (
        <img src={imageUrl} alt="" width={size} height={size} />
      ) : (
        <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" style={{ borderRadius: "50%", display: "block" }}>
          <circle cx="24" cy="24" r="24" fill={bg} />
          {/* shoulders */}
          <path d="M8 48c1.5-10 8-14 16-14s14.5 4 16 14z" fill={shirt} />
          {/* head */}
          <circle cx="24" cy="20" r="9.5" fill={skin} />
          {/* hair variants */}
          {hairstyle === 0 && <path d="M14.5 19c0-6 4.2-9.8 9.5-9.8S33.5 13 33.5 19c0-2.4-3-4.6-9.5-4.6S14.5 16.6 14.5 19z" fill={hair} />}
          {hairstyle === 1 && <path d="M14 21c-.8-7.5 4.3-11.6 10-11.6S34.8 13.5 34 21c-1.2-3.4-2.4-5.2-4-6.4-1 1-4.4 1.6-6 1.6-2.8 0-5.6-.8-6.6-2C15.8 15.6 14.6 18 14 21z" fill={hair} />}
          {hairstyle === 2 && <path d="M13.5 24c-1.5-9 4-14.5 10.5-14.5S36 15 34.5 24c-.6-2-1.4-3.4-2.5-4.3.3 1.5.2 2.8-.2 3.8-.7-2.4-2.6-4-4.3-4.6-2.8 1.1-7.2.8-9-1-1.6 1.3-2.6 3.3-2.6 5.4-1 .1-2 .4-2.4.7z" fill={hair} />}
        </svg>
      )}
      {presence && <span className="presence" aria-label="online" />}
    </span>
  );
}

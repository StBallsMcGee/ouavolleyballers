"use client";
import { useCallback, useState } from "react";
import { Avatar } from "@/components/ui";

/**
 * Headshot shown straight from the school's own website (never copied to our servers).
 * Falls back to the initials circle if there is no photo or it fails to load.
 */
export function PlayerPhoto({ name, photo, size = 40 }: { name: string; photo?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  // If the image already failed before the page finished loading, notice it on mount.
  const check = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (!photo || failed) return <Avatar name={name} size={size} />;
  const src = `${photo}?width=${Math.round(size * 2.5)}&quality=80`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- deliberately not optimised/proxied: the image stays on the school's server
    <img
      ref={check}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-gray-100 object-cover object-top ring-1 ring-gray-200"
      style={{ width: size, height: size }}
    />
  );
}

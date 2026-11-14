"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { setTeamLogo } from "@/app/actions";
import { TeamAvatar, type TeamLike } from "@/components/team-avatar";

/** Resizes a photo to a 256×256 square (centre crop) in the browser, as a small JPEG. */
async function toSquare(file: File, px = 256): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, px, px);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** The team's picture; the manager (or an admin) can tap it to change it. */
export function TeamLogoEditor({ team, size = 56, editable }: { team: TeamLike; size?: number; editable: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!editable) return <TeamAvatar team={team} size={size} ring />;
  const save = (image: string | null) =>
    start(async () => {
      const r = await setTeamLogo(team.id, image);
      if (!r.ok) setError(r.error);
      else { setError(null); router.refresh(); }
    });
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => input.current?.click()} className="relative block rounded-full" aria-label="Change team picture" disabled={pending}>
        <TeamAvatar team={team} size={size} ring />
        <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-gold-400 text-[12px] text-brand-950 shadow ring-2 ring-white" aria-hidden>{pending ? "…" : "📷"}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try { save(await toSquare(f)); } catch { setError("That picture couldn't be read. Try a JPG or PNG."); }
        }}
      />
      {team.logo_v ? (
        <button type="button" className="mt-1 block w-full text-center text-[10px] font-semibold text-brand-200 underline" onClick={() => confirm("Remove the team picture?") && save(null)} disabled={pending}>Remove</button>
      ) : null}
      {error ? <p className="absolute left-0 top-full z-10 mt-1 w-48 rounded bg-white p-1.5 text-[11px] text-red-600 shadow">{error}</p> : null}
    </div>
  );
}

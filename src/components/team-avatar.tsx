import { Avatar } from "@/components/ui";

export interface TeamLike {
  id: string;
  name: string;
  logo_v?: number | null;
}

/** A team's picture if it has one, otherwise its initials. */
export function TeamAvatar({ team, size = 40, ring = false }: { team: TeamLike | undefined; size?: number; ring?: boolean }) {
  if (!team) return <Avatar name="?" size={size} />;
  if (!team.logo_v) return <span className={ring ? "rounded-full ring-2 ring-gold-400" : ""}><Avatar name={team.name} size={size} /></span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/team-logo/${team.id}?v=${team.logo_v}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 rounded-full bg-surface object-cover ${ring ? "ring-2 ring-gold-400" : ""}`}
      style={{ width: size, height: size }}
    />
  );
}

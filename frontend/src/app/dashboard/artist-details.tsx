import { CHIP_CLASS } from "@/components/chip";
import { Badge } from "@/components/ui/badge";
import type { Interest, UserArtist } from "@/lib/api-types";
import { cn } from "@/lib/utils";

import {
  KNOWN_ARTIST_KINDS,
  LOVED_TRACKS_KIND,
  TOP_ARTIST_KIND,
} from "./artist-kinds";
import { numberFormat } from "@/lib/formats";
import { scoreOf, suggestionOf } from "./user-artist";

const listenersFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
});

function reasonOf(userArtist: UserArtist): string | null {
  const seeds = suggestionOf(userArtist)
    ?.evidence.paths?.map((path) => path.seed_name)
    .filter(Boolean);
  if (!seeds || seeds.length === 0) {
    return null;
  }
  return `because you listen to ${seeds.join(", ")}`;
}

export function interestLabel(interest: Interest): string {
  if (interest.kind === TOP_ARTIST_KIND) {
    const parts: string[] = [];
    if (interest.evidence.rank != null) {
      parts.push(`#${interest.evidence.rank}`);
    }
    if (interest.evidence.playcount != null) {
      parts.push(`${numberFormat.format(interest.evidence.playcount)} plays`);
    }
    if (parts.length > 0) {
      return parts.join(" · ");
    }
  }
  if (interest.kind === LOVED_TRACKS_KIND) {
    const count = interest.evidence.track_count ?? 0;
    return `${count} loved ${count === 1 ? "track" : "tracks"}`;
  }
  return interest.kind;
}

export function ScoreBadge({ userArtist }: { userArtist: UserArtist }) {
  return (
    <Badge variant="accent" className="shrink-0 px-1.5">
      <span className="size-1.5 rounded-full bg-primary" aria-hidden />
      score {scoreOf(userArtist).toFixed(2)}
    </Badge>
  );
}

export function KnownInterestBadges({
  userArtist,
  className = "",
}: {
  userArtist: UserArtist;
  className?: string;
}) {
  const knownInterests = userArtist.interests.filter((interest) =>
    KNOWN_ARTIST_KINDS.has(interest.kind),
  );
  if (knownInterests.length === 0) {
    return null;
  }
  return (
    <span className={cn("flex flex-wrap gap-1.5", className)}>
      {knownInterests.map((interest) => (
        <Badge
          key={`${interest.kind}-${interest.source}`}
          variant="outline"
          className={CHIP_CLASS}
        >
          {interestLabel(interest)}
        </Badge>
      ))}
    </span>
  );
}

// The facts an Artists-tab card shows under its title. Shared with the
// artist popovers on concert cards so both surfaces present the same
// details. Known-kind interests (plays, loved tracks) ride the title row,
// never here: each surface headlines a single signal, the one it sorts by.
export function ArtistDetails({
  userArtist,
  tagsClassName = "",
}: {
  userArtist: UserArtist;
  tagsClassName?: string;
}) {
  const reason = reasonOf(userArtist);
  // Last.fm tag lists can repeat a tag; they key the badges, so dedupe.
  const tags = [...new Set(userArtist.tags)];
  return (
    <>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      {(userArtist.listeners != null || tags.length > 0) && (
        <div className={cn("flex flex-col gap-2", tagsClassName)}>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className={cn("max-w-full", CHIP_CLASS)}
                >
                  {/* A badge never wraps internally, so a tag longer than the
                      card ellipsizes instead of clipping mid-letter. */}
                  <span className="truncate">{tag}</span>
                </Badge>
              ))}
            </div>
          )}
          {userArtist.listeners != null && (
            <p className="pl-1 text-xs text-muted-foreground italic">
              {listenersFormat.format(userArtist.listeners)} listeners
            </p>
          )}
        </div>
      )}
    </>
  );
}

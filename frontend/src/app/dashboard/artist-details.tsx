import { Badge } from "@/components/ui/badge";

import { KNOWN_ARTIST_KINDS, SIMILAR_ARTIST_KIND } from "./artist-kinds";
import type { Interest, UserArtist } from "./taste-panel";

const numberFormat = new Intl.NumberFormat("en-US");
const listenersFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
});

export function suggestionOf(userArtist: UserArtist): Interest | undefined {
  return userArtist.interests.find(
    (interest) => interest.kind === SIMILAR_ARTIST_KIND,
  );
}

export function scoreOf(userArtist: UserArtist): number {
  return suggestionOf(userArtist)?.weight ?? 0;
}

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
  if (interest.kind === "lastfm_top_artist") {
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
  if (interest.kind === "lastfm_loved_tracks") {
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
    <span className={`flex flex-wrap gap-1.5 ${className}`}>
      {knownInterests.map((interest) => (
        <Badge
          key={`${interest.kind}-${interest.source}`}
          variant="outline"
          className="font-normal text-muted-foreground"
        >
          {interestLabel(interest)}
        </Badge>
      ))}
    </span>
  );
}

// The facts an Artists-tab card shows under its title. Shared with the
// artist popovers on concert cards so both surfaces present the same
// details. Known-kind interests (plays, loved tracks) usually ride the
// title row instead; showKnownInterests pulls them in here for a
// suggestion's popover, the artist's whole profile.
export function ArtistDetails({
  userArtist,
  showKnownInterests = false,
  tagsClassName = "",
}: {
  userArtist: UserArtist;
  showKnownInterests?: boolean;
  tagsClassName?: string;
}) {
  const reason = reasonOf(userArtist);
  // Last.fm tag lists can repeat a tag; they key the badges, so dedupe.
  const tags = [...new Set(userArtist.tags ?? [])];
  return (
    <>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      {showKnownInterests && <KnownInterestBadges userArtist={userArtist} />}
      {userArtist.listeners != null && (
        <p className="text-xs text-muted-foreground italic">
          {listenersFormat.format(userArtist.listeners)} listeners
        </p>
      )}
      {tags.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${tagsClassName}`}>
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="max-w-full font-normal text-muted-foreground"
            >
              {/* A badge never wraps internally, so a tag longer than the
                  card ellipsizes instead of clipping mid-letter. */}
              <span className="truncate">{tag}</span>
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { SIMILAR_ARTIST_KIND } from "./artist-kinds";
import type { ArtistRelation } from "./events-panel";
import type { Interest, UserArtist } from "./taste-panel";

function suggestionOf(userArtist: UserArtist): Interest | undefined {
  return userArtist.interests.find(
    (interest) => interest.kind === SIMILAR_ARTIST_KIND,
  );
}

export function scoreOf(userArtist: UserArtist): number {
  return suggestionOf(userArtist)?.weight ?? 0;
}

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

// The score/relation badge that normally sits to the right of an artist's
// title. Exported so the artist-dialog header can show it on its own line
// under the (now dialog-level) title for the leading card, while the
// non-bare Card below keeps it beside the title as usual.
//
// A suggestion score only exists for suggested artists; a known artist never
// shows one, even if a stale suggestion interest lingers underneath - the
// relation wins, and the "why" line states it by name instead of the
// suggestion seeds.
export function artistBadge(userArtist: UserArtist, relation?: ArtistRelation) {
  const score =
    relation === "known" ? undefined : suggestionOf(userArtist)?.weight;
  if (score != null) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 px-1.5 text-muted-foreground"
      >
        <span className="size-1.5 rounded-full bg-primary" aria-hidden />
        score {score.toFixed(2)}
      </Badge>
    );
  }
  return (
    relation === "suggested" && (
      <Badge variant="secondary" className="max-w-full font-normal">
        <span className="truncate">you might like</span>
      </Badge>
    )
  );
}

// The artist card as it natively appears on the Artists tab. Shared with the
// artist/concert popups so an artist always looks the same wherever it's
// shown; `floating` drops the card's own background there, since the dialog
// already shares its bg color and a filled card on a filled dialog just
// reads as a smudge. `bare` goes further, for the artist a popup is *about*:
// no card frame, no title/badge (the dialog renders those in its own
// header), just the rest of the body sitting as a wide block.
export function ArtistCard({
  userArtist,
  relation,
  floating,
  bare,
  className,
}: {
  userArtist: UserArtist;
  relation?: ArtistRelation;
  floating?: boolean;
  bare?: boolean;
  className?: string;
}) {
  const reason =
    relation === "known"
      ? `you listen to ${userArtist.artist.name}`
      : reasonOf(userArtist);

  const body = (
    <>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      {userArtist.listeners != null && (
        <p className="text-xs text-muted-foreground italic">
          {listenersFormat.format(userArtist.listeners)} listeners
        </p>
      )}
      {(userArtist.tags ?? []).length > 0 && (
        <div className={cn("flex flex-wrap gap-1.5", !bare && "mt-auto pt-2")}>
          {(userArtist.tags ?? []).map((tag) => (
            <Badge key={tag} variant="secondary" className="max-w-full">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </>
  );

  if (bare) {
    return <div className={cn("flex flex-col gap-1", className)}>{body}</div>;
  }

  return (
    <Card
      size="sm"
      className={cn("h-full", floating && "bg-transparent", className)}
    >
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle className="min-w-0 break-words">
          {userArtist.artist.name}
        </CardTitle>
        {artistBadge(userArtist, relation)}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-1">{body}</CardContent>
    </Card>
  );
}

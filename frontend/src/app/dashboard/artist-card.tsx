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

function relationLabel(relation: ArtistRelation): string {
  return relation === "suggested" ? "you might like" : "you listen to";
}

// The artist card as it natively appears on the Artists tab. Shared with the
// artist/concert popups so an artist always looks the same wherever it's
// shown; `floating` drops the card's own background there, since the dialog
// already shares its bg color and a filled card on a filled dialog just
// reads as a smudge.
//
// A suggestion score only exists for suggested artists; artists shown here
// purely because the user already listens to them (no suggestion interest)
// fall back to a relation badge instead.
export function ArtistCard({
  userArtist,
  relation,
  floating,
  className,
}: {
  userArtist: UserArtist;
  relation?: ArtistRelation;
  floating?: boolean;
  className?: string;
}) {
  const score = suggestionOf(userArtist)?.weight;
  const reason = reasonOf(userArtist);

  return (
    <Card
      size="sm"
      className={cn("h-full", floating && "bg-transparent", className)}
    >
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle className="min-w-0 break-words">
          {userArtist.artist.name}
        </CardTitle>
        {score != null ? (
          <Badge
            variant="outline"
            className="shrink-0 px-1.5 text-muted-foreground"
          >
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            score {score.toFixed(2)}
          </Badge>
        ) : (
          relation && (
            <Badge
              variant={relation === "suggested" ? "secondary" : "outline"}
              className={cn(
                "max-w-full font-normal",
                relation !== "suggested" && "text-muted-foreground",
              )}
            >
              <span className="truncate">{relationLabel(relation)}</span>
            </Badge>
          )
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-1">
        {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
        {userArtist.listeners != null && (
          <p className="text-xs text-muted-foreground italic">
            {listenersFormat.format(userArtist.listeners)} listeners
          </p>
        )}
        {(userArtist.tags ?? []).length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {(userArtist.tags ?? []).map((tag) => (
              <Badge key={tag} variant="secondary" className="max-w-full">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

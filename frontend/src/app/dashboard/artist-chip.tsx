"use client";

import { CHIP_CLASS } from "@/components/chip";
import { DISPLAY_TITLE_CLASS } from "@/components/display-title";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Artist, ArtistRelation, UserArtist } from "@/lib/api-types";
import {
  ArtistDetails,
  KnownInterestBadges,
  ScoreBadge,
} from "./artist-details";
import { usePinnedPopoverWidth } from "./use-pinned-popover-width";
import { cn } from "@/lib/utils";

function artistChipLabel(
  artist: Artist,
  relations: Record<string, ArtistRelation>,
): string {
  switch (relations[artist.id]) {
    case "suggested":
      return `you might like ${artist.name}`;
    case "known":
      return `you listen to ${artist.name}`;
    default:
      return artist.name;
  }
}

// An artist chip on a concert card. With details on hand it opens a popover
// carrying the artist's profile - the same facts their Artists-tab card
// shows - so the concert can be judged without leaving the tab.
export function ArtistChip({
  artist,
  relations,
  details,
}: {
  artist: Artist;
  relations: Record<string, ArtistRelation>;
  details?: UserArtist;
}) {
  const { triggerRef, open, onOpenChange, maxWidth } = usePinnedPopoverWidth();
  const suggested = relations[artist.id] === "suggested";
  const label = (
    <>
      {/* Suggestions carry the primary accent dot, echoing the score pill;
          known-artist chips stay plain. */}
      {suggested && (
        <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
      )}
      <span className="truncate">{artistChipLabel(artist, relations)}</span>
    </>
  );
  // pl-1.5 sets the dot concentric with the pill's rounded end, matching the
  // score pill's px-1.5.
  const badgeClass = cn(
    "max-w-full",
    CHIP_CLASS,
    suggested && "pl-1.5",
  );
  const variant = suggested ? "accent" : "outline";

  if (!details) {
    return (
      <Badge variant={variant} className={badgeClass}>
        {label}
      </Badge>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Badge
          asChild
          variant={variant}
          className={cn(
            badgeClass,
            "cursor-pointer",
            suggested
              ? "hover:bg-primary/8 dark:hover:bg-primary/12"
              : "hover:bg-muted",
          )}
        >
          <button ref={triggerRef} type="button" title={`About ${artist.name}`}>
            {label}
          </button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" style={{ maxWidth }}>
        <PopoverHeader>
          {/* The artist's headline number rides the title row: the score for
              a suggestion, the listening-history pills for an artist you
              listen to. Mirrors the Artists-tab card title row: the row
              never wraps, a long name wraps beside the in-line badge, and
              items-start keeps the badge on the first line. */}
          <PopoverTitle
            className={cn(
              "flex items-start justify-between gap-2",
              DISPLAY_TITLE_CLASS,
            )}
          >
            <span className="min-w-0 break-words">{artist.name}</span>
            {suggested ? (
              <ScoreBadge userArtist={details} />
            ) : (
              <KnownInterestBadges userArtist={details} className="justify-end" />
            )}
          </PopoverTitle>
        </PopoverHeader>
        {/* gap-1 and the tags' pt-2 mirror the Artists-tab card body, so the
            popover reads as the same card in miniature. */}
        <div className="flex flex-col gap-1">
          <ArtistDetails userArtist={details} tagsClassName="pt-2" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  artistChipLabel,
  dateFormat,
  placeLabel,
  type ArtistRelation,
  type UserEvent,
} from "./events-panel";

// The concert card as it natively appears on the Concerts tab. Shared with
// the artist/concert popups so a concert always looks the same wherever it's
// shown; `floating` drops the card's own background there, since the dialog
// already shares its bg color and a filled card on a filled dialog just
// reads as a smudge.
export function ConcertCard({
  userEvent,
  artistRelations,
  onClick,
  floating,
  className,
}: {
  userEvent: UserEvent;
  artistRelations: Record<string, ArtistRelation>;
  onClick?: () => void;
  floating?: boolean;
  className?: string;
}) {
  const { event, url, artists } = userEvent;

  return (
    <Card
      size="sm"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "flex-1",
        floating && "bg-transparent",
        onClick &&
          "cursor-pointer outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <CardHeader>
        {/* gap-y-1 matches the header gap, so a wrapped date sits as close
            to the title above as to the venue line below. */}
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <span className="min-w-0">
            {event.title ?? artists.map((artist) => artist.name).join(", ")}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {dateFormat.format(new Date(event.starts_at))}
          </span>
        </CardTitle>
        <CardDescription>
          {event.venue_name} · {placeLabel(event)}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex flex-wrap items-center gap-2">
        {artists.map((artist) => {
          const suggested = artistRelations[artist.id] === "suggested";
          return (
            <Badge
              key={artist.id}
              variant={suggested ? "secondary" : "outline"}
              className={`max-w-full font-normal ${suggested ? "" : "text-muted-foreground"}`}
            >
              <span className="truncate">
                {artistChipLabel(artist, artistRelations)}
              </span>
            </Badge>
          );
        })}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="relative ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Tickets
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

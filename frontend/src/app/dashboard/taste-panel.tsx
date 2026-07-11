"use client";

import { useState, useTransition } from "react";
import { EyeOff, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setArtistHidden } from "./actions";
import { KNOWN_ARTIST_KINDS } from "./artist-kinds";

export type Artist = {
  id: string;
  name: string;
};

export type Interest = {
  kind: string;
  source: string;
  evidence: {
    rank?: number | null;
    playcount?: number | null;
    period?: string;
    track_count?: number;
    score?: number;
    paths?: { seed_artist_id: string; seed_name: string; match: number }[];
  };
  weight: number | null;
  created_at: string;
  updated_at: string;
};

// tags and listeners are optional so a newer frontend tolerates responses
// from a backend deployed before they existed.
export type UserArtist = {
  artist: Artist;
  interests: Interest[];
  excluded: boolean;
  tags?: string[];
  listeners?: number | null;
};

const numberFormat = new Intl.NumberFormat("en-US");

type SortKey = "plays" | "loved" | "name" | "hidden";

function rankOf(userArtist: UserArtist): number {
  const rank = userArtist.interests.find(
    (interest) => interest.kind === "lastfm_top_artist",
  )?.evidence.rank;
  return rank ?? Number.MAX_SAFE_INTEGER;
}

function playsOf(userArtist: UserArtist): number {
  return (
    userArtist.interests.find((interest) => interest.kind === "lastfm_top_artist")
      ?.evidence.playcount ?? -1
  );
}

function lovedOf(userArtist: UserArtist): number {
  return (
    userArtist.interests.find((interest) => interest.kind === "lastfm_loved_tracks")
      ?.evidence.track_count ?? -1
  );
}

function byName(a: UserArtist, b: UserArtist): number {
  return a.artist.name.localeCompare(b.artist.name);
}

const comparators: Record<SortKey, (a: UserArtist, b: UserArtist) => number> = {
  name: byName,
  // The top-artist rank is Last.fm's own play-based ordering, so it doubles
  // as the plays sort; raw playcount breaks ties for artists without a rank.
  plays: (a, b) =>
    rankOf(a) - rankOf(b) || playsOf(b) - playsOf(a) || byName(a, b),
  loved: (a, b) => lovedOf(b) - lovedOf(a) || byName(a, b),
  hidden: (a, b) =>
    Number(b.excluded) - Number(a.excluded) ||
    rankOf(a) - rankOf(b) ||
    byName(a, b),
};

function interestLabel(interest: Interest): string {
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

function ArtistRow({ userArtist }: { userArtist: UserArtist }) {
  const { artist, interests, excluded } = userArtist;
  const [pending, startTransition] = useTransition();

  function toggleHidden() {
    startTransition(async () => {
      const result = await setArtistHidden(artist.id, !excluded);
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  const HideIcon = excluded ? Undo2 : EyeOff;

  return (
    // The outer row never wraps: a long artist name breaks onto extra lines
    // (and chips wrap) inside the inner container while the hide control
    // stays right, centered on them.
    <li className="group flex items-center gap-2 text-sm">
      {/* gap-y-1 matches the list's space-y-1, so a wrapped badge sits as
          close to its own row above as to the next row below. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`min-w-0 ${
            excluded ? "text-muted-foreground line-through" : ""
          }`}
        >
          {artist.name}
        </span>
        {interests
          .filter((interest) => KNOWN_ARTIST_KINDS.has(interest.kind))
          .map((interest) => (
            <Badge
              key={`${interest.kind}-${interest.source}`}
              variant="outline"
              className={`font-normal text-muted-foreground ${
                excluded ? "opacity-60" : ""
              }`}
            >
              {interestLabel(interest)}
            </Badge>
          ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={toggleHidden}
        disabled={pending}
        title={excluded ? "Unhide" : "Hide artist"}
        aria-label={excluded ? `Unhide ${artist.name}` : `Hide ${artist.name}`}
        className={`text-muted-foreground transition-opacity focus-visible:opacity-100 ${
          // Hidden-until-hover only where hovering exists; touch devices
          // (no group-hover: Tailwind gates it behind hover: hover) always
          // show the button.
          excluded ? "" : "pointer-fine:opacity-0 group-hover:opacity-100"
        }`}
      >
        <HideIcon className="size-3.5" aria-hidden />
      </Button>
    </li>
  );
}

export function TastePanel({
  userArtists,
  synced,
}: {
  userArtists: UserArtist[];
  synced: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("plays");
  const sortedArtists = [...userArtists].sort(comparators[sortKey]);

  return (
    <div>
      {userArtists.length === 0 ? (
        // Already inside the section's bordered panel, so no dashed box here -
        // just the centered empty-state text.
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {synced
            ? "No listening history imported. If you just signed up for Last.fm, wait for Last.fm to capture future listening history."
            : "Run a sync above to import listening history."}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs text-muted-foreground italic">
              ({numberFormat.format(userArtists.length)})
            </h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span id="taste-sort-label">Sort by</span>
              <Select
                value={sortKey}
                onValueChange={(value) => setSortKey(value as SortKey)}
              >
                <SelectTrigger
                  size="sm"
                  aria-labelledby="taste-sort-label"
                  className="text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plays">Most plays</SelectItem>
                  <SelectItem value="loved">Most loved tracks</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="hidden">Hidden first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
            {sortedArtists.map((userArtist) => (
              <ArtistRow key={userArtist.artist.id} userArtist={userArtist} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

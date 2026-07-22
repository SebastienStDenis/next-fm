"use client";

import { useDeferredValue, useState, useTransition } from "react";
import { EyeOff, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setArtistHidden } from "./actions";
import { interestLabel } from "./artist-details";
import { KNOWN_ARTIST_KINDS } from "./artist-kinds";
import { SortSelect, type SortOption } from "./sort-select";

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

const sortOptions: readonly SortOption<SortKey>[] = [
  { value: "plays", label: "Most plays" },
  { value: "loved", label: "Most loved tracks" },
  { value: "name", label: "Name" },
  { value: "hidden", label: "Hidden first" },
];

export function rankOf(userArtist: UserArtist): number {
  const rank = userArtist.interests.find(
    (interest) => interest.kind === "lastfm_top_artist",
  )?.evidence.rank;
  return rank ?? Number.MAX_SAFE_INTEGER;
}

export function playsOf(userArtist: UserArtist): number {
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
    // stays right, on the first line. content-visibility lets rows scrolled
    // out of the list skip layout and paint - with thousands of artists
    // that is nearly all of them.
    <li className="group flex items-start gap-2 text-sm [content-visibility:auto] [contain-intrinsic-block-size:auto_1.75rem]">
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
        // -mt-1 centers the size-7 button on the row's 20px first text
        // line, so it tracks the name rather than a wrapped row's middle.
        className={`-mt-1 text-muted-foreground transition-opacity focus-visible:opacity-100 ${
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

const NO_ARTISTS: UserArtist[] = [];

export function TastePanel({
  userArtists,
  synced,
}: {
  userArtists: UserArtist[];
  synced: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("plays");
  // The settings dialog mounts this panel in the same frame its open
  // animation starts, and the list can run to thousands of rows; rendering
  // them in that first commit stalls the animation on mobile. Start empty
  // and fill the rows in a deferred, interruptible render - the list sits
  // below the dialog's fold, so nothing visibly pops in.
  const deferredArtists = useDeferredValue(userArtists, NO_ARTISTS);
  const sortedArtists = [...deferredArtists].sort(comparators[sortKey]);

  return (
    <div>
      {userArtists.length === 0 ? (
        // Already inside the section's bordered panel, so no dashed box here -
        // just the centered empty-state text.
        <p className="px-6 py-8 text-center text-xs leading-5 text-muted-foreground">
          {synced
            ? "No listening history imported. If you just signed up for Last.fm, wait for Last.fm to capture future listening history. NextFM will import new listening history as it appears."
            : "Run a sync above to import listening history."}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs text-muted-foreground italic">
              ({numberFormat.format(userArtists.length)})
            </h3>
            <SortSelect
              value={sortKey}
              onValueChange={setSortKey}
              options={sortOptions}
            />
          </div>
          <ul className="mt-2 max-h-80 overflow-y-auto">
            {sortedArtists.map((userArtist) => (
              <ArtistRow key={userArtist.artist.id} userArtist={userArtist} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

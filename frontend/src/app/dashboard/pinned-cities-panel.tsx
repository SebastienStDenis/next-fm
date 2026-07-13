"use client";

import { useState, useTransition } from "react";

import { X } from "lucide-react";
import { toast } from "sonner";

import { createCityPlaylist, deletePlaylist } from "./actions";
import type { City } from "./city-panel";
import { CitySearchBox, cityLabel } from "./city-search-box";
import type { Playlist } from "./playlists-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const PINNED_PLAYLIST_CAP = 4;

export function PinnedCitiesPanel({ pinned }: { pinned: Playlist[] }) {
  const [pending, startTransition] = useTransition();
  // The city just picked, shown as a placeholder row with a spinner until
  // the pin action's revalidated payload delivers the real row.
  const [adding, setAdding] = useState<City | null>(null);

  // The in-flight pin counts toward the cap so the search box flips to the
  // remove-a-pin message as soon as the last slot is taken, not once the
  // revalidated payload lands.
  const pinnedCount = pinned.length + (pending && adding ? 1 : 0);
  const atCap = pinnedCount >= PINNED_PLAYLIST_CAP;

  function pin(city: City) {
    setAdding(city);
    startTransition(async () => {
      const result = await createCityPlaylist(city.geonameid);
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {(pinned.length > 0 || (pending && adding)) && (
        <ul className="space-y-1">
          {pinned.map((playlist) => (
            <PinnedCityRow key={playlist.id} playlist={playlist} />
          ))}
          {pending && adding && (
            <li className="flex items-center justify-between gap-x-2 text-sm">
              <span className="min-w-0">{cityLabel(adding)}</span>
              <span className="flex size-7 items-center justify-center text-muted-foreground">
                <Spinner />
              </span>
            </li>
          )}
        </ul>
      )}
      <CitySearchBox
        placeholder={
          atCap
            ? "Remove an existing pin to add another"
            : "Add a playlist for another city"
        }
        disabled={atCap || pending}
        onSelect={pin}
      />
    </div>
  );
}

function PinnedCityRow({ playlist }: { playlist: Playlist }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deletePlaylist(playlist.id);
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    // The row never wraps: a long city name breaks onto extra lines inside
    // its own span while the remove control stays right, centered on them.
    <li className="flex items-center justify-between gap-x-2 text-sm">
      <span className="min-w-0">
        {playlist.city && cityLabel(playlist.city)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() =>
          playlist.spotify_url ? setConfirming(true) : remove()
        }
        disabled={pending}
        aria-label={`Remove ${playlist.city?.name ?? "pinned city"}`}
        title="Remove"
        className="text-muted-foreground"
      >
        {pending ? <Spinner className="text-muted-foreground" /> : <X aria-hidden />}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove the playlist for {playlist.city?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It will also be removed from Spotify.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

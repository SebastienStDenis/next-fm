"use client";

import { useTransition } from "react";

import { toast } from "sonner";

import { setIncludeKnownArtists } from "./actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function DiscoveryToggle({
  includeKnownArtists,
}: {
  includeKnownArtists: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-start gap-3">
      <Switch
        id="include-known-artists"
        checked={includeKnownArtists}
        disabled={pending}
        onCheckedChange={(next) => {
          startTransition(async () => {
            const result = await setIncludeKnownArtists(next);
            if (result.error) {
              toast.error(result.error);
            }
          });
        }}
      />
      <div className="space-y-1">
        <Label htmlFor="include-known-artists">
          Include artists I know in my playlists
        </Label>
        <p className="text-xs text-muted-foreground">
          When off, playlists feature only suggested artists&apos; concerts -
          discovery mode.
        </p>
      </div>
    </div>
  );
}

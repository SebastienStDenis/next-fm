"use client";

import { useState, useTransition } from "react";

import { Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { clearCity, setCity } from "./actions";
import { CitySearchBox, cityLabel } from "./city-search-box";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export type City = {
  geonameid: number;
  name: string;
  admin1: string | null;
  country_code: string;
  latitude: number;
  longitude: number;
};

export function CityPanel({ city }: { city: City | null }) {
  const [editing, setEditing] = useState(false);
  // The set-city action resolves before the revalidated server payload
  // commits, so the prop is stale for a moment; show the picked city until a
  // fresh payload (new prop identity) arrives.
  const [optimisticCity, setOptimisticCity] = useState<City | null>(null);
  const [prevCity, setPrevCity] = useState(city);
  const [pending, startTransition] = useTransition();
  if (city !== prevCity) {
    setPrevCity(city);
    setOptimisticCity(null);
  }

  // Show the picked city as the card right away, with a spinner on its
  // controls until the action settles; a failure returns to the search and
  // reports through a toast.
  function pick(selected: City) {
    setOptimisticCity(selected);
    setEditing(false);
    startTransition(async () => {
      const next = await setCity(selected.geonameid);
      if (next.error) {
        setOptimisticCity(null);
        setEditing(true);
        toast.error(next.error);
      }
    });
  }

  const shown = optimisticCity ?? city;
  if (shown !== null && !editing) {
    return (
      <CityCard
        city={shown}
        saving={pending && optimisticCity !== null}
        onEdit={() => setEditing(true)}
      />
    );
  }
  return (
    <CitySearch
      hasCity={shown !== null}
      onSelect={pick}
      onCancel={() => setEditing(false)}
    />
  );
}

function CityCard({
  city,
  saving,
  onEdit,
}: {
  city: City;
  saving: boolean;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function clear() {
    startTransition(async () => {
      const result = await clearCity();
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="min-w-0 font-medium">{cityLabel(city)}</p>
      {saving ? (
        <span className="flex size-7 items-center justify-center text-muted-foreground">
          <Spinner />
        </span>
      ) : (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label="Change home city"
            title="Change"
            className="text-muted-foreground"
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={clear}
            disabled={pending}
            aria-label="Clear home city"
            title="Clear"
            className="text-destructive hover:text-destructive"
          >
            {pending ? <Spinner className="text-muted-foreground" /> : <X aria-hidden />}
          </Button>
        </div>
      )}
    </div>
  );
}

function CitySearch({
  hasCity,
  onSelect,
  onCancel,
}: {
  hasCity: boolean;
  onSelect: (city: City) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <CitySearchBox
          placeholder="Search for a city"
          autoFocus={hasCity}
          onSelect={onSelect}
        />
      </div>
      {hasCity && (
        // mt-0.5 centers the icon on the input's height while staying
        // self-start, so it doesn't move when the search box's error line
        // appears below.
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCancel}
          aria-label="Cancel"
          title="Cancel"
          className="mt-0.5 self-start text-muted-foreground"
        >
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}

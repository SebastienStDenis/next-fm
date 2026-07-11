"use client";

import { useActionState, useState, useTransition } from "react";

import type { ActionState } from "./actions";
import { clearCity, setCity } from "./actions";
import { CitySearchBox, cityLabel } from "./city-search-box";
import { useTransientError } from "./use-transient-error";

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
  if (city !== prevCity) {
    setPrevCity(city);
    setOptimisticCity(null);
  }

  const shown = optimisticCity ?? city;
  if (shown !== null && !editing) {
    return <CityCard city={shown} onEdit={() => setEditing(true)} />;
  }
  return (
    <CitySearch
      hasCity={shown !== null}
      onDone={(selected) => {
        if (selected) {
          setOptimisticCity(selected);
        }
        setEditing(false);
      }}
    />
  );
}

function CityCard({ city, onEdit }: { city: City; onEdit: () => void }) {
  const [state, clearAction, pending] = useActionState(clearCity, {
    error: null,
  });
  const error = useTransientError(state);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="font-medium">{cityLabel(city)}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Change
          </button>
          <form action={clearAction}>
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-gray-300 px-3 py-1 text-sm text-red-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
            >
              {pending ? "Clearing..." : "Clear"}
            </button>
          </form>
        </div>
      </div>
      {error && !pending && (
        <p
          key={error.key}
          className="mt-2 animate-fade-in-out text-xs text-red-600"
        >
          {error.message}
        </p>
      )}
    </div>
  );
}

function CitySearch({
  hasCity,
  onDone,
}: {
  hasCity: boolean;
  onDone: (selected?: City) => void;
}) {
  const [result, setResult] = useState<ActionState>({ error: null });
  const error = useTransientError(result);
  const [pending, startTransition] = useTransition();

  function select(city: City) {
    startTransition(async () => {
      const next = await setCity(city.geonameid);
      setResult(next);
      if (!next.error) {
        onDone(city);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <CitySearchBox
            placeholder="Search for a city"
            disabled={pending}
            autoFocus={hasCity}
            onSelect={select}
          />
        </div>
        {hasCity && (
          <button
            type="button"
            onClick={() => onDone()}
            className="self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Cancel
          </button>
        )}
      </div>
      {error && !pending && (
        <p key={error.key} className="animate-fade-in-out text-xs text-red-600">
          {error.message}
        </p>
      )}
    </div>
  );
}

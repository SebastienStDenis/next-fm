"use client";

import { useActionState, useState, useTransition } from "react";

import type { ActionState } from "./actions";
import { clearCity, setCity } from "./actions";
import { CitySearchBox, cityLabel } from "./city-search-box";
import { PencilMark } from "./pencil-mark";
import { Spinner } from "../spinner";
import { useTransientError } from "./use-transient-error";
import { XMark } from "./x-mark";

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
        <p className="min-w-0 font-medium">{cityLabel(city)}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Change home city"
            title="Change"
            className="-m-1 flex rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <PencilMark />
          </button>
          <form action={clearAction} className="flex">
            {pending ? (
              <span className="flex text-gray-500">
                <Spinner />
              </span>
            ) : (
              <button
                type="submit"
                aria-label="Clear home city"
                title="Clear"
                className="-m-1 flex rounded p-1 text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <XMark className="h-4 w-4" />
              </button>
            )}
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
          // mt-1 centers the icon on the input's height while staying
          // self-start, so it doesn't move when an error line appears below.
          <button
            type="button"
            onClick={() => onDone()}
            aria-label="Cancel"
            title="Cancel"
            className="mt-1 flex self-start rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <XMark className="h-4 w-4" />
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

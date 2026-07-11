"use client";

import { useActionState, useState, useTransition } from "react";

import type { ActionState } from "./actions";
import { clearCity, setCity } from "./actions";
import { CitySearchBox, cityLabel } from "./city-search-box";
import { PencilMark } from "./pencil-mark";
import { Spinner } from "../spinner";
import {
  useTransientError,
  type TransientError,
} from "./use-transient-error";
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
  const [result, setResult] = useState<ActionState>({ error: null });
  const error = useTransientError(result);
  const [pending, startTransition] = useTransition();
  if (city !== prevCity) {
    setPrevCity(city);
    setOptimisticCity(null);
  }

  // Show the picked city as the card right away, with a spinner on its
  // controls until the action settles; a failure returns to the search with
  // the error under it.
  function pick(selected: City) {
    setOptimisticCity(selected);
    setEditing(false);
    startTransition(async () => {
      const next = await setCity(selected.geonameid);
      setResult(next);
      if (next.error) {
        setOptimisticCity(null);
        setEditing(true);
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
      error={error}
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
  const [state, clearAction, pending] = useActionState(clearCity, {
    error: null,
  });
  const error = useTransientError(state);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 font-medium">{cityLabel(city)}</p>
        {saving ? (
          <span className="flex text-gray-500">
            <Spinner />
          </span>
        ) : (
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
        )}
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
  error,
  onSelect,
  onCancel,
}: {
  hasCity: boolean;
  error: TransientError;
  onSelect: (city: City) => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <CitySearchBox
            placeholder="Search for a city"
            autoFocus={hasCity}
            onSelect={onSelect}
          />
        </div>
        {hasCity && (
          // mt-1 centers the icon on the input's height while staying
          // self-start, so it doesn't move when an error line appears below.
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            title="Cancel"
            className="mt-1 flex self-start rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <XMark className="h-4 w-4" />
          </button>
        )}
      </div>
      {error && (
        <p key={error.key} className="animate-fade-in-out text-xs text-red-600">
          {error.message}
        </p>
      )}
    </div>
  );
}

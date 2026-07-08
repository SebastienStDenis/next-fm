"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { clearCity, setCity } from "./actions";

export type City = {
  geonameid: number;
  name: string;
  admin1: string | null;
  country_code: string;
  latitude: number;
  longitude: number;
};

function cityLabel(city: City): string {
  return [city.name, city.admin1, city.country_code].filter(Boolean).join(", ");
}

export function CityPanel({ city }: { city: City | null }) {
  const [editing, setEditing] = useState(false);

  if (city !== null && !editing) {
    return <CityCard city={city} onEdit={() => setEditing(true)} />;
  }
  return <CitySearch hasCity={city !== null} onDone={() => setEditing(false)} />;
}

function CityCard({ city, onEdit }: { city: City; onEdit: () => void }) {
  const [state, clearAction, pending] = useActionState(clearCity, {
    error: null,
  });

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
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}

function CitySearch({
  hasCity,
  onDone,
}: {
  hasCity: boolean;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<City[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          setResults(await res.json());
          setError(null);
        } else {
          setResults([]);
          setError("City search failed.");
        }
      } catch {
        // aborted; the next keystroke's fetch takes over
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function select(city: City) {
    startTransition(async () => {
      const result = await setCity(city.geonameid);
      if (result.error) {
        setError(result.error);
        return;
      }
      setQuery("");
      setResults([]);
      setError(null);
      onDone();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a city"
          className="flex-1 rounded border border-gray-300 bg-transparent px-3 py-1 text-sm dark:border-gray-700"
        />
        {hasCity && (
          <button
            type="button"
            onClick={onDone}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Cancel
          </button>
        )}
      </div>
      {results.length > 0 && (
        <ul className="divide-y divide-gray-300 rounded border border-gray-300 dark:divide-gray-700 dark:border-gray-700">
          {results.map((city) => (
            <li key={city.geonameid}>
              <button
                type="button"
                onClick={() => select(city)}
                disabled={pending}
                className="w-full px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-900"
              >
                {cityLabel(city)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import type { City } from "./city-panel";

export function cityLabel(city: City): string {
  return [city.name, city.admin1, city.country_code].filter(Boolean).join(", ");
}

export function CitySearchBox({
  placeholder,
  disabled,
  onSelect,
}: {
  placeholder: string;
  disabled?: boolean;
  onSelect: (city: City) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<City[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    setQuery("");
    setResults([]);
    setError(null);
    onSelect(city);
  }

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700"
      />
      {results.length > 0 && (
        <ul className="divide-y divide-gray-300 rounded border border-gray-300 dark:divide-gray-700 dark:border-gray-700">
          {results.map((city) => (
            <li key={city.geonameid}>
              <button
                type="button"
                onClick={() => select(city)}
                disabled={disabled}
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

"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { City } from "./city-panel";

export function cityLabel(city: City): string {
  return [city.name, city.admin1, city.country_code].filter(Boolean).join(", ");
}

function cityRegion(city: City): string {
  return [city.admin1, city.country_code].filter(Boolean).join(", ");
}

export function CitySearchBox({
  placeholder,
  disabled,
  autoFocus,
  onSelect,
}: {
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onSelect: (city: City) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // City data is static (seeded from GeoNames), so results can be cached for
  // the life of the component; backspacing and retyping never refetch.
  const cache = useRef(new Map<string, City[]>());
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const q = query.trim();

  function resolveLocally(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const cached = cache.current.get(trimmed);
    if (cached) {
      setResults(cached);
      setActive(0);
      setSearching(false);
      return;
    }
    setSearching(true);
  }

  useEffect(() => {
    if (q.length < 2 || cache.current.has(q)) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const cities: City[] = await res.json();
          cache.current.set(q, cities);
          setResults(cities);
          setActive(0);
          setError(null);
        } else {
          setResults([]);
          setError("City search failed.");
        }
        setSearching(false);
      } catch {
        // aborted; the next keystroke's fetch takes over
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function select(city: City) {
    setQuery("");
    setResults([]);
    setError(null);
    onSelect(city);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[active]);
    }
  }

  const showList = open && results.length > 0;
  const showEmpty =
    open && q.length >= 2 && !searching && !error && results.length === 0;

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          resolveLocally(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={showList ? `${listboxId}-${active}` : undefined}
        aria-autocomplete="list"
        className="w-full rounded-md border border-gray-300 bg-transparent px-3 py-1.5 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:placeholder:text-gray-500 dark:focus:border-gray-500"
      />
      {showList && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-200 bg-background py-1 shadow-lg dark:border-gray-800"
        >
          {results.map((city, i) => (
            <li
              key={city.geonameid}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === active}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(city)}
                disabled={disabled}
                className={`w-full px-3 py-1.5 text-left text-sm disabled:opacity-50 ${
                  i === active ? "bg-gray-100 dark:bg-gray-800" : ""
                }`}
              >
                {/* Region on its own line: side by side, a long region would
                    truncate the name down to a letter in narrow dropdowns. */}
                <span className="block truncate">{city.name}</span>
                {cityRegion(city) && (
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {cityRegion(city)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showEmpty && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-background px-3 py-1.5 text-sm text-gray-500 shadow-lg dark:border-gray-800 dark:text-gray-400">
          No matching cities
        </div>
      )}
      {/* A live status, not a one-shot action error: it clears itself on the
          next keystroke, so it fades in but never auto-dismisses. */}
      {error && (
        <p className="mt-2 animate-fade-in text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

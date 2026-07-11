"use client";

import { useEffect, useRef, useState } from "react";

import { Command as CommandPrimitive, useCommandState } from "cmdk";

import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

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
  // cmdk's own first-item auto-select runs when the search changes, which is
  // before the async results land; the active option is controlled instead
  // and reset to the first result whenever a new list arrives.
  const [active, setActive] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // City data is static (seeded from GeoNames), so results can be cached for
  // the life of the component; backspacing and retyping never refetch.
  const cache = useRef(new Map<string, City[]>());
  const inputRef = useRef<HTMLInputElement>(null);

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
      setActive(cached[0] ? String(cached[0].geonameid) : "");
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
          setActive(cities[0] ? String(cities[0].geonameid) : "");
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

  function select(city: City) {
    setQuery("");
    setResults([]);
    setError(null);
    onSelect(city);
  }

  const showList = open && results.length > 0;
  const showEmpty =
    open && q.length >= 2 && !searching && !error && results.length === 0;
  const listOpen = showList || showEmpty;

  // cmdk clears the controlled value when the list unmounts with the active
  // item in it (closing the popover unregisters every option); reselect the
  // first result whenever the shown list has no active option.
  if (showList && !results.some((city) => String(city.geonameid) === active)) {
    setActive(String(results[0].geonameid));
  }

  return (
    <div>
      <Popover open={listOpen} onOpenChange={setOpen} modal={false}>
        {/* Filtering is server-side (shouldFilter off); cmdk only drives the
            listbox: arrow-key selection with wrap, Enter, and the combobox
            aria wiring on the input. */}
        <Command
          shouldFilter={false}
          loop
          value={active}
          onValueChange={setActive}
          className="overflow-visible bg-transparent p-0"
        >
          <PopoverAnchor asChild>
            <CommandPrimitive.Input
              ref={inputRef}
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                setOpen(true);
                resolveLocally(value);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              placeholder={placeholder}
              disabled={disabled}
              autoFocus={autoFocus}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80"
            />
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) p-1"
            // The input stays the active element: nothing in the list may
            // steal focus, whether on open, on option click, or on close.
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            // Clicking the input itself counts as "outside" the content;
            // closing then would fight the input's own focus/typing handlers.
            onInteractOutside={(e) => {
              if (
                e.target instanceof Node &&
                inputRef.current?.contains(e.target)
              ) {
                e.preventDefault();
              }
            }}
          >
            <CommandList>
              <CommandEmpty>No matching cities</CommandEmpty>
              {results.map((city) => (
                <CommandItem
                  key={city.geonameid}
                  value={String(city.geonameid)}
                  disabled={disabled}
                  onSelect={() => select(city)}
                  className="[&>svg]:hidden"
                >
                  <div className="min-w-0 flex-1">
                    {/* Region on its own line: side by side, a long region
                        would truncate the name down to a letter in narrow
                        dropdowns. */}
                    <span className="block truncate">{city.name}</span>
                    {cityRegion(city) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {cityRegion(city)}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandList>
          </PopoverContent>
          <ActiveDescendantSync
            inputRef={inputRef}
            active={active}
            showList={showList}
          />
        </Command>
      </Popover>
      {/* A live status, not a one-shot action error: it clears itself on the
          next keystroke, so it fades in but never auto-dismisses. */}
      {error && (
        <p className="mt-2 animate-fade-in text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

// cmdk only wires the input's aria-activedescendant (and scrolls the active
// option into view) for selection changes it made itself; changes driven
// through the controlled value prop bypass that path, and cmdk's own renders
// can strip a manually set attribute again. Subscribing to its state from
// inside the Command re-asserts the attribute after every such render.
function ActiveDescendantSync({
  inputRef,
  active,
  showList,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  active: string;
  showList: boolean;
}) {
  const selectedItemId = useCommandState((state) => state.selectedItemId);
  useEffect(() => {
    let frame = 0;
    function sync() {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      const item = active
        ? document.querySelector(
            `[cmdk-item][data-value="${CSS.escape(active)}"]`,
          )
        : null;
      if (showList && !item) {
        // The portaled list can mount a frame after the results render.
        frame = requestAnimationFrame(sync);
        return;
      }
      if (showList && item?.id) {
        if (input.getAttribute("aria-activedescendant") !== item.id) {
          input.setAttribute("aria-activedescendant", item.id);
          item.scrollIntoView({ block: "nearest" });
        }
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }
    sync();
    return () => cancelAnimationFrame(frame);
  }, [inputRef, active, showList, selectedItemId]);
  return null;
}

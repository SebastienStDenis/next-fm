# Concert display data and the Bandsintown venue problem

*Written 2026-07-18 by Claude (Fable 5).*

What each concert-facing surface shows, where every piece of data comes
from (ingestion time versus render time), and how the venue-name problem
in Bandsintown's public API is solved - including the deep dive that
found the fix and the recovery design that was considered and rejected.

The invariant the whole design reduces to: **source data is stored
verbatim and rendered verbatim; the only removal is an exact duplicate
of a string already visible on the same card; enrichment only ever
comes from a strictly better source (V3.1); and what appears is scoped
only by user-controlled filters.** Nothing anywhere infers, rewrites,
or synthesizes a promoter string.

## The problem

Bandsintown's **default** public API path
(`rest.bandsintown.com/artists/{name}/events`) has two kinds of
listings:

- **Plain tour dates** (most shows): `title` is empty and `venue.name`
  is the real venue ("Horseshoe Tavern").
- **Event-page listings** (festivals, branded tours): the event's name
  is stamped into *both* `title` and `venue.name`, and the real venue
  name is absent from the payload - only `venue.street_address` and the
  coordinates still describe the place. Event `108655275` returned
  `title` and `venue.name` both "Outline Festival 2026"; the real venue
  (Knockdown Center) appeared only on Bandsintown's website.

At the time of writing, ~27% of the events in the development database
were event-page listings (2,402 of 8,856), every one with
`title == venue_name`. Left alone, their cards read "Outline Festival
2026 · Outline Festival 2026 · Maspeth, NY".

One more wrinkle: `title == venue_name` does *not* prove the venue is
fake. The Public Records listing (`108489878`) is titled "Public
Records" and really is at the venue Public Records.

## The fix: fetch through V3.1

A deep dive over the official docs plus live probing of 138 events
across 6 artists found exactly one lever, and it solves the problem at
the source:

- **`V3.1/` recovers the real venue.**
  `GET rest.bandsintown.com/V3.1/artists/{name}/events` (same host,
  same `app_id`) returns `venue.name` as the actual venue while keeping
  `title` as the event-page name. Live-verified on all 74 event-page
  listings probed, zero misses, identical event id sets to the default
  path: event `108655275` → "Knockdown Center", Lollapalooza → "Grant
  Park", branded-tour dates → their real clubs.
- **The documented surface is a dead end.** The published spec
  (SwaggerHub PublicAPI 3.0.0/3.0.1) covers only `/artists/{name}`,
  `/artists/id_{id}`, `/artists/{name}/events` with `app_id` and `date`
  params. No single-event endpoint (guessed variants 403), no
  field-selection or venue params; extra params and version headers
  return byte-identical payloads.
- **On the default path, `title != ""` ⇔ `title == venue.name`.**
  Exact across all 138 probed events. The undocumented `festival_*`
  fields are strictly weaker detectors (set on 29/74 event pages - true
  festivals only), `datetime_display_rule` only marks multi-day ranges,
  and `description` is empty on 73/74 event pages and never contains
  the venue.
- **No other backdoor worth using.** The website's event page embeds
  the venue in JSON-LD but is Cloudflare-guarded and outside the API's
  approved use; no oEmbed endpoint exists. Undocumented extras that
  ride along anyway: `venue.street_address` / `postal_code` /
  `location`, and on V3.1 a full `artist` object per event.

`app/bandsintown.py` therefore fetches `/V3.1/...`. The caveat: the
prefix appears in no published spec, so it is an unversioned contract.
The failure modes are both acceptable:

- **V3.1 removed** → every fetch fails loudly (`BandsintownApiError`),
  the events step fails, and the existing sync alerting surfaces it
  (`docs/operations.md`).
On V3.1 data, `title == venue_name` still occurs and is legitimate -
two indistinguishable shapes, both correct as stored: listings named
after their real venue ("Public Records", "Moda Center", club nights
like "BCM Mallorca"), and festivals at ad-hoc grounds whose venue
*entity* is the festival itself ("Phillgood Festival" at Plovdiv's
rowing canal - the festival is the place; `street_address` carries the
physical spot). The card-title rule below renders both the same way,
artist heading over `name · city`, which reads correctly for each; no
detection between them is needed or possible.

- **V3.1 silently regresses to default behavior** → new rows are masked
  again and the UI degrades gracefully: the title-that-repeats-the-venue
  is dropped from the heading (artist names show instead) and the
  event-page name sits in the venue slot - mirroring Bandsintown's own
  artist-heading/event-subheading layout, never a doubled line.

## Backfill

None needed. `EVENT_SYNC_TTL` is 24 hours, so every tracked artist's
events re-fetch within one nightly cycle of deploying the V3.1 switch,
overwriting masked venue names with real ones. To force it immediately:
`update bandsintown_artists set last_synced_at = null;` and run a sync.

## Considered and rejected: render-time venue recovery

An earlier iteration repaired masked rows at read time: take the venue
name that co-located listings (same exact coordinates) unanimously
agree on, else fall back to `street_address`. It worked - and was
removed in favor of V3.1, for reasons worth recording:

- **Coordinate identity is not venue identity.** BASEMENT is a separate
  venue physically inside Knockdown Center. Unanimity only protects
  when both venues' listings are already in the table; with one side
  absent, recovery would confidently relabel the other's events. The
  same failure lurks in city-centroid coordinates Bandsintown sometimes
  substitutes for venues it can't place.
- **The redundancy it fixed is better fixed in display.** A masked
  venue slot always repeats the string shown immediately above it (the
  card title), so hiding it loses nothing - no inference required.
- With V3.1 supplying correct data at ingestion and a 24-hour heal
  cycle, the recovery's only steady-state role was hedging a silent
  V3.1 regression - which the display rule covers with zero risk of
  inventing a wrong venue.

`events.street_address` (nullable, ingested from
`venue.street_address`) is kept: it is the one payload field that still
describes a masked venue, useful for debugging and any future display
need.

## Ingestion time (event sync)

`app/bandsintown.py` parses each V3.1 listing verbatim;
`app/event_sync.py` upserts it. Stored rows stay faithful to the source
payload - no correction is baked in.

- Dropped entirely when missing: external id, parseable `datetime`,
  `venue.name`, coordinates.
- `title`: stored, empty string becomes null.
- `starts_at`: Bandsintown sends venue-local wall-clock time; it is
  labeled UTC (any stray offset discarded) and every consumer formats
  it in UTC to display the original local time.
- `venue_name`, `street_address`: stored verbatim.
- `city_name`: `venue.city`, falling back to `venue.location` (their
  "City, ST" display string), else empty.
- `region` / `country`: stored verbatim; only `region` is displayed.
- Event ↔ artist links come from resolving the listing against the
  artist registry. The raw `lineup` strings are stored verbatim on the
  source row (`bandsintown_events.lineup`, refreshed every sync) but
  deliberately not displayed, so a lineup member we do not track - e.g.
  the headliner of a show matched through their opener - appears only
  behind the Tickets link. Surfacing it is display plumbing on stored
  data, should that ever change; note lineup order is feed-relative
  (the fetched artist first), so it cannot name the headliner.

## What each surface shows

### Concerts tab - event card (`events-panel.tsx`)

| Slot | Value | Computed at |
| --- | --- | --- |
| Card title | `title` - except a title that only repeats `venue_name` (compared trimmed; Bandsintown strings carry stray whitespace) counts as no title - else the card's artist names joined with ", " | render |
| Date | `starts_at` formatted in UTC (wall-clock convention) | ingestion |
| Location line | `venue_name · city_name, region`, always | ingestion |
| Artist chips | qualifying artists only (interest + not hidden + filter); "you might like X" (suggested) / "you listen to X" (known) | render |
| Tickets link | Bandsintown event-page `url`; omitted when null | ingestion |

### Playlists tab - tracklist line

"playing {venue} on {date}" - kept deliberately terse for a long list:
no event title, no year, and the whole "{venue} on {date}" phrase is
the link to the event page (external icon) when a URL exists. For a
masked straggler the event name reads naturally in the venue position.

## Limitations

- `V3.1` is an unversioned contract (see failure modes above).
- Promoter-entered junk titles ("Portland @ Aladdin Theater",
  "Sassy 009 [Live]") display verbatim, as they do on Bandsintown's own
  site. Deliberate: the only safe transformation is the exact-equality
  tautology check above - parsing free-text title formats to "clean
  them up" risks mangling legitimate titles (a containment check, for
  instance, would suppress "Outline Festival 2026 at Knockdown
  Center"), and inelegant-but-true beats tidy-but-wrong.
- `city_name` can be empty when Bandsintown sends neither `city` nor
  `location`; the location line then falls back to the venue alone.

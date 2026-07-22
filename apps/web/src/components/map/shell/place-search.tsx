"use client";
import { useCallback, useRef, useState } from "react";
import { GamertagAutocomplete } from "@/components/controls/gamertag-autocomplete";
import { searchPlaces } from "@/lib/map-places";
import type { MapFocus } from "@/components/map/map-canvas";

/** Zoom a search result flies to: past the `village` tier threshold, so the place you asked
 *  for is actually labelled when you arrive. */
const RESULT_ZOOM = 4;

/** ⚠️ DARK SURFACE. `GamertagAutocomplete` ships no default input styling at all — every call
 *  site supplies it, and all of them are dark today — so the tokens live here. An ink-on-dark
 *  box would render present, functional and invisible; the token test pins the swap. */
const INPUT =
  "w-full border border-dark-line bg-dark-well px-3 py-1.5 font-mono text-base md:text-[11.5px] uppercase tracking-[.04em] text-paper outline-none placeholder:text-cream-muted focus:border-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red";

/** Place search. Reuses the combobox from the controls rail rather than growing a second one —
 *  it already carries the WAI-ARIA 1.2 listbox semantics and the announced result count. Its
 *  `fetchSuggestions` is injected and may resolve synchronously; the reference must be STABLE
 *  (see that component's contract), hence useCallback. */
export function PlaceSearch({ mapCodename, onPick }: {
  mapCodename: string;
  onPick: (focus: MapFocus) => void;
}) {
  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState(false);
  const nonce = useRef(0);

  const fetchSuggestions = useCallback(
    async (q: string) => searchPlaces(mapCodename, q).map((p) => p.name),
    [mapCodename],
  );

  /** Fires on an EXPLICIT pick only, never on a value that merely happens to spell a place.
   *  Inferring a pick from the text flew the map twice for one intent (the last keystroke and
   *  then the click), and hijacked it mid-typing for any name that is a prefix of a longer one
   *  — "Skalisty Island" flies to Skalisty at the 8th character. Exact-match ranking in
   *  `searchPlaces` still matters: it decides which place a typed name OFFERS first. */
  function handlePick(name: string) {
    const hit = searchPlaces(mapCodename, name, 1)[0];
    if (!hit || hit.name.toLowerCase() !== name.trim().toLowerCase()) return;
    nonce.current += 1;
    onPick({ lat: hit.lat, lng: hit.lng, zoom: RESULT_ZOOM, nonce: nonce.current });
    // On a phone the expanded field covers the bar; keep it up after a pick and it hides the
    // very map the pick just flew.
    setExpanded(false);
  }

  return (
    <div className="flex min-w-0 items-center">
      {/* Spec §4: a persistent field cannot share a 360px row with the back link, the map
          name and two controls — the row overflows inside the shell's `overflow-hidden` and
          pushes the friends button, the only route to the accessible legend, off-screen. So
          below `md` the field is a magnifier that expands over the bar. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-label="Search places"
        onClick={() => setExpanded(true)}
        className={`border border-dark-edge px-2 py-1.5 font-mono text-[11px] text-paper md:hidden ${
          expanded ? "invisible" : ""
        }`}
      >
        <span aria-hidden>⌕</span>
      </button>
      <div
        className={
          expanded
            // Same z-40 altitude as the bar it covers — NOT a new one (LAYER LEGEND).
            ? "fixed inset-x-0 top-0 z-40 flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 bg-dark px-2 pt-[env(safe-area-inset-top)] md:static md:h-auto md:bg-transparent md:p-0"
            : "hidden md:block"
        }
      >
        <GamertagAutocomplete
          value={value}
          onChange={setValue}
          onPick={handlePick}
          fetchSuggestions={fetchSuggestions}
          placeholder="Find a place…"
          aria-label="Search places on this map"
          className="w-full md:w-56"
          inputClassName={INPUT}
        />
        <button
          type="button"
          onClick={() => { setExpanded(false); setValue(""); }}
          className="shrink-0 px-2 py-1.5 font-mono text-[11px] uppercase text-cream-dim md:hidden"
        >
          Close
        </button>
      </div>
    </div>
  );
}

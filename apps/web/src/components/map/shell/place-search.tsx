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
  const nonce = useRef(0);
  // Typing a place's full name resolves it, and so does clicking that place in the dropdown —
  // and a click arrives as an onChange carrying the SAME text, so without this the last
  // keystroke and the click both fly. Reset by any different value, so clearing and picking
  // the same place again is still two flights.
  const lastFired = useRef<string | null>(null);

  const fetchSuggestions = useCallback(
    async (q: string) => searchPlaces(mapCodename, q).map((p) => p.name),
    [mapCodename],
  );

  function handleChange(next: string) {
    setValue(next);
    // The combobox reports a pick by setting the value to the exact option text. This is why
    // `searchPlaces` ranks an exact name match above a bigger place containing it: without
    // that, typing "Bor" resolves to Stary Sobor and Bor can never be flown to at all.
    const key = next.trim().toLowerCase();
    if (key !== lastFired.current) lastFired.current = null;
    const hit = searchPlaces(mapCodename, next, 1)[0];
    if (hit && hit.name.toLowerCase() === key && lastFired.current === null) {
      lastFired.current = key;
      nonce.current += 1;
      onPick({ lat: hit.lat, lng: hit.lng, zoom: RESULT_ZOOM, nonce: nonce.current });
    }
  }

  return (
    <GamertagAutocomplete
      value={value}
      onChange={handleChange}
      fetchSuggestions={fetchSuggestions}
      placeholder="Find a place…"
      aria-label="Search places on this map"
      className="w-40 md:w-56"
      inputClassName={INPUT}
    />
  );
}

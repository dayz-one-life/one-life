"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { searchClaimableGamertags } from "@/lib/api";

export function ClaimForm({
  pending, error, onSubmit,
}: {
  pending: boolean; error: string | null;
  onSubmit: (gamertag: string) => void;
}) {
  const [gamertag, setGamertag] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (gamertag.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const q = gamertag.trim();
    const timer = setTimeout(() => {
      searchClaimableGamertags(q).then((results) => setSuggestions(results));
    }, 200);
    return () => clearTimeout(timer);
  }, [gamertag]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); onSubmit(gamertag); }}
    >
      <label className="block text-sm" htmlFor="gamertag">Gamertag</label>
      <Input
        id="gamertag"
        value={gamertag}
        onChange={(e) => { setGamertag(e.target.value); }}
        autoComplete="off"
        required
      />
      {suggestions.length > 0 && (
        <ul className="rounded-md border border-line bg-panel text-sm">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-bg"
                onClick={() => { setGamertag(s); setSuggestions([]); }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Claiming…" : "Claim gamertag"}</Button>
      {error && <p className="text-sm text-blood">{error}</p>}
    </form>
  );
}

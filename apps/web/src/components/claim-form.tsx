"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { Server } from "@/lib/types";

export function ClaimForm({
  servers, pending, error, onSubmit,
}: {
  servers: Server[]; pending: boolean; error: string | null;
  onSubmit: (serverId: number, gamertag: string) => void;
}) {
  const [serverId, setServerId] = useState(servers[0]?.id ?? 0);
  const [gamertag, setGamertag] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); onSubmit(Number(serverId), gamertag); }}
    >
      <label className="block text-sm" htmlFor="server">Server</label>
      <select id="server" aria-label="Server" value={serverId} onChange={(e) => setServerId(Number(e.target.value))}
        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm">
        {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label className="block text-sm" htmlFor="gamertag">Gamertag</label>
      <Input id="gamertag" value={gamertag} onChange={(e) => setGamertag(e.target.value)} required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Claiming…" : "Claim gamertag"}</Button>
      {error && <p className="text-sm text-blood">{error}</p>}
    </form>
  );
}

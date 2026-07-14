import { Button } from "./ui/button";
import type { GamertagLink } from "@/lib/types";

export function LinksList({
  links, onCancel,
}: { links: GamertagLink[]; onCancel: (id: number) => void }) {
  if (links.length === 0) return <p className="text-muted">No gamertag links yet.</p>;
  return (
    <ul className="space-y-2">
      {links.map((l) => (
        <li key={l.id} className="flex items-center justify-between rounded border border-line p-3">
          <div>
            <span className="font-semibold">{l.gamertag}</span>
            <span className="ml-2 text-xs text-muted">server {l.serverId}</span>
            {l.status === "pending" && l.challenge && (
              <span className="ml-2 text-xs text-muted">
                {l.challenge.progressIndex}/{l.challenge.sequence.length} emotes
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm capitalize">{l.status}</span>
            {l.status === "pending" && (
              <Button className="bg-panel-2 text-bone" onClick={() => onCancel(l.id)}>Cancel</Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

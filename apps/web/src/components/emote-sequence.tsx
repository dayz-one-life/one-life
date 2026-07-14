import type { Challenge } from "@/lib/types";

export function EmoteSequence({ challenge }: { challenge: Challenge }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        In game, perform these emotes in order ({challenge.progressIndex}/{challenge.sequence.length} done):
      </p>
      {challenge.expired && <p className="text-sm text-blood">This challenge has expired — start a new claim.</p>}
      <ol className="space-y-1">
        {challenge.sequence.map((emote, i) => {
          const done = i < challenge.progressIndex;
          return (
            <li key={i} data-done={String(done)}
              className={done ? "flex items-center gap-2 font-mono line-through opacity-60" : "flex items-center gap-2 font-mono"}>
              <span className="w-5 text-muted">{i + 1}.</span>
              <span>{emote}</span>
              {done && <span className="text-amber">✓</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

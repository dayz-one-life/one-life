import { cn } from "@/lib/utils";

const MAP_STYLES: Record<string, string> = {
  chernarus: "border-blue bg-blue text-blue",
  sakhal: "border-sky-800 bg-sky-950 text-sky-300",
};

const DEFAULT_STYLE = "border-line bg-panel-2 text-muted";

export function MapBadge({ slug }: { slug: string }) {
  return (
    <span
      data-testid="row-map-badge"
      className={cn(
        "inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        MAP_STYLES[slug] ?? DEFAULT_STYLE
      )}
    >
      {slug}
    </span>
  );
}

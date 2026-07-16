export function MapBadge({ slug }: { slug: string }) {
  return (
    <span
      data-testid="row-map-badge"
      className="inline-block rounded border border-hairline bg-tint px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft"
    >
      {slug}
    </span>
  );
}

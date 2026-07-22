import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TrackMarkerList } from "./track-marker-list";
import type { TrackMarkerDto } from "@/lib/types";

const markers: TrackMarkerDto[] = [
  { kind: "kill", at: "2026-07-14T01:10:00Z", x: 5000, y: 5000, sampleAt: "2026-07-14T01:05:00Z", sampleAgeSeconds: 300, label: "Victim1" },
  { kind: "death", at: "2026-07-14T02:00:00Z", x: 6000, y: 6000, sampleAt: "2026-07-14T01:59:00Z", sampleAgeSeconds: 60, label: null },
];

describe("TrackMarkerList", () => {
  it("is a real list — a map is unusable to a screen reader", () => {
    render(<TrackMarkerList markers={markers} />);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("states the fix age on every entry, so nothing reads as an exact position", () => {
    render(<TrackMarkerList markers={markers} />);
    expect(screen.getByText(/5m before/i)).toBeInTheDocument();
    expect(screen.getByText(/1m before/i)).toBeInTheDocument();
  });

  it("ages a `now` marker against the CLOCK, not its own zero sampleAgeSeconds", () => {
    // A now-marker's fix IS the event, so sampleAgeSeconds is 0 by construction. Reading
    // that as "0s" would tell an alive player their position is current when it may be
    // minutes old. Spec §4.5.
    const nowMarker = {
      kind: "now" as const, at: "2026-07-14T03:00:00Z", x: 7000, y: 7000,
      sampleAt: "2026-07-14T03:00:00Z", sampleAgeSeconds: 0, label: null,
    };
    render(<TrackMarkerList markers={[nowMarker]} now={Date.parse("2026-07-14T03:04:00Z")} />);
    expect(screen.getByText(/last fix 4m ago/i)).toBeInTheDocument();
    expect(screen.queryByText(/0s/)).toBeNull();
  });

  it("names the victim on a kill", () => {
    render(<TrackMarkerList markers={markers} />);
    expect(screen.getByText(/Victim1/)).toBeInTheDocument();
  });

  it("renders nothing rather than an empty list when there are no markers", () => {
    const { container } = render(<TrackMarkerList markers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

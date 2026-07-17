export interface BirthNoticeTarget {
  lifeId: number;         // CURRENT id — transient (loads getLifeTimeline in the tick); never stored
  serverId: number;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  lifeStartedAt: Date;    // natural-key: which life (rebuild-stable) + feed order
  endedAt: Date | null;   // set only if the life already died before the sweep
}

// The DTO types now live in @onelife/api-client so the mobile client can share them.
// This module stays as the web app's import site: ~50 files import from "@/lib/types".
export type * from "@onelife/api-client";

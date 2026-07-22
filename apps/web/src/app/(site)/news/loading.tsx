import { ObituariesSkeleton } from "@/components/skeletons";

/** The news feed's cards are the same shape as the morgue's — dateline, headline, dek — so it
 *  reuses the same skeleton, exactly as the fresh-spawns route does. */
export default function Loading() {
  return <ObituariesSkeleton />;
}

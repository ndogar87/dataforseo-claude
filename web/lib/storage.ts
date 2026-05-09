/**
 * Pure helpers for the `deliverables` Storage bucket. No server-only
 * marker — these are safe to import from anywhere because they don't
 * touch the network or env vars.
 */

const BUCKET_PREFIX = "deliverables/";

/**
 * Strip the bucket prefix from a Storage path. The worker writes paths
 * like `deliverables/<task>/<file>`; the Storage API operates on the
 * object path *inside* the bucket.
 */
export function stripBucketPrefix(storagePath: string): string {
  return storagePath.startsWith(BUCKET_PREFIX)
    ? storagePath.slice(BUCKET_PREFIX.length)
    : storagePath;
}

/** Per-map experimental automatic cleanup toggles stored in `ap_map.next_bookmarks`. */

export type ExperimentalAutoCleanupSettings = {
  autoSignatureCleanup: boolean;
  autoMapCleanup: boolean;
};

export const DEFAULT_EXPERIMENTAL_AUTO_CLEANUP: ExperimentalAutoCleanupSettings = {
  autoSignatureCleanup: false,
  autoMapCleanup: false,
};

type NextBookmarksExperimental = {
  signatureCleanup?: boolean;
  mapCleanup?: boolean;
};

/** Read experimental auto-cleanup flags from `ap_map.next_bookmarks` (default off). */
export function parseExperimentalAutoCleanupFromNextBookmarks(
  raw: unknown,
): ExperimentalAutoCleanupSettings {
  if (raw === null || raw === undefined) return { ...DEFAULT_EXPERIMENTAL_AUTO_CLEANUP };
  if (Array.isArray(raw)) return { ...DEFAULT_EXPERIMENTAL_AUTO_CLEANUP };
  if (typeof raw !== 'object') return { ...DEFAULT_EXPERIMENTAL_AUTO_CLEANUP };
  const exp = (raw as { experimentalAutoCleanup?: NextBookmarksExperimental })
    .experimentalAutoCleanup;
  if (!exp || typeof exp !== 'object') return { ...DEFAULT_EXPERIMENTAL_AUTO_CLEANUP };
  return {
    autoSignatureCleanup: exp.signatureCleanup === true,
    autoMapCleanup: exp.mapCleanup === true,
  };
}

/** Merge experimental auto-cleanup flags into `next_bookmarks`, preserving other keys. */
export function mergeExperimentalAutoCleanupIntoNextBookmarks(
  raw: unknown,
  patch: Partial<ExperimentalAutoCleanupSettings>,
): unknown {
  const current = parseExperimentalAutoCleanupFromNextBookmarks(raw);
  const next: ExperimentalAutoCleanupSettings = { ...current, ...patch };
  const base: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : Array.isArray(raw)
        ? { bookmarks: raw }
        : { bookmarks: [] };
  return {
    ...base,
    experimentalAutoCleanup: {
      signatureCleanup: next.autoSignatureCleanup,
      mapCleanup: next.autoMapCleanup,
    },
  };
}
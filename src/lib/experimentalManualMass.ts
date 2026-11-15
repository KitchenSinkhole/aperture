/**
 * Session-scoped connection ids whose `massStatus` was set manually (keys, menu,
 * popover). Auto-mass from jump log must not overwrite these.
 */
const locked = new Set<string>();

export function lockManualConnectionMass(connectionId: string): void {
  locked.add(connectionId);
}

export function isManualConnectionMassLocked(connectionId: string): boolean {
  return locked.has(connectionId);
}

export function clearManualConnectionMassLock(connectionId: string): void {
  locked.delete(connectionId);
}

/** Test helper */
export function resetManualConnectionMassLocks(): void {
  locked.clear();
}
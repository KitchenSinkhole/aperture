/**
 * Whether a local signature draft row should sync to the server.
 * Drafts without a SIG id are discarded on blur; once a non-empty id is present, sync proceeds.
 */
export function shouldSyncSignatureDraft(sigId: string | null | undefined): boolean {
  const trimmed = (sigId ?? '').trim();
  return trimmed.length > 0;
}

import { requestJson, type FetchResult } from '@/lib/http/fetchJson';
import type { SystemNote, SystemNoteSearchResult } from '@/types';

/**
 * Browser-side fetch wrappers for the global system-note REST routes. Unlike
 * the map mutations, these carry no `eventId` (notes emit no realtime event):
 * the caller awaits the returned `SystemNote` and splices it into local state
 * directly. Network/error handling + toasts live in `requestJson`.
 */

export type CreateSystemNoteBody = {
  /** The map the note is written on — the server derives the row's scope from it. */
  mapId: string;
  systemId: number;
  body: string;
  category?: string | null;
  locked?: boolean;
};

export type UpdateSystemNoteBody = {
  body?: string;
  category?: string | null;
  locked?: boolean;
};

export function createSystemNoteOnServer(
  body: CreateSystemNoteBody,
): Promise<FetchResult<SystemNote>> {
  return requestJson<FetchResult<SystemNote>>('POST', '/api/system-notes', body);
}

export function updateSystemNoteOnServer(args: {
  noteId: string;
  patch: UpdateSystemNoteBody;
}): Promise<FetchResult<SystemNote>> {
  return requestJson<FetchResult<SystemNote>>(
    'PATCH',
    `/api/system-notes/${args.noteId}`,
    args.patch,
  );
}

export function deleteSystemNoteOnServer(args: {
  noteId: string;
}): Promise<FetchResult<{ id: string }>> {
  return requestJson<FetchResult<{ id: string }>>('DELETE', `/api/system-notes/${args.noteId}`);
}

/** Deployment-wide note search for the notes browser. The caller debounces. */
export function searchSystemNotesOnServer(
  query: string,
): Promise<FetchResult<SystemNoteSearchResult[]>> {
  return requestJson<FetchResult<SystemNoteSearchResult[]>>(
    'GET',
    `/api/system-notes/search?q=${encodeURIComponent(query)}`,
  );
}

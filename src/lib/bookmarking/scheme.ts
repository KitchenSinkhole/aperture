import localOverride from '#bookmark-local';
import { referenceScheme } from './reference';
import type { BookmarkScheme } from './types';

export const effectiveBookmarkScheme: BookmarkScheme = localOverride ?? referenceScheme;

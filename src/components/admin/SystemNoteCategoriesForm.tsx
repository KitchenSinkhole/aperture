'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { adminSetSystemNoteCategories } from '@/app/(admin)/actions/settings';
import {
  MAX_SYSTEM_NOTE_CATEGORIES,
  SYSTEM_NOTE_CHIP_COLORS,
  systemNoteCategoriesSchema,
  type SystemNoteCategoryDef,
  type SystemNoteChipColor,
} from '@/lib/system-notes/categories';

/**
 * Global-admin editor for the system-note category vocabulary
 * (`/admin/settings`). Rows of key + chip colour; the same Zod shape the server
 * enforces validates before submit so errors name the offending row locally.
 * Removing a key never rewrites notes — stored legacy keys render as neutral
 * chips.
 */
export function SystemNoteCategoriesForm({ initial }: { initial: SystemNoteCategoryDef[] }) {
  const [rows, setRows] = useState<{ key: string; color: SystemNoteChipColor }[]>(initial);
  const [pending, startTransition] = useTransition();

  function setRow(index: number, patch: Partial<SystemNoteCategoryDef>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function onSave() {
    const parsed = systemNoteCategoriesSchema.safeParse(rows);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid vocabulary.');
      return;
    }
    startTransition(async () => {
      const result = await adminSetSystemNoteCategories({ categories: parsed.data });
      if (result.ok) toast.success('Category vocabulary saved.');
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex max-w-sm flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={row.key}
            disabled={pending}
            onChange={(e) => setRow(i, { key: e.target.value.toLowerCase() })}
            placeholder="key"
            aria-label={`Category ${i + 1} key`}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
          />
          <Select
            value={row.color}
            disabled={pending}
            onValueChange={(color) => setRow(i, { color: color as SystemNoteChipColor })}
          >
            <SelectTrigger className="w-28" aria-label={`Category ${i + 1} colour`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYSTEM_NOTE_CHIP_COLORS.map((c) => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Remove category"
            disabled={pending || rows.length <= 1}
            onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          size="xs"
          variant="outline"
          className="gap-1"
          disabled={pending || rows.length >= MAX_SYSTEM_NOTE_CATEGORIES}
          onClick={() => setRows((prev) => [...prev, { key: '', color: 'gray' }])}
        >
          <Plus className="size-3" />
          Add category
        </Button>
        <Button type="button" onClick={onSave} disabled={pending}>
          Save
        </Button>
      </div>
    </div>
  );
}

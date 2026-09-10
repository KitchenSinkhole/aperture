'use client';

import { useState } from 'react';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StructureFormDialog, type StructureFormValues } from './StructureFormDialog';
import { IntelScopeChip } from './IntelScopeChip';
import { ccpImageUrl } from '@/lib/integrations/links';
import type { MapSystemNode, MapType, StructureIntel } from '@/types';

/**
 * Sidebar module for manual structure intel on the selected system. Lists
 * structures, opens a dialog to add/edit, and deletes. A row's audience is its
 * own `scope`, which need not match the open map: the read filter follows the
 * viewer, so a member on a corp map also sees their alliance's rows and their
 * own private ones side by side (see `src/lib/structures/read.ts`).
 *
 * Inert when `enabled` is false — the whole feature belongs to the entity that
 * owns the map, so a guest gets an explanation instead of a list and no way to
 * add a row the server would refuse.
 *
 * Not realtime-synced — another user's edits show on the next page load.
 */
export function StructureModule({
  system,
  enabled,
  structures,
  mapType,
  onCreate,
  onPatch,
  onDelete,
}: {
  system: MapSystemNode | null;
  /** Whether the viewer belongs to the map's owning entity; false disables the module. */
  enabled: boolean;
  structures: StructureIntel[];
  /** The open map's type; a new row's scope is derived from it server-side. */
  mapType: MapType;
  onCreate: (values: StructureFormValues) => void;
  onPatch: (structureId: string, values: StructureFormValues) => void;
  onDelete: (structureId: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StructureIntel | null>(null);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(structure: StructureIntel) {
    setEditing(structure);
    setDialogOpen(true);
  }

  function onSubmit(values: StructureFormValues) {
    if (editing) onPatch(editing.id, values);
    else onCreate(values);
  }

  if (!enabled) {
    return (
      <Card size="sm">
        <CardContent className="text-xs text-muted-foreground">
          Structure intel belongs to the corporation or alliance that owns this map, so it is not
          available to you here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      {system ? (
        <CardHeader className="flex flex-row items-center justify-end">
          <Button size="xs" variant="outline" className="gap-1" onClick={openAdd}>
            <Plus className="size-3" />
            Add
          </Button>
        </CardHeader>
      ) : null}
      <CardContent className="flex flex-col gap-2 text-xs">
        {!system ? (
          <p className="text-muted-foreground">Select a system to see structures.</p>
        ) : structures.length === 0 ? (
          <p className="text-muted-foreground">No structures recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {structures.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 rounded border border-border p-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Building2 className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{s.name}</span>
                    <IntelScopeChip scope={s.scope} />
                  </span>
                  <span className="text-muted-foreground">{s.typeName}</span>
                  {s.ownerName ? (
                    <span className="flex items-center gap-1.5 truncate">
                      {s.ownerCorporationId !== null ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ccpImageUrl('corporations', s.ownerCorporationId, 'logo', 32)}
                          alt=""
                          className="size-4 shrink-0 rounded-sm"
                        />
                      ) : null}
                      <span className="truncate">{s.ownerName}</span>
                    </span>
                  ) : null}
                  {s.notes ? <span className="text-muted-foreground">{s.notes}</span> : null}
                  {s.createdByName ? (
                    <span className="text-[10px] text-muted-foreground">added by {s.createdByName}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Edit structure"
                    onClick={() => openEdit(s)}
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Delete structure"
                    onClick={() => onDelete(s.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {system ? (
        <StructureFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          systemName={system.alias?.trim() || system.name}
          mapType={mapType}
          initial={editing ?? undefined}
          onSubmit={onSubmit}
        />
      ) : null}
    </Card>
  );
}

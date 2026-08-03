'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { getMapDelegationState, setMapDelegation } from '@/app/(app)/actions/mapRoles';
import type { MapCapability, MapDelegationState } from '@/types';

// The `view` capability is the implicit visibility overlay — never a toggle.
type DelegatableCapability = Exclude<MapCapability, 'view'>;

// The delegatable director features (the `view` capability is implicit).
const CAPABILITY_COLUMNS: { capability: DelegatableCapability; label: string }[] = [
  { capability: 'audit_view', label: 'Audit log' },
  { capability: 'settings_manage', label: 'Settings' },
  { capability: 'webhooks_manage', label: 'Webhooks' },
  { capability: 'share_manage', label: 'Share links' },
  { capability: 'map_import', label: 'Import' },
  { capability: 'map_export', label: 'Export' },
  { capability: 'map_delete', label: 'Delete' },
];

/**
 * Roles & Permissions matrix for a corp map's Settings dialog. Lets a manager
 * toggle each delegatable feature per corporation title; a granted title's
 * holders gain that feature without becoming a Director. Manager-gated by the
 * dialog (`canManage`); the server actions re-check `canManageMap`.
 */
export function MapRolesForm({ mapId }: { mapId: string }) {
  const [state, setState] = useState<MapDelegationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await getMapDelegationState(mapId);
      if (result.ok) {
        setState(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [mapId]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(roleId: string, capability: DelegatableCapability, enabled: boolean) {
    // Optimistic flip; revert from the server on failure.
    setState((prev) => {
      if (!prev || !prev.available) return prev;
      return {
        available: true,
        roles: prev.roles.map((r) =>
          r.roleId === roleId
            ? {
                ...r,
                capabilities: enabled
                  ? [...r.capabilities, capability]
                  : r.capabilities.filter((c) => c !== capability),
              }
            : r,
        ),
      };
    });
    startTransition(async () => {
      const result = await setMapDelegation({ mapId, roleId, capability, enabled });
      if (!result.ok) {
        toast.error(result.error);
        load();
      }
    });
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!state) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!state.available) {
    return (
      <p className="text-sm text-muted-foreground">
        Feature delegation is available on corporation maps only.
      </p>
    );
  }
  if (state.roles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This corporation has no titles to delegate to yet. Titles sync from EVE as members holding
        them sign in.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Grant individual director features to a corporation title. Holders of a granted title gain
        that feature without becoming a Director; Directors and admins hold every feature already.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Title</th>
              {CAPABILITY_COLUMNS.map((c) => (
                <th key={c.capability} className="px-2 py-1.5 text-center font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.roles.map((role) => (
              <tr key={role.roleId} className="border-t border-foreground/10">
                <td className="px-2 py-1.5 font-medium">{role.label}</td>
                {CAPABILITY_COLUMNS.map((c) => (
                  <td key={c.capability} className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={role.capabilities.includes(c.capability)}
                      disabled={pending}
                      onChange={(e) => toggle(role.roleId, c.capability, e.target.checked)}
                      aria-label={`${c.label} for ${role.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

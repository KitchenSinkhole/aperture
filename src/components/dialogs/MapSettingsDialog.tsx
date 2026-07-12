'use client';

import { useRef, useState, useTransition } from 'react';
import { Download, Save, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateMapSettingsAction } from '@/app/(app)/actions/map';
import { exportMapOnServer, importMapOnServer } from '@/lib/map/client';
import { readLowContrast, writeLowContrast } from '@/lib/lowContrast';
import { readWhPickerPrefs, writeWhPickerPrefs } from '@/lib/wormholePickerPrefs';
import { MapBehaviorForm } from '@/components/map/manage/MapBehaviorForm';
import { MapTaggingForm } from '@/components/map/manage/MapTaggingForm';
import { MapWebhooksPanel } from '@/components/map/manage/MapWebhooksPanel';
import { MapRolesForm } from '@/components/map/manage/MapRolesForm';
import type { MapCapability, MapEventPayload, MapSettings } from '@/types';

/**
 * Map Settings dialog — the consolidated edit / settings / management /
 * import-export surface, launched from the `MapCanvas` toolbar. General
 * persists via `updateMapSettingsAction` (`map_update`). Each management tab is
 * revealed by the viewer's delegated capability (`capabilities`, resolved from
 * `resolveMapCapabilities`; a manager holds all): Behavior + Auto-tagging ←
 * `settings_manage`, Webhooks ← `webhooks_manage`, Export ← `map_export`,
 * Import ← `map_import` — all re-checked server-side. The Roles & Permissions
 * tab (delegating features to titles) is manager-only (`canManage`). The audit
 * log lives in its own wider dialog (`MapAuditDialog`).
 */
export function MapSettingsDialog({
  open,
  onOpenChange,
  mapId,
  settings,
  canManage,
  capabilities,
  systems,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapId: string;
  settings: MapSettings;
  /** Whether the viewer can manage this map — reveals the manager-only Roles & Permissions tab. */
  canManage: boolean;
  /** Delegated capabilities the viewer holds — reveals each management tab (a manager holds all). */
  capabilities: MapCapability[];
  /** Visible map systems for the Auto-tagging Home picker. */
  systems: { id: string; name: string; alias: string | null }[];
  /** Fold imported event payloads onto the live canvas (reuses the bulk-paste handler). */
  onImported: (payloads: MapEventPayload[]) => void;
}) {
  const can = (capability: MapCapability) => capabilities.includes(capability);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Map settings</DialogTitle>
          <DialogDescription className="capitalize">
            {settings.type} · {settings.scope}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTab value="general">General</TabsTab>
            <TabsTab value="settings">Settings</TabsTab>
            {can('settings_manage') && <TabsTab value="behavior">Behavior</TabsTab>}
            {can('settings_manage') && <TabsTab value="tagging">Auto-tagging</TabsTab>}
            {can('webhooks_manage') && <TabsTab value="webhooks">Webhooks</TabsTab>}
            {can('map_export') && <TabsTab value="export">Export</TabsTab>}
            {can('map_import') && <TabsTab value="import">Import</TabsTab>}
            {canManage && <TabsTab value="roles">Roles &amp; Permissions</TabsTab>}
          </TabsList>

          <TabsPanel value="general">
            <GeneralPanel mapId={mapId} settings={settings} />
          </TabsPanel>
          <TabsPanel value="settings">
            <SettingsPanel />
          </TabsPanel>
          {can('settings_manage') && (
            <TabsPanel value="behavior">
              <MapBehaviorForm
                mapId={mapId}
                initialValues={{
                  deleteExpiredConnections: settings.deleteExpiredConnections,
                  deleteEolConnections: settings.deleteEolConnections,
                  trackAbyssalJumps: settings.trackAbyssalJumps,
                  logActivity: settings.logActivity,
                }}
              />
            </TabsPanel>
          )}
          {can('settings_manage') && (
            <TabsPanel value="tagging">
              <MapTaggingForm
                mapId={mapId}
                initialScheme={settings.tagScheme}
                initialHomeMapSystemId={settings.homeMapSystemId}
                initialExemptHomeStatic={settings.exemptHomeStaticFromTag}
                systems={systems}
              />
            </TabsPanel>
          )}
          {can('webhooks_manage') && (
            <TabsPanel value="webhooks">
              <MapWebhooksPanel mapId={mapId} />
            </TabsPanel>
          )}
          {can('map_export') && (
            <TabsPanel value="export">
              <ExportPanel mapId={mapId} mapName={settings.name} />
            </TabsPanel>
          )}
          {can('map_import') && (
            <TabsPanel value="import">
              <ImportPanel mapId={mapId} onImported={onImported} />
            </TabsPanel>
          )}
          {canManage && (
            <TabsPanel value="roles">
              <MapRolesForm mapId={mapId} />
            </TabsPanel>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPanel() {
  // Client-only display prefs, persisted to localStorage. The lazy initializer
  // reads localStorage on first render; safe because this panel only mounts once
  // the dialog opens (never during SSR), so there's no hydration mismatch.
  const [lowContrast, setLowContrast] = useState(readLowContrast);
  const [whPicker, setWhPicker] = useState(readWhPickerPrefs);

  function onToggleLowContrast(next: boolean) {
    setLowContrast(next);
    writeLowContrast(next);
  }

  function setWhPickerPref(patch: Partial<typeof whPicker>) {
    const next = { ...whPicker, ...patch };
    setWhPicker(next);
    writeWhPickerPrefs(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        These preferences are stored on this device only.
      </p>

      <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">Low-contrast theme</span>
          <span className="text-xs text-muted-foreground">
            Softens the interface contrast. Off by default.
          </span>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={lowContrast}
          onChange={(e) => onToggleLowContrast(e.target.checked)}
          aria-label="Low-contrast theme"
        />
      </label>

      <label className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium text-foreground">Group wormhole types by category</span>
          <span className="text-xs text-muted-foreground">
            Organizes the signature type picker into Statics, K162s, wandering, and frig-hole
            groups — with wandering and frig holes ordered by class — instead of one alphabetical
            list. On by default.
          </span>
        </div>
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={whPicker.grouped}
          onChange={(e) => setWhPickerPref({ grouped: e.target.checked })}
          aria-label="Group wormhole types by category"
        />
      </label>
    </div>
  );
}

function GeneralPanel({ mapId, settings }: { mapId: string; settings: MapSettings }) {
  const [name, setName] = useState(settings.name);
  const [icon, setIcon] = useState(settings.icon ?? '');
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required.');
      return;
    }
    startTransition(async () => {
      const result = await updateMapSettingsAction({
        mapId,
        name: name.trim(),
        icon: icon.trim() === '' ? null : icon.trim(),
      });
      if (result.ok) toast.success('Map updated.');
      else toast.error(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="map-settings-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="map-settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="map-settings-icon" className="text-sm font-medium">
          Icon <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="map-settings-icon"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          maxLength={100}
          placeholder="e.g. fa-home"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Scope (<span className="capitalize">{settings.scope}</span>) and visibility (
        <span className="capitalize">{settings.type}</span>) are fixed when the map is created and
        cannot be changed.
      </p>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save />
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}


function ExportPanel({ mapId, mapName }: { mapId: string; mapName: string }) {
  const [pending, startTransition] = useTransition();

  function onExport() {
    startTransition(async () => {
      const result = await exportMapOnServer({ mapId });
      if (!result.ok) return; // wrapper already toasted
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aperture-map-${mapId}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Map exported.');
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Download “{mapName}” as a JSON file — its systems, connections, and signatures. Re-import it
        into another map to copy the chain.
      </p>
      <div className="flex justify-end">
        <Button type="button" onClick={onExport} disabled={pending}>
          <Download />
          {pending ? 'Preparing…' : 'Download JSON'}
        </Button>
      </div>
    </div>
  );
}

function ImportPanel({
  mapId,
  onImported,
}: {
  mapId: string;
  onImported: (payloads: MapEventPayload[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    startTransition(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        toast.error('Could not read file as JSON.');
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
      const result = await importMapOnServer({ mapId, data: parsed });
      if (inputRef.current) inputRef.current.value = '';
      if (!result.ok) return; // wrapper already toasted
      onImported(result.data.payloads);
      const { systems, connections, signatures } = result.data.summary;
      toast.success(
        `Imported ${systems} system(s), ${connections} connection(s), ${signatures} signature(s).`,
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Choose a map-export JSON file. Its systems, connections, and signatures are{' '}
        <span className="font-medium text-foreground">merged into this map</span> (existing systems
        keep their place; nothing is removed).
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        onChange={onFile}
        disabled={pending}
        className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
      />
      {pending && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Upload className="size-3" />
          Importing…
        </p>
      )}
    </div>
  );
}

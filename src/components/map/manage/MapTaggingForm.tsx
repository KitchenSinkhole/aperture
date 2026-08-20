'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateMapSettingsAction } from '@/app/(app)/actions/map';

type TagScheme = 'none' | 'abc' | '0121';

const TAG_SCHEME_OPTIONS: { value: TagScheme; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'abc', label: 'ABC — per-class letters' },
  { value: '0121', label: '0121 — chain numbering' },
];
const TAG_SCHEME_LABELS = Object.fromEntries(TAG_SCHEME_OPTIONS.map((o) => [o.value, o.label]));

const NO_HOME = '';
const NO_HOME_LABEL = '— None —';

/**
 * Auto-tagging config for the in-map Settings → Auto-tagging tab. Persists via
 * `updateMapSettingsAction` (gated by `settings_manage`); the Home picker is fed
 * the map's visible systems.
 */
export function MapTaggingForm({
  mapId,
  initialScheme,
  initialHomeMapSystemId,
  initialExemptHomeStatic,
  systems,
}: {
  mapId: string;
  initialScheme: TagScheme;
  initialHomeMapSystemId: string | null;
  initialExemptHomeStatic: boolean;
  systems: { id: string; name: string; alias: string | null }[];
}) {
  const [scheme, setScheme] = useState<TagScheme>(initialScheme);
  const [homeMapSystemId, setHomeMapSystemId] = useState(initialHomeMapSystemId ?? '');
  const [exemptHomeStatic, setExemptHomeStatic] = useState(initialExemptHomeStatic);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const canExempt = scheme === 'abc' && homeMapSystemId !== '';

  const homeLabels: Record<string, string> = {
    [NO_HOME]: NO_HOME_LABEL,
    ...Object.fromEntries(
      systems.map((s) => [s.id, s.alias ? `${s.alias} (${s.name})` : s.name]),
    ),
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateMapSettingsAction({
        mapId,
        tagScheme: scheme,
        homeMapSystemId: homeMapSystemId === '' ? null : homeMapSystemId,
        exemptHomeStaticFromTag: exemptHomeStatic,
      });
      if (result.ok) {
        toast.success('Tagging updated.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Auto-tagging scheme</span>
        <Select<TagScheme>
          value={scheme}
          onValueChange={(v) => v && setScheme(v)}
          items={TAG_SCHEME_LABELS}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAG_SCHEME_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Newly discovered systems are tagged automatically. ABC assigns per-class letters; 0121
          numbers each system by its position in the chain off Home.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Home system</span>
        <Select<string>
          value={homeMapSystemId}
          onValueChange={(v) => setHomeMapSystemId(v ?? NO_HOME)}
          items={homeLabels}
          disabled={scheme === 'none'}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_HOME}>{NO_HOME_LABEL}</SelectItem>
            {systems.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.alias ? `${s.alias} (${s.name})` : s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The central node both schemes calculate from. It cannot be removed from the map while
          designated.
        </p>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary disabled:opacity-50"
          checked={exemptHomeStatic}
          disabled={!canExempt}
          onChange={(e) => setExemptHomeStatic(e.target.checked)}
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">Exempt home static from auto-tag</span>
          <span className="text-xs text-muted-foreground">
            ABC only. Leave the system on the far side of Home&apos;s static connection untagged — its
            letter is freed for reclaim. Mark the connection as Static via its right-click menu.
          </span>
        </span>
      </label>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save />
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

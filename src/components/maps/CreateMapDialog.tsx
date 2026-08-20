'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createMapAction } from '@/app/(app)/actions/map';

type Scope = 'wh' | 'k_space' | 'none' | 'all';
type MapType = 'private' | 'corp' | 'alliance';

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'wh', label: 'Wormhole' },
  { value: 'k_space', label: 'K-space' },
  { value: 'all', label: 'All systems' },
  { value: 'none', label: 'None' },
];

const TYPE_OPTIONS: { value: MapType; label: string }[] = [
  { value: 'private', label: 'Private' },
  { value: 'corp', label: 'Corporation' },
  { value: 'alliance', label: 'Alliance' },
];

const SCOPE_LABELS = Object.fromEntries(SCOPE_OPTIONS.map((o) => [o.value, o.label]));
const TYPE_LABELS = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));

// Why the option is unavailable, mirroring `canCreateMap`. Rendered inline on
// the item rather than as a tooltip: a disabled option is pointer-events-none,
// so nothing hover-triggered would ever fire on it.
const TYPE_REQUIREMENT: Record<Exclude<MapType, 'private'>, string> = {
  corp: 'Directors only',
  alliance: 'Executor-corp Directors only',
};

export function CreateMapDialog({
  canCreateCorp,
  canCreateAlliance,
}: {
  canCreateCorp: boolean;
  canCreateAlliance: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('wh');
  const [type, setType] = useState<MapType>('private');
  const [pending, startTransition] = useTransition();

  const allowed: Record<MapType, boolean> = {
    private: true,
    corp: canCreateCorp,
    alliance: canCreateAlliance,
  };
  const restricted = TYPE_OPTIONS.filter((o) => !allowed[o.value]);

  function reset() {
    setName('');
    setScope('wh');
    setType('private');
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required.');
      return;
    }
    startTransition(async () => {
      const result = await createMapAction({ name, scope, type });
      if (result.ok) {
        toast.success(`Map "${name.trim()}" created.`);
        reset();
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="gap-1.5">
            <Plus />
            New map
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a map</DialogTitle>
          <DialogDescription>Name the map and choose its scope and visibility.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="map-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="map-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Home chain"
              autoFocus
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Scope</span>
              <Select<Scope>
                value={scope}
                onValueChange={(v) => v && setScope(v)}
                items={SCOPE_LABELS}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Visibility</span>
              <Select<MapType>
                value={type}
                onValueChange={(v) => v && setType(v)}
                items={TYPE_LABELS}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} disabled={!allowed[o.value]}>
                      <span className="flex w-full items-baseline justify-between gap-3">
                        {o.label}
                        {!allowed[o.value] && o.value !== 'private' && (
                          <span className="text-xs text-muted-foreground">
                            {TYPE_REQUIREMENT[o.value]}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {restricted.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {restricted.length === TYPE_OPTIONS.length - 1
                ? 'Corporation maps can only be created by a corporation Director, and alliance maps by a Director of the alliance executor corporation.'
                : restricted[0]!.value === 'corp'
                  ? 'Corporation maps can only be created by a corporation Director.'
                  : 'Alliance maps can only be created by a Director of the alliance executor corporation.'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create map'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

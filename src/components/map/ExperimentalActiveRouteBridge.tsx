'use client';

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { setMapActiveRouteAction } from '@/app/(app)/actions/mapActiveRoute';
import { pushKspaceWaypointsForCharacter } from '@/lib/character/pushRouteWaypoints';
import { getSoundEngine, useSoundCueOn, useSoundPrefs } from '@/lib/sounds/engine';
import {
  activeRouteConnectionIds,
  followersOffRoute,
  isOnActiveRoute,
  routeConnectionsById,
} from '@/lib/map/activeRouteMonitor';
import { requestJson } from '@/lib/http/fetchJson';
import type {
  MapActiveRouteView,
  MapConnectionEdge,
  MapPresenceEntry,
  RoutePlan,
  RoutePrefs,
} from '@/types';

export function ExperimentalActiveRouteBridge({
  mapId,
  activeRoute,
  routePrefs,
  presence,
  connections,
  primaryCharacterId,
  onRouteUpdated,
}: {
  mapId: string;
  activeRoute: MapActiveRouteView | null;
  routePrefs: RoutePrefs;
  presence: MapPresenceEntry[];
  connections: MapConnectionEdge[];
  primaryCharacterId: number | null;
  onRouteUpdated?: () => void;
}) {
  const soundPrefs = useSoundPrefs();
  const offRoutePrefs = soundPrefs.events.activeRouteOffRoute;
  const hazardPrefs = soundPrefs.events.activeRouteLinkAlert;
  const offRouteAlertEnabled = offRoutePrefs.enabled;
  const hazardAlertEnabled = hazardPrefs.enabled;
  const offRouteSoundOn = useSoundCueOn('activeRouteOffRoute');
  const hazardSoundOn = useSoundCueOn('activeRouteLinkAlert');

  const offRouteNotified = useRef(new Set<string>());
  const offRouteBaseline = useRef(false);
  const hazardNotified = useRef(new Set<string>());
  const prevConnSnapshot = useRef(new Map<string, string>());
  const hazardBaseline = useRef(false);
  const rerouteBusy = useRef(false);

  const notifyDesktop = useCallback(
    (title: string, body: string, tag: string, desktop?: boolean) => {
      if (desktop !== true) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      try {
        new Notification(title, { body, tag });
      } catch {
        return;
      }
    },
    [],
  );

  const recomputeAndSave = useCallback(async () => {
    if (!activeRoute || primaryCharacterId == null || rerouteBusy.current) return;
    rerouteBusy.current = true;
    try {
      const primaryPresence = presence.find((p) => p.characterId === primaryCharacterId);
      const sourceSystemId =
        primaryPresence?.systemId ?? activeRoute.hops[0]?.systemId ?? null;
      if (sourceSystemId == null) {
        toast.error('No start system for reroute.');
        return;
      }
      const result = await requestJson<
        { ok: true; data: RoutePlan[] } | { ok: false; error: string }
      >('POST', `/api/map/${mapId}/route-plan`, {
        sourceSystemId,
        destinationSystemIds: [activeRoute.destinationSystemId],
        prefs: routePrefs,
      });
      if (!result.ok || !result.data[0]?.reachable) {
        toast.error('Could not find a new route.');
        return;
      }
      const plan = result.data[0];
      const push = await pushKspaceWaypointsForCharacter(primaryCharacterId, plan.hops);
      if (!push.ok) {
        toast.error(push.error);
        return;
      }
      const saved = await setMapActiveRouteAction({
        mapId,
        primaryCharacterId,
        destinationSystemId: plan.destinationSystemId,
        plan,
        followerCharacterIds: activeRoute.followerCharacterIds,
      });
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      toast.success('Active route recomputed.');
      hazardNotified.current.clear();
      prevConnSnapshot.current.clear();
      onRouteUpdated?.();
    } finally {
      rerouteBusy.current = false;
    }
  }, [activeRoute, mapId, onRouteUpdated, presence, primaryCharacterId, routePrefs]);

  useEffect(() => {
    if (!offRouteAlertEnabled || !activeRoute) return;
    if (!offRouteBaseline.current) {
      const seed = followersOffRoute(
        activeRoute.hops,
        presence,
        activeRoute.followerCharacterIds,
      );
      for (const row of seed) {
        offRouteNotified.current.add(`${row.characterId}:${row.systemId}`);
      }
      offRouteBaseline.current = true;
      return;
    }
    const off = followersOffRoute(
      activeRoute.hops,
      presence,
      activeRoute.followerCharacterIds,
    );
    for (const row of off) {
      const key = `${row.characterId}:${row.systemId}`;
      if (offRouteNotified.current.has(key)) continue;
      offRouteNotified.current.add(key);
      toast.message('Off active route', {
        description: `${row.characterName} is not on the planned path.`,
      });
      if (offRouteSoundOn) getSoundEngine().play('activeRouteOffRoute');
      notifyDesktop(
        'Off active route',
        `${row.characterName} is not on the planned path.`,
        `off-route-${row.characterId}`,
        offRoutePrefs.desktopNotification,
      );
    }
    for (const fid of activeRoute.followerCharacterIds) {
      const p = presence.find((x) => x.characterId === fid);
      if (p && isOnActiveRoute(activeRoute.hops, p.systemId)) {
        for (const key of [...offRouteNotified.current]) {
          if (key.startsWith(`${fid}:`)) offRouteNotified.current.delete(key);
        }
      }
    }
  }, [
    activeRoute,
    notifyDesktop,
    offRouteAlertEnabled,
    offRoutePrefs.desktopNotification,
    offRouteSoundOn,
    presence,
  ]);

  useEffect(() => {
    if (!hazardAlertEnabled || !activeRoute) return;
    const routeConnIds = new Set(activeRouteConnectionIds(activeRoute.hops));
    const byId = routeConnectionsById(activeRoute.hops, connections);

    if (!hazardBaseline.current) {
      for (const id of routeConnIds) {
        const edge = byId.get(id);
        prevConnSnapshot.current.set(id, edge?.eolStage ?? 'deleted');
      }
      hazardBaseline.current = true;
      return;
    }

    for (const id of routeConnIds) {
      const edge = byId.get(id);
      const prevStage = prevConnSnapshot.current.get(id);
      const stage = edge?.eolStage ?? 'deleted';
      prevConnSnapshot.current.set(id, stage);
      if (edge == null) {
        const alertKey = `deleted:${id}`;
        if (hazardNotified.current.has(alertKey)) continue;
        hazardNotified.current.add(alertKey);
        toast.message('Route link removed', {
          description: 'A wormhole on your active route is gone.',
          action: {
            label: 'Recompute',
            onClick: () => void recomputeAndSave(),
          },
        });
        if (hazardSoundOn) getSoundEngine().play('activeRouteLinkAlert');
        notifyDesktop(
          'Route link removed',
          'A wormhole on your active route is gone.',
          `route-hazard-${id}`,
          hazardPrefs.desktopNotification,
        );
        continue;
      }
      if (edge.eolStage === 'critical' && prevStage !== 'critical') {
        const alertKey = `critical:${id}`;
        if (hazardNotified.current.has(alertKey)) continue;
        hazardNotified.current.add(alertKey);
        toast.message('Route link EOL critical', {
          description: 'A wormhole on your active route is in critical EOL.',
          action: {
            label: 'Recompute',
            onClick: () => void recomputeAndSave(),
          },
        });
        if (hazardSoundOn) getSoundEngine().play('activeRouteLinkAlert');
        notifyDesktop(
          'Route link EOL critical',
          'A wormhole on your active route is in critical EOL.',
          `route-hazard-critical-${id}`,
          hazardPrefs.desktopNotification,
        );
      }
    }

    for (const key of prevConnSnapshot.current.keys()) {
      if (!routeConnIds.has(key)) prevConnSnapshot.current.delete(key);
    }
  }, [
    activeRoute,
    connections,
    hazardAlertEnabled,
    hazardPrefs.desktopNotification,
    hazardSoundOn,
    notifyDesktop,
    recomputeAndSave,
  ]);

  useEffect(() => {
    if (!activeRoute) {
      offRouteNotified.current.clear();
      offRouteBaseline.current = false;
      hazardNotified.current.clear();
      prevConnSnapshot.current.clear();
      hazardBaseline.current = false;
    }
  }, [activeRoute]);

  return null;
}
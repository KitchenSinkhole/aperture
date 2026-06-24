import type { DiscordWebhookEmbed, DiscordWebhookPayload } from '@/lib/integrations/discord';
import type { MapEventPayload } from '@/lib/realtime/protocol';

/**
 * Resolved naming context the dispatcher hands to a formatter so the
 * formatter never has to touch the DB. The dispatcher joins
 * `ap_map`, `ap_character`, `ap_map_system` + `universe_system` once per event
 * before delegating here.
 */
export interface WebhookEventContext {
  mapName: string;
  /** Acting character name, or null for job-driven events (signature reap, …). */
  characterName: string | null;
  /** Primary system name when the event references one system. */
  systemName: string | null;
  /** Connection events have two endpoints — set both when known. */
  sourceSystemName: string | null;
  targetSystemName: string | null;
}

const RALLY_EMBED_COLOR = 0xe74c3c; // Discord red

/**
 * Whether a `system.updated` event represents a rally being set (not cleared).
 * Used both by the dispatcher (to decide whether to fan out to rally webhooks)
 * and by the rally formatter.
 */
export function isRallySetEvent(event: MapEventPayload): boolean {
  if (event.kind !== 'system.updated') return false;
  return typeof event.rallyAt === 'string' && event.rallyAt.length > 0;
}

/** Build the Discord payload for a `history` webhook. Returns `null` if the event has nothing to say. */
export function formatHistoryMessage(
  event: MapEventPayload,
  ctx: WebhookEventContext,
  mapName: string = ctx.mapName,
): DiscordWebhookPayload | null {
  const who = ctx.characterName ?? 'Aperture';
  const line = describeMapEvent(event, ctx);
  if (!line) return null;
  // Discord has no actor column, so the name leads the sentence here. The audit
  // console (its own actor column) renders `describeMapEvent` without this prefix.
  return { content: `**${mapName}** — ${who} ${line}.` };
}

/** Build the Discord payload for a `rally` webhook. Caller should only invoke for `isRallySetEvent`. */
export function formatRallyMessage(
  event: MapEventPayload,
  ctx: WebhookEventContext,
): DiscordWebhookPayload | null {
  if (!isRallySetEvent(event)) return null;
  // Narrowed by isRallySetEvent.
  const rallyAt = (event as Extract<MapEventPayload, { kind: 'system.updated' }>).rallyAt as string;
  const system = ctx.systemName ?? 'an unknown system';
  const setter = ctx.characterName ?? 'Aperture';

  const embed: DiscordWebhookEmbed = {
    title: `Rally point set in ${system}`,
    description: `Set by **${setter}** on **${ctx.mapName}**.`,
    color: RALLY_EMBED_COLOR,
    timestamp: rallyAt,
  };
  return { embeds: [embed] };
}

/** Friendly label for a wormhole's per-jump mass class (max ship size). */
const JUMP_MASS_LABEL: Record<string, string> = {
  s: 'small',
  m: 'medium',
  l: 'large',
  xl: 'x-large',
};

/**
 * The single human-readable, one-line description of a map event — the *action*
 * only, with no leading actor name (e.g. `"set **Jita** status to \`friendly\`"`).
 * Shared by the Discord history formatter (which prepends the acting character)
 * and the in-map audit console (`src/lib/map/audit.ts`, which has its own actor
 * column and capitalizes the first letter). Returns `null` when the event has
 * nothing worth saying — notably a position-only `system.updated` (a canvas
 * drag) or an update whose only changed fields are unrecognized — which both
 * callers drop.
 *
 * The `*.update` branches enumerate every changed field (`field → value`) rather
 * than reporting only the first, so the audit trail shows exactly what a commit
 * altered — the difference between "made a change" and "set max ship size →
 * large", which is what identifies a mis-classification.
 */
export function describeMapEvent(event: MapEventPayload, ctx: WebhookEventContext): string | null {
  switch (event.kind) {
    case 'system.added': {
      return `added **${event.name}** to the map`;
    }
    case 'system.removed': {
      const name = ctx.systemName ?? 'a system';
      return `removed **${name}** from the map`;
    }
    case 'system.updated': {
      const name = ctx.systemName ?? 'a system';
      if (isRallySetEvent(event)) {
        return `set a rally point in **${name}**`;
      }
      if (event.rallyAt === null) {
        return `cleared the rally point in **${name}**`;
      }
      if (event.status) {
        return `set **${name}** status to \`${event.status}\``;
      }
      if (event.locked === true) return `locked **${name}**`;
      if (event.locked === false) return `unlocked **${name}**`;
      if (typeof event.alias === 'string') {
        return `aliased **${name}** to \`${event.alias}\``;
      }
      if (event.alias === null) {
        return `cleared the alias on **${name}**`;
      }
      if (typeof event.tag === 'string') {
        return `tagged **${name}** \`${event.tag}\``;
      }
      if (event.tag === null) return `cleared the tag on **${name}**`;
      if ('intelNotes' in event) {
        return `updated intel on **${name}**`;
      }
      // Position-only updates are noise; skip.
      return null;
    }
    case 'connection.create': {
      const src = ctx.sourceSystemName ?? 'a system';
      const dst = ctx.targetSystemName ?? 'another system';
      return `connected **${src}** ↔ **${dst}**`;
    }
    case 'connection.update': {
      const src = ctx.sourceSystemName ?? 'a system';
      const dst = ctx.targetSystemName ?? 'another system';
      const changes = describeConnectionChanges(event);
      if (changes.length === 0) return null;
      return `updated **${src}** ↔ **${dst}** (${changes.join(', ')})`;
    }
    case 'connection.delete': {
      const src = ctx.sourceSystemName ?? 'a system';
      const dst = ctx.targetSystemName ?? 'another system';
      return `removed the connection **${src}** ↔ **${dst}**`;
    }
    case 'signature.create': {
      const name = ctx.systemName ?? 'a system';
      const details = describeSignatureCreate(event, ctx);
      const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
      return `added signature \`${event.sigId}\` in **${name}**${suffix}`;
    }
    case 'signature.update': {
      const name = ctx.systemName ?? 'a system';
      const sig = event.sigId ?? 'a signature';
      const changes = describeSignatureChanges(event, ctx);
      const suffix = changes.length > 0 ? ` (${changes.join(', ')})` : '';
      return `updated signature \`${sig}\` in **${name}**${suffix}`;
    }
    case 'signature.delete': {
      const name = ctx.systemName ?? 'a system';
      const sig = event.sigId ?? 'a signature';
      return `removed signature \`${sig}\` from **${name}**`;
    }
    case 'note.created': {
      const sev = event.severity === 'neutral' ? '' : ` (\`${event.severity}\`)`;
      return `added note **${event.title}**${sev}`;
    }
    case 'note.updated': {
      // `title` always rides as the descriptor; the changed fields ride conditionally.
      const name = event.title;
      if (event.severity !== undefined) {
        return `changed note **${name}** severity to \`${event.severity}\``;
      }
      if (event.locked === true) return `locked note **${name}**`;
      if (event.locked === false) return `unlocked note **${name}**`;
      if ('content' in event) {
        return event.content ? `updated the body of note **${name}**` : `cleared the body of note **${name}**`;
      }
      // A pure position drag carries positionX/Y only — noise, skip (mirrors systems).
      if (event.positionX !== undefined || event.positionY !== undefined) return null;
      // Nothing else changed: a title-only edit.
      return `renamed note to **${name}**`;
    }
    case 'note.deleted':
      return `removed note **${event.title}**`;
    case 'map.create':
      return `created the map \`${event.name}\``;
    case 'map.update':
      return event.name ? `renamed the map to \`${event.name}\`` : `updated map settings`;
    case 'map.delete':
      return event.deletedAt ? `soft-deleted the map (30-day grace)` : `restored the map`;
    default:
      return null;
  }
}

/** Per-field `field → value` clauses for a `connection.update` patch (only changed keys). */
function describeConnectionChanges(
  event: Extract<MapEventPayload, { kind: 'connection.update' }>,
): string[] {
  const changes: string[] = [];
  if (event.scope) changes.push(`scope → \`${event.scope}\``);
  if (event.massStatus) changes.push(`mass → \`${event.massStatus}\``);
  if ('jumpMassClass' in event) {
    changes.push(
      event.jumpMassClass
        ? `max ship size → ${JUMP_MASS_LABEL[event.jumpMassClass] ?? event.jumpMassClass}`
        : 'max ship size cleared',
    );
  }
  if (event.eolStage === 'eol') changes.push('EOL → ~4h');
  else if (event.eolStage === 'critical') changes.push('EOL → critical (~1h)');
  else if (event.eolStage === 'none') changes.push('EOL cleared');
  if (event.isRolling === true) changes.push('rolling started');
  else if (event.isRolling === false) changes.push('rolling stopped');
  if (event.preserveMass === true) changes.push('mass preservation on');
  else if (event.preserveMass === false) changes.push('mass preservation off');
  if (event.isStatic === true) changes.push('flagged as static');
  else if (event.isStatic === false) changes.push('unflagged as static');
  return changes;
}

/** Group/type + leads-to summary for a freshly-created signature. */
function describeSignatureCreate(
  event: Extract<MapEventPayload, { kind: 'signature.create' }>,
  ctx: WebhookEventContext,
): string[] {
  const details: string[] = [];
  const classification = signatureClassification(event.groupKey, event.wormholeCode);
  if (classification) details.push(classification);
  if (event.leadsToMapSystemId && ctx.targetSystemName) {
    details.push(`leads to **${ctx.targetSystemName}**`);
  }
  return details;
}

/**
 * Per-field `field → value` clauses for a `signature.update` patch (only changed
 * keys). Suppresses the housekeeping field-resets the client folds into a primary
 * change — picking a wormhole type clears `name` (the code-mirror), and changing
 * the group clears both `typeId` and `name` — so the trail reports the intended
 * edit ("type → `C008`") without the noise ("name cleared").
 */
function describeSignatureChanges(
  event: Extract<MapEventPayload, { kind: 'signature.update' }>,
  ctx: WebhookEventContext,
): string[] {
  const changes: string[] = [];
  const groupChanged = 'groupKey' in event;
  const typeChanged = 'typeId' in event || 'wormholeCode' in event;

  if (groupChanged) {
    changes.push(event.groupKey ? `group → \`${event.groupKey}\`` : 'group cleared');
  }
  // typeId + wormholeCode ride together; a group change already resets the type.
  if (typeChanged && !groupChanged) {
    if (event.wormholeCode) changes.push(`type → \`${event.wormholeCode}\``);
    else if (event.typeId == null) changes.push('type cleared');
    else changes.push('type changed');
  }
  // A real name edit only — not the null the client sends alongside a group/type pick.
  if ('name' in event && !groupChanged && !typeChanged) {
    changes.push(event.name ? `name → "${event.name}"` : 'name cleared');
  }
  if ('mapConnectionId' in event) {
    const dest = ctx.targetSystemName;
    if (event.mapConnectionId) {
      changes.push(dest ? `leads to **${dest}**` : 'linked to a connection');
    } else {
      changes.push(dest ? `unlinked from **${dest}**` : 'unlinked from its connection');
    }
  }
  if ('description' in event) {
    changes.push(event.description ? 'notes updated' : 'notes cleared');
  }
  if ('expiresAt' in event) changes.push('lifetime updated');
  return changes;
}

/** A signature's class label, e.g. `wormhole \`C008\`` or `relic site`; null when unknown. */
function signatureClassification(
  groupKey: string | null | undefined,
  wormholeCode: string | null | undefined,
): string | null {
  if (groupKey === 'wormhole') {
    return wormholeCode ? `wormhole \`${wormholeCode}\`` : 'wormhole';
  }
  if (wormholeCode) return `wormhole \`${wormholeCode}\``;
  if (groupKey) return `${groupKey} site`;
  return null;
}

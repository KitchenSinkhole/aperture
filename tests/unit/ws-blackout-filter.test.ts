// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  filterSessionMessage,
  publicActionFor,
  publicNudgeOnBlackoutFlip,
} from '@/lib/realtime/wsServer';
import type { CharacterUpdateLoad, ServerToClientMessage } from '@/lib/realtime/protocol';
import type { BlackoutViewer, SharePresenceMode, ShareRedactionProfile } from '@/types';

const MAP = 41;
const VIEWER_USER = 7;
const OTHER_USER = 8;
const OWN_CHAR = 90001;
const OWN_ALT = 90002;
const OTHER_CHAR = 90003;
const OWN_CHARS: ReadonlySet<number> = new Set([OWN_CHAR, OWN_ALT]);

function viewer(active: boolean, cleared: boolean): BlackoutViewer {
  return { active, cleared, userId: VIEWER_USER };
}

function characterUpdate(userId: number, characterId: number): ServerToClientMessage {
  const load: CharacterUpdateLoad = {
    characterId,
    characterName: `Pilot ${characterId}`,
    userId,
    mainCharacterId: null,
    mainCharacterName: null,
    online: true,
    systemId: 31000001,
    systemName: 'J100001',
    systemSecurity: 'C1',
    systemTrueSec: -1,
    shipTypeId: 670,
    shipTypeName: 'Capsule',
    shipClass: null,
    shipName: null,
    locationAt: '2026-10-17T12:00:00.000Z',
  };
  return { task: 'characterUpdate', load, mapId: MAP };
}

function characterLogout(characterIds: number[]): ServerToClientMessage {
  return { task: 'characterLogout', load: { characterIds }, mapId: MAP };
}

function massLog(characterId: number): ServerToClientMessage {
  return {
    task: 'connectionMassLog',
    load: {
      mapId: MAP,
      connectionId: '11',
      logId: '12',
      characterId,
      shipTypeId: 670,
      mass: 32_000,
      cumulativeMass: 32_000,
      jumpedAt: '2026-10-17T12:00:00.000Z',
    },
    mapId: MAP,
  };
}

const mapUpdate: ServerToClientMessage = {
  task: 'mapUpdate',
  load: { mapId: MAP, kind: 'system.updated', data: undefined },
  mapId: MAP,
};

const systemNotification: ServerToClientMessage = {
  task: 'systemNotification',
  load: { mapId: MAP, systemId: 31000001, kind: 'ping' },
  mapId: MAP,
};

/** Every (on, cleared) combination that does not restrict the viewer. */
const UNRESTRICTED: Array<[string, BlackoutViewer]> = [
  ['off, not cleared', viewer(false, false)],
  ['off, cleared', viewer(false, true)],
  ['on, cleared', viewer(true, true)],
];

const ALL_MESSAGES: Array<[string, ServerToClientMessage]> = [
  ['own characterUpdate', characterUpdate(VIEWER_USER, OWN_CHAR)],
  ['other characterUpdate', characterUpdate(OTHER_USER, OTHER_CHAR)],
  ['own characterLogout', characterLogout([OWN_CHAR])],
  ['other characterLogout', characterLogout([OTHER_CHAR])],
  ['mixed characterLogout', characterLogout([OWN_CHAR, OTHER_CHAR])],
  ['own connectionMassLog', massLog(OWN_CHAR)],
  ['other connectionMassLog', massLog(OTHER_CHAR)],
  ['mapUpdate', mapUpdate],
  ['systemNotification', systemNotification],
];

describe('filterSessionMessage', () => {
  describe.each(UNRESTRICTED)('%s', (_label, v) => {
    it.each(ALL_MESSAGES)('passes %s unchanged', (_name, message) => {
      expect(filterSessionMessage(message, v, OWN_CHARS)).toBe(message);
    });
  });

  describe('on, not cleared', () => {
    const v = viewer(true, false);

    it("passes the viewer's own account's characterUpdate", () => {
      const message = characterUpdate(VIEWER_USER, OWN_ALT);
      expect(filterSessionMessage(message, v, OWN_CHARS)).toBe(message);
    });

    it("drops another account's characterUpdate", () => {
      expect(filterSessionMessage(characterUpdate(OTHER_USER, OTHER_CHAR), v, OWN_CHARS)).toBeNull();
    });

    it("passes a characterLogout naming only the viewer's own characters", () => {
      const message = characterLogout([OWN_CHAR, OWN_ALT]);
      expect(filterSessionMessage(message, v, OWN_CHARS)).toBe(message);
    });

    it("drops a characterLogout naming only another account's characters", () => {
      expect(filterSessionMessage(characterLogout([OTHER_CHAR]), v, OWN_CHARS)).toBeNull();
    });

    it("narrows a mixed characterLogout to the viewer's own characters", () => {
      expect(filterSessionMessage(characterLogout([OTHER_CHAR, OWN_CHAR]), v, OWN_CHARS)).toEqual(
        characterLogout([OWN_CHAR]),
      );
    });

    it('drops a characterLogout while the own-character set is not yet known', () => {
      expect(filterSessionMessage(characterLogout([OWN_CHAR]), v, new Set())).toBeNull();
    });

    it.each([
      ['own', massLog(OWN_CHAR)],
      ['other', massLog(OTHER_CHAR)],
    ])('drops a connectionMassLog for the %s account', (_who, message) => {
      expect(filterSessionMessage(message, v, OWN_CHARS)).toBeNull();
    });

    it.each([
      ['mapUpdate', mapUpdate],
      ['systemNotification', systemNotification],
    ])('passes %s unchanged', (_name, message) => {
      expect(filterSessionMessage(message, v, OWN_CHARS)).toBe(message);
    });
  });
});

function profile(presenceMode: SharePresenceMode): ShareRedactionProfile {
  return { presenceMode, showSignatures: false, showConnectionSigIds: false, showBubbles: false };
}

describe('publicActionFor', () => {
  const presence: Array<[string, ServerToClientMessage]> = [
    ['characterUpdate', characterUpdate(OTHER_USER, OTHER_CHAR)],
    ['characterLogout', characterLogout([OTHER_CHAR])],
  ];

  it.each([true, false])('nudges on mapUpdate (Blackout on: %s)', (on) => {
    expect(publicActionFor(mapUpdate, profile('full'), on)).toBe('nudge');
  });

  it.each(presence)('nudges on %s for a presence-publishing share while off', (_name, message) => {
    expect(publicActionFor(message, profile('full'), false)).toBe('nudge');
    expect(publicActionFor(message, profile('anonymous'), false)).toBe('nudge');
  });

  it.each(presence)('does not nudge on %s while Blackout is on', (_name, message) => {
    expect(publicActionFor(message, profile('full'), true)).toBeNull();
    expect(publicActionFor(message, profile('anonymous'), true)).toBeNull();
  });

  it.each(presence)('never nudges on %s for a presence-none share', (_name, message) => {
    expect(publicActionFor(message, profile('none'), false)).toBeNull();
  });

  it('closes on mapDeleted', () => {
    const message: ServerToClientMessage = { task: 'mapDeleted', load: { mapId: MAP }, mapId: MAP };
    expect(publicActionFor(message, profile('full'), true)).toBe('close');
  });

  it.each([
    ['connectionMassLog', massLog(OTHER_CHAR)],
    ['systemNotification', systemNotification],
    ['healthCheck', { task: 'healthCheck', load: { ts: 1 } } satisfies ServerToClientMessage],
  ])('drops %s', (_name, message) => {
    expect(publicActionFor(message, profile('full'), false)).toBeNull();
  });
});

describe('publicNudgeOnBlackoutFlip', () => {
  it.each([
    ['on', false, true],
    ['off', true, false],
  ])('nudges a presence-publishing share when Blackout turns %s', (_label, was, is) => {
    expect(publicNudgeOnBlackoutFlip(profile('full'), was, is)).toBe(true);
    expect(publicNudgeOnBlackoutFlip(profile('anonymous'), was, is)).toBe(true);
  });

  it.each([true, false])('does not nudge when the switch reads unchanged (on: %s)', (on) => {
    expect(publicNudgeOnBlackoutFlip(profile('full'), on, on)).toBe(false);
  });

  it.each([
    [false, true],
    [true, false],
  ])('never nudges a presence-none share (%s to %s)', (was, is) => {
    expect(publicNudgeOnBlackoutFlip(profile('none'), was, is)).toBe(false);
  });
});

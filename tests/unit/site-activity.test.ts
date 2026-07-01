import { describe, expect, it } from 'vitest';
import { siteActivity, effectiveSignatureActivity } from '@/lib/map/siteActivity';

describe('siteActivity', () => {
  it('classifies Sleeper-native relic/data sites as combat', () => {
    expect(siteActivity('Forgotten Perimeter Habitation Coils', 'relic')).toBe('combat');
    expect(siteActivity('Unsecured Perimeter Comms Relay', 'data')).toBe('combat');
    expect(siteActivity('Abandoned Research Complex DC007', 'data')).toBe('combat');
  });

  it('classifies null-sec bleed-in relic/data sites as exploration', () => {
    expect(siteActivity('Ruined Guristas Temple Site', 'relic')).toBe('exploration');
    expect(siteActivity('Central Serpentis Survey Site', 'data')).toBe('exploration');
  });

  it('marks every gas reservoir as combat', () => {
    expect(siteActivity('Barren Perimeter Reservoir', 'gas')).toBe('combat');
    expect(siteActivity('Instrumental Core Reservoir', 'gas')).toBe('combat');
    expect(siteActivity('Ordinary Perimeter Reservoir', 'gas')).toBe('combat');
  });

  it('marks ghost sites as combat', () => {
    expect(siteActivity('Superior Serpentis Covert Research Facility', 'ghost')).toBe('combat');
  });

  it('marks combat anomalies as combat without needing a name', () => {
    expect(siteActivity('Core Garrison', 'combat')).toBe('combat');
    expect(siteActivity(null, 'combat')).toBe('combat');
  });

  it('marks ore deposits as exploration (no rats)', () => {
    expect(siteActivity('Ordinary Perimeter Deposit', 'ore')).toBe('exploration');
    expect(siteActivity('Shattered Debris Field', 'ore')).toBe('exploration');
  });

  it('returns null for wormhole sigs', () => {
    expect(siteActivity('B274', 'wormhole')).toBeNull();
  });

  it('returns null for unidentified relic/data sites (no name yet)', () => {
    expect(siteActivity(null, 'relic')).toBeNull();
    expect(siteActivity('', 'data')).toBeNull();
    expect(siteActivity('Some Unrecognised Site', 'relic')).toBeNull();
  });

  it('returns null when the group is unknown', () => {
    expect(siteActivity('Anything', null)).toBeNull();
  });

  it('resolves the Reservoir-vs-Deposit prefix collision by group', () => {
    // Same "Ordinary Perimeter" prefix, opposite activities, disambiguated by group.
    expect(siteActivity('Ordinary Perimeter Reservoir', 'gas')).toBe('combat');
    expect(siteActivity('Ordinary Perimeter Deposit', 'ore')).toBe('exploration');
  });
});

describe('effectiveSignatureActivity', () => {
  it('falls back to the derived value when no override is set', () => {
    expect(
      effectiveSignatureActivity({ name: 'Core Garrison', groupKey: 'combat' }),
    ).toBe('combat');
    expect(
      effectiveSignatureActivity({
        name: 'Barren Perimeter Reservoir',
        groupKey: 'gas',
        activityOverride: null,
      }),
    ).toBe('combat');
  });

  it('lets an override win over the derived value', () => {
    // A gas site cleared of rats, re-marked as exploration.
    expect(
      effectiveSignatureActivity({
        name: 'Barren Perimeter Reservoir',
        groupKey: 'gas',
        activityOverride: 'exploration',
      }),
    ).toBe('exploration');
  });

  it('lets an override supply an activity where the derived value is null', () => {
    expect(
      effectiveSignatureActivity({
        name: null,
        groupKey: 'relic',
        activityOverride: 'combat',
      }),
    ).toBe('combat');
  });

  it('never classifies a wormhole, even with an override set', () => {
    expect(
      effectiveSignatureActivity({
        name: 'B274',
        groupKey: 'wormhole',
        activityOverride: 'combat',
      }),
    ).toBeNull();
  });
});

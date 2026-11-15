// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ReadSequence } from '@/lib/realtime/readSequence';

function unsettledSequence(): ReadSequence {
  const seq = new ReadSequence();
  seq.invalidate();
  return seq;
}

describe('ReadSequence', () => {
  it('starts settled, and an initial invalidate holds until the first success', () => {
    expect(new ReadSequence().settled).toBe(true);
    const seq = unsettledSequence();
    expect(seq.settled).toBe(false);
    expect(seq.succeed(seq.begin())).toBe(true);
    expect(seq.settled).toBe(true);
  });

  it('applies an older success when the newer read fails', () => {
    const seq = unsettledSequence();
    const older = seq.begin();
    const newer = seq.begin();
    seq.fail(newer);
    expect(seq.succeed(older)).toBe(true);
  });

  it('discards an older success that finishes after a newer one', () => {
    const seq = unsettledSequence();
    const older = seq.begin();
    const newer = seq.begin();
    expect(seq.succeed(newer)).toBe(true);
    expect(seq.succeed(older)).toBe(false);
    expect(seq.settled).toBe(true);
  });

  it('stays unsettled when the read after an invalidate fails, until a later read succeeds', () => {
    const seq = unsettledSequence();
    seq.succeed(seq.begin());
    seq.invalidate();
    const afterNotify = seq.begin();
    seq.fail(afterNotify);
    expect(seq.settled).toBe(false);
    expect(seq.succeed(seq.begin())).toBe(true);
    expect(seq.settled).toBe(true);
  });

  it('is not settled by a read already in flight when invalidated', () => {
    const seq = unsettledSequence();
    seq.succeed(seq.begin());
    const inFlight = seq.begin();
    seq.invalidate();
    expect(seq.succeed(inFlight)).toBe(true);
    expect(seq.settled).toBe(false);
    seq.succeed(seq.begin());
    expect(seq.settled).toBe(true);
  });

  it('requires a read begun after the last of overlapping invalidates', () => {
    const seq = unsettledSequence();
    seq.succeed(seq.begin());
    seq.invalidate();
    const first = seq.begin();
    seq.invalidate();
    const second = seq.begin();
    seq.succeed(first);
    expect(seq.settled).toBe(false);
    seq.succeed(second);
    expect(seq.settled).toBe(true);
  });

  it('unsettles on a failed read, until a later read succeeds', () => {
    const seq = unsettledSequence();
    seq.succeed(seq.begin());
    seq.fail(seq.begin());
    expect(seq.settled).toBe(false);
    seq.succeed(seq.begin());
    expect(seq.settled).toBe(true);
  });

  it('stays settled when a failure is older than an applied success', () => {
    const seq = unsettledSequence();
    const older = seq.begin();
    const newer = seq.begin();
    seq.succeed(newer);
    seq.fail(older);
    expect(seq.settled).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { buildCronItems, jobModules, jobQueueFor } from '@/lib/jobs/registry';
import { SDE_QUEUE } from '@/lib/jobs/queues';

/**
 * The three static-data tasks must be mutually exclusive: two ingests that
 * resolved different builds run deletion sync with different keep sets, and
 * the older one's deletes the newer build's rows. graphile-worker gives that
 * for free through a shared named queue, but only if every path that creates
 * a job sets it — the cron items here, and `jobQueueFor` on the `/setup`
 * enqueue path.
 */
const SDE_TASKS = ['sde-ingest', 'sde-refresh', 'csv-ingest'] as const;

describe('SDE task serialization', () => {
  it('registers all three static-data tasks on one shared queue', () => {
    for (const name of SDE_TASKS) {
      const registered = jobModules().find((m) => m.name === name);
      expect(registered, `${name} is not registered`).toBeDefined();
      expect(registered!.queue, `${name} is not on the SDE queue`).toBe(SDE_QUEUE);
    }
  });

  it('resolves the queue by task name for on-demand enqueues', () => {
    for (const name of SDE_TASKS) {
      expect(jobQueueFor(name)).toBe(SDE_QUEUE);
    }
  });

  it('leaves tasks with no declared queue unqueued', () => {
    expect(jobQueueFor('signature-reap')).toBeNull();
    expect(jobQueueFor('no-such-task')).toBeNull();
  });

  it('carries the queue onto the sde-refresh cron item', () => {
    const item = buildCronItems().find((c) => c.task === 'sde-refresh');
    expect(item?.options?.queueName).toBe(SDE_QUEUE);
  });

  it('leaves unqueued cron items without a queue name', () => {
    const item = buildCronItems().find((c) => c.task === 'signature-reap');
    expect(item).toBeDefined();
    expect(item?.options?.queueName).toBeUndefined();
  });
});

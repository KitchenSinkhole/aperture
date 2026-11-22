// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postDiscordWebhook } from '@/lib/integrations/discord';

describe('postDiscordWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never lets the message text ping anyone', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await postDiscordWebhook('https://discord.example/api/webhooks/1/x', {
      content: 'X created API token **@everyone** <@&123> @here',
    });

    expect(result).toEqual({ ok: true, status: 204 });
    const init = fetchMock.mock.calls[0]![1];
    expect(JSON.parse(init.body as string)).toEqual({
      content: 'X created API token **@everyone** <@&123> @here',
      allowed_mentions: { parse: [] },
    });
  });
});

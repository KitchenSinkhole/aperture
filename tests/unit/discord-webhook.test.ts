// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDiscordWebhookUrl, postDiscordWebhook } from '@/lib/integrations/discord';

describe('postDiscordWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never lets the message text ping anyone', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await postDiscordWebhook('https://discord.com/api/webhooks/1/x', {
      content: 'X created API token **@everyone** <@&123> @here',
    });

    expect(result).toEqual({ ok: true, status: 204 });
    const init = fetchMock.mock.calls[0]![1];
    expect(JSON.parse(init.body as string)).toEqual({
      content: 'X created API token **@everyone** <@&123> @here',
      allowed_mentions: { parse: [] },
    });
  });

  it('refuses to follow a redirect', async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(null, { status: 307, headers: { location: 'http://127.0.0.1:9100/' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await postDiscordWebhook('https://discord.com/api/webhooks/1/x', {
      content: 'hi',
    });

    expect(fetchMock.mock.calls[0]![1].redirect).toBe('manual');
    expect(result).toMatchObject({ ok: false, status: 307, retriable: false });
  });
});

describe('isDiscordWebhookUrl', () => {
  it.each([
    'https://discord.com/api/webhooks/123/abc',
    'https://discordapp.com/api/webhooks/123/abc',
    'https://canary.discord.com/api/webhooks/123/abc',
    'https://ptb.discord.com/api/webhooks/123/abc',
    'https://DISCORD.com/api/webhooks/123/abc?thread_id=9',
  ])('accepts %s', (url) => {
    expect(isDiscordWebhookUrl(url)).toBe(true);
  });

  it.each([
    'http://discord.com/api/webhooks/123/abc',
    'https://discord.com:8443/api/webhooks/123/abc',
    'https://discord.com./api/webhooks/123/abc',
    'https://evil.discord.com.example/api/webhooks/123/abc',
    'https://discord.com.evil.example/api/webhooks/123/abc',
    'https://user:pw@discord.com/api/webhooks/123/abc',
    'https://discord.com/api/v10/users/@me',
    'https://hooks.slack.com/services/T/B/X',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:3000/api/metrics',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isDiscordWebhookUrl(url)).toBe(false);
  });
});

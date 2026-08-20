import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Privacy & Cookies · Aperture' };

const cookieRows = [
  {
    name: 'authjs.session-token',
    purpose: 'Keeps you signed in after EVE SSO login.',
    lifetime: '30 days',
  },
  {
    name: 'authjs.csrf-token',
    purpose: 'Protects the sign-in flow against cross-site request forgery.',
    lifetime: 'Browser session',
  },
  {
    name: 'authjs.callback-url',
    purpose: 'Returns you to the page you started sign-in from.',
    lifetime: 'Browser session',
  },
  {
    name: 'ap_link',
    purpose: 'Attaches an additional EVE character to your existing account during an "Add character" sign-in.',
    lifetime: '5 minutes',
  },
  {
    name: 'ap_setup',
    purpose: 'Unlocks the operator setup console after a password check. Only set for instance operators.',
    lifetime: '4 hours',
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Privacy &amp; cookies</h1>
        <p className="text-muted-foreground">
          Aperture is collaborative wormhole-mapping software for EVE Online. Each Aperture
          deployment is run independently; the operator of this instance is responsible for the
          data it holds.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">Cookies</h2>
        <p className="text-muted-foreground">
          Aperture sets only first-party cookies that are strictly necessary to sign you in and
          keep your session secure. There are no advertising, analytics, or third-party cookies,
          which is why this site shows no consent banner. In production the cookie names may
          carry a <code>__Secure-</code> or <code>__Host-</code> prefix.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Cookie</th>
                <th className="py-2 pr-4 font-medium">Purpose</th>
                <th className="py-2 font-medium">Lifetime</th>
              </tr>
            </thead>
            <tbody>
              {cookieRows.map((row) => (
                <tr key={row.name} className="border-b align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <code>{row.name}</code>
                  </td>
                  <td className="py-2 pr-4">{row.purpose}</td>
                  <td className="py-2 whitespace-nowrap">{row.lifetime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">Browser storage</h2>
        <p className="text-muted-foreground">
          Interface preferences you set (map layout, sidebar state, dropdown modes, dismissed
          notices, and similar) are kept in your browser&apos;s local storage. They never leave
          your device and are not linked to your account. Clearing your browser&apos;s site data
          removes them.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">Account data</h2>
        <p className="text-muted-foreground">
          When you sign in through EVE SSO, this instance stores your EVE character identity
          (character, corporation, and alliance IDs and names), encrypted ESI tokens for the
          scopes you granted, your in-game location while location tracking is active, and a
          history of the mapping actions you take. This data is used solely to provide the
          mapping service to you and your group.
        </p>
        <p className="text-muted-foreground">
          To exercise your rights of access, correction, or erasure, contact the operator of
          this instance. Removing a character deletes it and its tokens; mapping history it
          produced is retained but detached from the character.
        </p>
      </section>

      <footer className="text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Back to sign-in
        </Link>
      </footer>
    </main>
  );
}

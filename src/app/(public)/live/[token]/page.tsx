import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicSnapshot } from '@/lib/map/publicSnapshot';
import { NODE_HEIGHT, NODE_WIDTH } from '@/lib/map/placement';
import { systemSecurityColor } from '@/components/map/styling';

/**
 * The spectator view: a read-only render of a shared map for a viewer with no
 * session. Everything on the page comes from `getPublicSnapshot`, the single
 * code path that emits public map data.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIEWPORT_PADDING = 80;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const data = await getPublicSnapshot(token);
  return {
    title: data ? `${data.map.name} | Aperture` : 'Aperture',
    // A share link is unguessable and revocable; indexing it would outlive both.
    robots: { index: false, follow: false },
  };
}

export default async function PublicMapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getPublicSnapshot(token);
  if (!data) notFound();

  const presenceBySystem = new Map<number, number>();
  if (data.presence.mode === 'anonymous') {
    for (const s of data.presence.systems) presenceBySystem.set(s.systemId, s.count);
  } else if (data.presence.mode === 'full') {
    for (const p of data.presence.pilots) {
      presenceBySystem.set(p.systemId, (presenceBySystem.get(p.systemId) ?? 0) + 1);
    }
  }

  const centres = new Map(
    data.systems.map((s) => [
      s.id,
      { x: s.positionX + NODE_WIDTH / 2, y: s.positionY + NODE_HEIGHT / 2 },
    ]),
  );

  const minX = Math.min(...data.systems.map((s) => s.positionX));
  const minY = Math.min(...data.systems.map((s) => s.positionY));
  const maxX = Math.max(...data.systems.map((s) => s.positionX + NODE_WIDTH));
  const maxY = Math.max(...data.systems.map((s) => s.positionY + NODE_HEIGHT));

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border px-6 py-4">
        <h1 className="font-heading text-xl font-semibold tracking-tight">{data.map.name}</h1>
        <span className="text-sm text-muted-foreground">{data.map.shareLabel}</span>
        <span className="ml-auto text-xs uppercase tracking-widest text-muted-foreground">
          Read-only public view
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {data.systems.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nothing is mapped here yet.
          </p>
        ) : (
          <svg
            role="img"
            aria-label={`${data.map.name} chain, ${data.systems.length} systems`}
            className="h-full w-full"
            viewBox={[
              minX - VIEWPORT_PADDING,
              minY - VIEWPORT_PADDING,
              maxX - minX + VIEWPORT_PADDING * 2,
              maxY - minY + VIEWPORT_PADDING * 2,
            ].join(' ')}
          >
            {data.connections.map((c) => {
              const from = centres.get(c.source);
              const to = centres.get(c.target);
              if (!from || !to) return null;
              return (
                <line
                  key={c.id}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="#64748b"
                  strokeWidth={2}
                />
              );
            })}
            {data.systems.map((s) => {
              const accent = systemSecurityColor(s.security, s.trueSec);
              const pilots = presenceBySystem.get(s.systemId) ?? 0;
              return (
                <g key={s.id}>
                  <rect
                    x={s.positionX}
                    y={s.positionY}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    fill="#0b1220"
                    stroke={accent}
                    strokeWidth={1.5}
                  />
                  <text
                    x={s.positionX + 10}
                    y={s.positionY + 20}
                    fill="#e2e8f0"
                    fontSize={13}
                    fontWeight={600}
                  >
                    {s.name}
                  </text>
                  <text x={s.positionX + 10} y={s.positionY + 35} fill={accent} fontSize={10}>
                    {[s.tag, s.security].filter(Boolean).join(' · ')}
                  </text>
                  {pilots > 0 && (
                    <>
                      <circle
                        cx={s.positionX + NODE_WIDTH - 12}
                        cy={s.positionY + 12}
                        r={9}
                        fill="#1d4ed8"
                      />
                      <text
                        x={s.positionX + NODE_WIDTH - 12}
                        y={s.positionY + 16}
                        fill="#eff6ff"
                        fontSize={10}
                        fontWeight={600}
                        textAnchor="middle"
                      >
                        {pilots}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </>
  );
}

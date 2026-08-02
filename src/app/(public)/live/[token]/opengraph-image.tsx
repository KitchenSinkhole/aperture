import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { systemClassColor } from '@/components/map/styling';
import { getPublicSnapshot } from '@/lib/map/publicSnapshot';
import { NODE_HEIGHT, NODE_WIDTH } from '@/lib/map/placement';
import type { PublicMapViewData } from '@/types';

/**
 * The unfurl card a share link renders in chat and on forums: the actual chain,
 * drawn as a constellation of security-coloured systems. Reads the same cached
 * snapshot the page does, so a card costs no extra query.
 */

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A live wormhole chain shared from Aperture';

const FIELD = '#121212';
const RAIL = '#1f1f1f';
const LINE = '#2e2e2e';
const TEXT = '#e0e0e0';
const DIM = '#8f8f8f';
const LIVE = '#22c55e';

/**
 * The box the chain is scaled into: the card's right-hand two fifths, kept
 * near-square because an authored chain is roughly as tall as it is wide, and a
 * wide letterbox would shrink it to fit the height and strand it in dead space.
 * Sitting beside the identity column rather than under it also means text and
 * chain cannot overlap however tall the header runs.
 */
const CHAIN_BOX = { x: 608, y: 60, width: 528, height: 450 };
/** Identity column: wordmark, map name, counts, tagline. */
const PANEL_WIDTH = 496;
const SYSTEM_DOT = 16;

export default async function OpenGraphImage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [data, font] = await Promise.all([
    getPublicSnapshot(token),
    readFile(join(process.cwd(), 'public', 'fonts', 'GeistMono-SemiBold.ttf')),
  ]);

  const fonts = [{ name: 'Geist Mono', data: font, style: 'normal' as const, weight: 600 as const }];

  return new ImageResponse(data ? <ChainCard data={data} /> : <FallbackCard />, { ...size, fonts });
}

function ChainCard({ data }: { data: PublicMapViewData }) {
  const placed = layout(data);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: FIELD,
        fontFamily: 'Geist Mono',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: PANEL_WIDTH,
          padding: '56px 0 40px 64px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{ display: 'flex', width: 12, height: 12, borderRadius: 6, background: LIVE }}
            />
            <div style={{ display: 'flex', fontSize: 22, letterSpacing: 6, color: TEXT }}>
              APERTURE
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 58, color: TEXT, marginTop: 20 }}>
            {data.map.name}
          </div>
          {/* Stacked rather than one delimited line: the column is too narrow to
              hold all three at a size that survives a chat client's downscale. */}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 20 }}>
            {[
              `${data.systems.length} ${data.systems.length === 1 ? 'system' : 'systems'}`,
              `${data.connections.length} ${data.connections.length === 1 ? 'connection' : 'connections'}`,
              `${data.entrances.length} ${data.entrances.length === 1 ? 'way in' : 'ways in'}`,
            ].map((line) => (
              <div key={line} style={{ display: 'flex', fontSize: 26, color: DIM, marginTop: 6 }}>
                {line}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 22, color: DIM }}>
          Collaborative wormhole mapping for EVE Online
        </div>
      </div>

      {placed.edges.map((e) => (
        <div
          key={e.id}
          style={{
            display: 'flex',
            position: 'absolute',
            left: e.midX - e.length / 2,
            top: e.midY - 1,
            width: e.length,
            height: 2,
            background: LINE,
            transform: `rotate(${e.angle}deg)`,
          }}
        />
      ))}
      {placed.systems.map((s) => (
        <div
          key={s.id}
          style={{
            display: 'flex',
            position: 'absolute',
            left: s.x - SYSTEM_DOT / 2,
            top: s.y - SYSTEM_DOT / 2,
            width: SYSTEM_DOT,
            height: SYSTEM_DOT,
            borderRadius: 4,
            background: s.color,
          }}
        />
      ))}

    </div>
  );
}

function FallbackCard() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: '0 80px',
        background: FIELD,
        fontFamily: 'Geist Mono',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 6, background: RAIL }} />
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 6, color: TEXT }}>APERTURE</div>
      </div>
      <div style={{ display: 'flex', fontSize: 60, color: TEXT, marginTop: 24 }}>
        Collaborative wormhole mapping
      </div>
      <div style={{ display: 'flex', fontSize: 28, color: DIM, marginTop: 16 }}>
        Chart short-lived chains with your corp, live.
      </div>
    </div>
  );
}

type PlacedSystem = { id: string; x: number; y: number; color: string };
type PlacedEdge = { id: string; midX: number; midY: number; length: number; angle: number };

/**
 * Scales the map's authored positions into the card's chain box, preserving
 * aspect ratio and never enlarging past 1:1 so a two-system chain doesn't blow
 * up to fill the frame.
 */
function layout(data: PublicMapViewData): { systems: PlacedSystem[]; edges: PlacedEdge[] } {
  if (data.systems.length === 0) return { systems: [], edges: [] };

  const centres = data.systems.map((s) => ({
    id: s.id,
    x: s.positionX + NODE_WIDTH / 2,
    y: s.positionY + NODE_HEIGHT / 2,
    // The class palette the canvas tiles use, so the card is the same map.
    color: systemClassColor(s.security),
  }));

  const minX = Math.min(...centres.map((c) => c.x));
  const maxX = Math.max(...centres.map((c) => c.x));
  const minY = Math.min(...centres.map((c) => c.y));
  const maxY = Math.max(...centres.map((c) => c.y));
  const scale = Math.min(
    CHAIN_BOX.width / Math.max(maxX - minX, 1),
    CHAIN_BOX.height / Math.max(maxY - minY, 1),
    1,
  );
  // Centre whatever the scale leaves over.
  const offsetX = CHAIN_BOX.x + (CHAIN_BOX.width - (maxX - minX) * scale) / 2;
  const offsetY = CHAIN_BOX.y + (CHAIN_BOX.height - (maxY - minY) * scale) / 2;

  const systems = centres.map((c) => ({
    id: c.id,
    x: offsetX + (c.x - minX) * scale,
    y: offsetY + (c.y - minY) * scale,
    color: c.color,
  }));
  const byId = new Map(systems.map((s) => [s.id, s]));

  const edges: PlacedEdge[] = [];
  for (const c of data.connections) {
    const from = byId.get(c.source);
    const to = byId.get(c.target);
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    edges.push({
      id: c.id,
      midX: (from.x + to.x) / 2,
      midY: (from.y + to.y) / 2,
      length: Math.hypot(dx, dy),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }

  return { systems, edges };
}

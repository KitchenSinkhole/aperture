import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for per-map rights enforcement.
 *
 * Every route file under `src/app/api/map/**` must enforce per-map rights:
 *   - mutation handlers (POST/PATCH/DELETE) call `requireMapMutate(...)`.
 *   - read handlers (GET) call `requireMapView(...)` or `requireMapMutate(...)`.
 *   - a per-map feature endpoint may instead call `requireMapCapability(...)`,
 *     which layers a delegated-capability check on top of the same view/404
 *     guard.
 *   - no route file may contain the historical `INTERIM ACCESS` comment marker
 *     without a wrapping helper — the test fails loud if anyone reintroduces a
 *     bypass.
 *
 * The test is a pure file-scan so it runs without a DB and catches drift the
 * moment a new route lands.
 */

const ROUTES_ROOT = resolve(process.cwd(), 'src/app/api/map');

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...listRouteFiles(path));
    } else if (entry === 'route.ts') {
      out.push(path);
    }
  }
  return out;
}

const routeFiles = listRouteFiles(ROUTES_ROOT);

describe('Stage 15 — every map route enforces rights', () => {
  it('discovers at least one route file', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles)('%s calls requireMapMutate or requireMapView', (file) => {
    const src = readFileSync(file, 'utf8');
    const hasMutate = /requireMapMutate\s*\(/.test(src);
    const hasView = /requireMapView\s*\(/.test(src);
    const hasCapability = /requireMapCapability\s*\(/.test(src);
    expect(
      hasMutate || hasView || hasCapability,
      `Route ${file} must call requireMapMutate, requireMapView, or requireMapCapability`,
    ).toBe(true);
  });

  it.each(routeFiles)('%s does not carry an INTERIM ACCESS marker', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(
      src.includes('INTERIM ACCESS'),
      `Route ${file} still has the legacy INTERIM ACCESS comment — Stage 15 should have removed it.`,
    ).toBe(false);
  });
});

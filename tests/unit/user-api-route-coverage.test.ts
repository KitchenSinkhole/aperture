import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the `/api/v1/*` user API: every route file exports its
 * handlers through `userApiRoute` (`src/lib/userApi/handler.ts`), the one
 * wrapper that runs the request pipeline in its contracted order, and nothing
 * on the API path reads a cookie or a session. A pure file scan, so it catches
 * a hand-rolled handler the moment it lands.
 */

const ROUTES_ROOT = resolve(process.cwd(), 'src/app/api/v1');
const HANDLER = resolve(process.cwd(), 'src/lib/userApi/handler.ts');
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listRouteFiles(path));
    else if (entry === 'route.ts') out.push(path);
  }
  return out;
}

const routeFiles = listRouteFiles(ROUTES_ROOT);

/** Every top-level `export` statement in a file, one per entry. */
function exportStatements(src: string): string[] {
  return src
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('export '));
}

describe('every /api/v1 route exports through the user API wrapper', () => {
  it('discovers the route files', () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(routeFiles)('%s builds its handlers with userApiRoute', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src, `${file} must import userApiRoute from @/lib/userApi/handler`).toMatch(
      /import\s*\{[^}]*\buserApiRoute\b[^}]*\}\s*from\s*'@\/lib\/userApi\/handler'/,
    );
    expect(src, `${file} must build \`const route = userApiRoute(...)\``).toMatch(
      /const route = userApiRoute\(/,
    );
  });

  it.each(routeFiles)('%s exports only wrapper handlers and segment config', (file) => {
    const exportsFound = exportStatements(readFileSync(file, 'utf8'));
    const methods: string[] = [];
    for (const statement of exportsFound) {
      const config = /^export const (runtime|dynamic) = '[a-z-]+';$/.test(statement);
      const method = /^export const ([A-Z]+) = route\.([A-Z]+);$/.exec(statement);
      const throughWrapper =
        method !== null && method[1] === method[2] && HTTP_METHODS.includes(method[1]!);
      expect(
        config || throughWrapper,
        `${file}: \`${statement}\` is neither segment config nor \`export const <METHOD> = route.<METHOD>;\``,
      ).toBe(true);
      if (method) methods.push(method[1]!);
    }
    expect(methods, `${file} must export GET through the wrapper`).toContain('GET');
  });

  it.each([...routeFiles, HANDLER])('%s never reads a cookie or a session', (file) => {
    const src = readFileSync(file, 'utf8');
    for (const pattern of [/\bcookies\b/, /next\/headers/, /\bgetSession\b/, /@\/lib\/auth['/]/]) {
      expect(src, `${file} must not match ${String(pattern)}`).not.toMatch(pattern);
    }
  });
});

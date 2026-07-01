'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

// Targets that don't yet exist 404 by design. UrlObject href bypasses
// `typedRoutes` for the not-yet-existent paths without an `as` cast.
const ITEMS = [
  { path: '/admin', label: 'Dashboard' },
  { path: '/admin/maps', label: 'Maps' },
  { path: '/admin/members', label: 'Members' },
  { path: '/admin/metrics', label: 'Metrics' },
  { path: '/admin/settings', label: 'Settings' },
] as const;

function isActive(pathname: string, path: string): boolean {
  if (path === '/admin') return pathname === '/admin';
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="w-48 shrink-0">
      <ul className="flex flex-col gap-1 text-sm">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.path);
          return (
            <li key={item.path}>
              <Link
                href={{ pathname: item.path }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-1.5 transition-colors',
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

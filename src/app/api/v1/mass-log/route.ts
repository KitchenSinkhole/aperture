import { serveUserApiMassLog, userApiRoute } from '@/lib/userApi/handler';

/** GET /api/v1/mass-log. The token alone selects the map; see `src/lib/userApi/handler.ts`. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const route = userApiRoute('mass-log', 'mass_log', serveUserApiMassLog);

export const GET = route.GET;
export const OPTIONS = route.OPTIONS;

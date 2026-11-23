import { serveUserApiToken, userApiRoute } from '@/lib/userApi/handler';

/** GET /api/v1/token. The token alone selects the map; see `src/lib/userApi/handler.ts`. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const route = userApiRoute('token', null, serveUserApiToken);

export const GET = route.GET;
export const OPTIONS = route.OPTIONS;

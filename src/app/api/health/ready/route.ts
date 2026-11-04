import { readiness } from '@/server/health';
export const dynamic = 'force-dynamic';
export async function GET() {
  const state = await readiness();
  return Response.json(state, {
    status: state.ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

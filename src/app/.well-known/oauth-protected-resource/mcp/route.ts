export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function origin(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) return `${proto ?? 'https'}://${host}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const base = origin(request);
  return Response.json(
    {
      resource: `${base}/mcp`,
      resource_documentation: `${base}/mcp`,
      bearer_methods_supported: [],
      scopes_supported: [],
      authorization_servers: [],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}

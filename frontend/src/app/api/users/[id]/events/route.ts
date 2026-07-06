const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/users/[id]/events">,
) {
  const { id } = await ctx.params;
  const geonameid = new URL(request.url).searchParams.get("geonameid");
  const query = geonameid ? `?geonameid=${encodeURIComponent(geonameid)}` : "";
  try {
    const res = await fetch(`${apiUrl}/users/${id}/events${query}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return Response.json([], { status: 502 });
    }
    return Response.json(await res.json());
  } catch {
    return Response.json([], { status: 502 });
  }
}

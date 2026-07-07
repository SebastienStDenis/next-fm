const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/users/[id]/events">,
) {
  const { id } = await ctx.params;
  const geonameid = new URL(request.url).searchParams.get("geonameid");
  // Ignored events come along, flagged, so the panel can offer undo.
  const params = new URLSearchParams({ include_ignored: "true" });
  if (geonameid) {
    params.set("geonameid", geonameid);
  }
  try {
    const res = await fetch(`${apiUrl}/users/${id}/events?${params}`, {
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

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/users/[id]/events">,
) {
  const { id } = await ctx.params;
  const geonameid = new URL(request.url).searchParams.get("geonameid");
  // Known and ignored events are always requested; the events panel filters
  // known ones view-side and shows ignored ones dimmed with an undo control.
  const params = new URLSearchParams({
    include_known_artists: "true",
    include_ignored: "true",
  });
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

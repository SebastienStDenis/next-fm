const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/users/[id]/sync">,
) {
  const { id } = await ctx.params;
  try {
    const res = await fetch(`${apiUrl}/users/${id}/sync`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return Response.json(null, { status: 502 });
    }
    return Response.json(await res.json());
  } catch {
    return Response.json(null, { status: 502 });
  }
}

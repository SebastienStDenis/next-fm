const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return Response.json([]);
  }
  const res = await fetch(`${apiUrl}/cities?q=${encodeURIComponent(q)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return Response.json([], { status: 502 });
  }
  return Response.json(await res.json());
}

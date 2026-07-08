import { apiFetch } from "@/lib/api";

export async function GET() {
  try {
    const res = await apiFetch("/me/sync", { cache: "no-store" });
    if (!res.ok) {
      return Response.json(null, { status: 502 });
    }
    return Response.json(await res.json());
  } catch {
    return Response.json(null, { status: 502 });
  }
}

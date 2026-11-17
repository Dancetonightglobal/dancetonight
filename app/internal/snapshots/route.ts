import { getRepository } from "@/src/data";
import { DbListingsRepository } from "@/src/data/db-repository";
import { isInternalToken } from "@/src/edge/internal-token";
import { CITY_DIRECTORY_KEY } from "@/src/data/city-directory";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isInternalToken(request.headers.get("x-dt-internal"))) {
    return new Response("Not found", { status: 404 });
  }

  const repo = getRepository();
  if (!(repo instanceof DbListingsRepository)) {
    return Response.json({});
  }

  const result = await repo.refreshCitySnapshots(new Date());
  const directory = await repo.refreshCityDirectory(new Date());
  return Response.json(
    { ...result, [CITY_DIRECTORY_KEY]: directory },
    {
      headers: { "cache-control": "no-store" },
    },
  );
}

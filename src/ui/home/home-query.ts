// Resolves the home page query, applying the early-hours rule (D-518): when no explicit day is
// asked for and it is before 06:00 local, the page opens the coming night if nothing from last
// night is still on now.
import type { RawParams } from "@/src/ui/home/params";
import type { HomeQuery } from "@/src/ui/home/params";
import type { ListingsRepository } from "@/src/data/repository";
import { parseHomeParams } from "@/src/ui/home/params";
import {
  isEarlyHours,
  currentNightDate,
  homeDefaultNight,
  isOpenableNight,
} from "@/src/domain/tonight";

function one(params: RawParams, key: string): string | null {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

export async function resolveHomeQuery(
  params: RawParams,
  now: Date,
  tz: string,
  defaultRadiusKm: number | undefined,
  repository: Pick<ListingsRepository, "listNight">,
): Promise<HomeQuery> {
  const first = parseHomeParams(params, now, tz, defaultRadiusKm);
  // Not the early hours: no repository call.
  if (!isEarlyHours(now, tz)) return first;

  // An explicit openable day wins; no repository call.
  const dayRaw = one(params, "day");
  if (dayRaw !== null && isOpenableNight(dayRaw, now, tz)) return first;

  // Count listings on now for last night.
  const lastNight = currentNightDate(now, tz);
  const result = await repository.listNight({
    center: first.center,
    radiusKm: first.radiusKm,
    nightDate: lastNight,
    now,
    filters: { onNow: true },
    sort: first.sort,
  });
  const onNow = result.listings.length;

  const defaultNight = homeDefaultNight(now, tz, onNow);
  return parseHomeParams(params, now, tz, defaultRadiusKm, defaultNight);
}

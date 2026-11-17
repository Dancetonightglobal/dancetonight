// Runs a block of tests twice, under TZ=UTC and TZ=America/New_York, to prove the domain
// functions never depend on the process zone. Node re-reads TZ when process.env.TZ changes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

export const PROCESS_ZONES = ["UTC", "America/New_York"] as const;

/** Offset in minutes that `new Date(2026, 0, 1)` reports under each process zone (proof it applied). */
const EXPECTED_JAN_OFFSET: Record<(typeof PROCESS_ZONES)[number], number> = {
  UTC: 0,
  "America/New_York": 300,
};

export function describeInProcessZones(name: string, body: () => void): void {
  for (const zone of PROCESS_ZONES) {
    describe(`${name} (TZ=${zone})`, () => {
      let previous: string | undefined;
      beforeAll(() => {
        previous = process.env.TZ;
        process.env.TZ = zone;
      });
      afterAll(() => {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      });
      it(`runs with the process zone set to ${zone}`, () => {
        expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(EXPECTED_JAN_OFFSET[zone]);
      });
      body();
    });
  }
}

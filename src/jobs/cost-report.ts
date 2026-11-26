// What DanceTonight's AI spent (D-895): `pnpm -s cost:report`. Read-only: SELECTs in a read-only transaction over
// cost_log, the row every model call writes (src/ai, D-039). It prints the last 30 days by day and provider, the
// month by metro, and the Cloudflare neurons above the free 10,000 a day that Workers Paid bills. The daily check's
// own Bedrock pass (ops/daily-check/notdance.py) does not write cost_log; the workflow asks AWS Cost Explorer for
// the account's real Bedrock bill beside it. Started by hand: .github/workflows/cost-report.yml.
import postgres from "postgres";

const CLOUDFLARE_FREE_NEURONS = 10_000;
const CLOUDFLARE_USD_PER_1000_NEURONS = 0.011;
const usd = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;

async function main(): Promise<number> {
  const url = (process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL)?.trim();
  if (!url) {
    console.log("DATABASE_URL is not set");
    return 2;
  }
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, onnotice: () => {} });
  try {
    await sql.begin("read only", async (tx) => {
      const [span] = await tx`
        select min(created_at)::text as first, max(created_at)::text as last, count(*)::int as n from cost_log`;
      console.log(`cost_log: ${span?.n} rows, ${span?.first} .. ${span?.last}`);

      const byProvider = await tx`
        select provider, count(*)::int as rows, sum(requests)::int as requests, sum(usd) as usd,
               sum(cost) filter (where unit = 'neurons') as neurons
        from cost_log where created_at >= now() - interval '30 days' group by 1 order by 4 desc`;
      console.log("last 30 days by provider:");
      for (const r of byProvider)
        console.log(
          `  ${r.provider}: ${usd(r.usd)}, ${r.requests} requests${r.neurons ? `, ${Math.round(Number(r.neurons))} neurons` : ""}`,
        );

      const days = await tx`
        select (created_at at time zone 'America/New_York')::date::text as day,
               sum(usd) filter (where provider = 'bedrock') as bedrock,
               sum(usd) as all_usd,
               coalesce(sum(cost) filter (where provider = 'cloudflare' and unit = 'neurons'), 0) as neurons
        from cost_log where created_at >= now() - interval '30 days' group by 1 order by 1`;
      console.log("last 30 days by day (ET): bedrock, all providers, cloudflare neurons");
      let bedrock = 0;
      let overNeurons = 0;
      for (const d of days) {
        bedrock += Number(d.bedrock ?? 0);
        overNeurons += Math.max(0, Number(d.neurons) - CLOUDFLARE_FREE_NEURONS);
        console.log(
          `  ${d.day} ${usd(d.bedrock)} ${usd(d.all_usd)} ${Math.round(Number(d.neurons))}`,
        );
      }
      const neuronUsd = (overNeurons / 1000) * CLOUDFLARE_USD_PER_1000_NEURONS;
      const n = Math.max(1, days.length);
      console.log(
        `bedrock over ${days.length} days: ${usd(bedrock)} (${usd(bedrock / n)} a day, ${usd((bedrock / n) * 30)} a 30-day month)`,
      );
      console.log(
        `cloudflare neurons above the free 10,000 a day: ${Math.round(overNeurons)} = ${usd(neuronUsd)} (plus the $5 Workers Paid minimum)`,
      );

      const metros = await tx`
        select coalesce(m.slug, '-') as slug, sum(c.usd) as usd, count(distinct (c.created_at at time zone 'UTC')::date)::int as days
        from cost_log c left join metros m on m.id = c.metro_id
        where c.created_at >= now() - interval '30 days' and c.provider = 'bedrock'
        group by 1 order by 2 desc`;
      console.log("bedrock, last 30 days by metro:");
      for (const r of metros) console.log(`  ${r.slug}: ${usd(r.usd)} over ${r.days} days`);

      const jobs = await tx`
        select job, sum(usd) as usd from cost_log
        where created_at >= now() - interval '30 days' and provider = 'bedrock' group by 1 order by 2 desc`;
      console.log(
        `bedrock, last 30 days by job: ${jobs.map((j) => `${j.job}=${usd(j.usd)}`).join(", ")}`,
      );
    });
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Never print the connection string: postgres errors carry a message and a code only.
    console.error("cost-report failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);

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

      const perCall = await tx`
        select job, provider, sum(requests)::int as n, round(avg(input_tokens))::int as tin,
               round(avg(output_tokens))::int as tout, sum(input_tokens)::bigint as sin, sum(output_tokens)::bigint as sout,
               sum(usd) as usd
        from cost_log where created_at >= now() - interval '30 days' group by 1, 2 order by 8 desc`;
      console.log(
        "last 30 days by job and provider: calls, average tokens in/out, total tokens in/out, dollars",
      );
      for (const r of perCall)
        console.log(
          `  ${r.job}/${r.provider}: ${r.n} calls, avg ${r.tin} in / ${r.tout} out, total ${r.sin} in / ${r.sout} out, ${usd(r.usd)} (${((Number(r.usd) / Math.max(1, r.n)) * 100).toFixed(2)} cents a call)`,
        );

      const weeks = await tx`
        select date_trunc('week', created_at)::date::text as wk, sum(requests)::int as n, sum(usd) as usd,
               count(distinct source_id)::int as sources
        from cost_log where provider = 'bedrock' group by 1 order by 1`;
      console.log("bedrock by week: calls, dollars, distinct sources");
      for (const w of weeks)
        console.log(`  ${w.wk}: ${w.n} calls, ${usd(w.usd)}, ${w.sources} sources`);

      const sources = await tx`
        select coalesce(s.url, '-') as url, coalesce(m.slug, '-') as slug, sum(c.requests)::int as n,
               count(distinct (c.created_at at time zone 'UTC')::date)::int as days, sum(c.usd) as usd
        from cost_log c left join sources s on s.id = c.source_id left join metros m on m.id = c.metro_id
        where c.created_at >= now() - interval '30 days' and c.provider = 'bedrock'
        group by 1, 2 order by 5 desc limit 25`;
      console.log("bedrock, last 30 days, top 25 sources: dollars, calls, days with a call");
      for (const r of sources)
        console.log(`  ${usd(r.usd)} ${r.n} calls ${r.days}d ${r.slug} ${r.url}`);

      const [conc] = await tx`
        with per as (select source_id, sum(usd) as usd from cost_log
                     where created_at >= now() - interval '30 days' and provider = 'bedrock' group by 1),
             ranked as (select usd, row_number() over (order by usd desc) as rk, count(*) over () as total,
                               sum(usd) over () as all_usd from per)
        select max(total)::int as sources, max(all_usd) as all_usd,
               sum(usd) filter (where rk <= 25) as top25, sum(usd) filter (where rk <= 100) as top100
        from ranked`;
      console.log(
        `bedrock sources: ${conc?.sources}, top 25 = ${usd(conc?.top25)}, top 100 = ${usd(conc?.top100)} of ${usd(conc?.all_usd)}`,
      );

      const repeat = await tx`
        select case when days >= 20 then '20+ days' when days >= 10 then '10-19 days' when days >= 4 then '4-9 days'
                    else '1-3 days' end as band, count(*)::int as sources, sum(usd) as usd
        from (select source_id, count(distinct (created_at at time zone 'UTC')::date) as days, sum(usd) as usd
              from cost_log where created_at >= now() - interval '30 days' and provider = 'bedrock' group by 1) x
        group by 1 order by 3 desc`;
      console.log(
        "bedrock sources by how many of the last 30 days they needed the model (a changed page each time):",
      );
      for (const r of repeat) console.log(`  ${r.band}: ${r.sources} sources, ${usd(r.usd)}`);

      const recent = await tx`
        select (created_at at time zone 'America/New_York')::date::text as day, provider, job, sum(requests)::int as n
        from cost_log where created_at >= now() - interval '16 days' group by 1, 2, 3 order by 1, 2, 3`;
      console.log("model calls by day (ET), provider and job, last 16 days:");
      for (const r of recent) console.log(`  ${r.day} ${r.provider}/${r.job} ${r.n}`);
      const runs = await tx`
        select (started_at at time zone 'America/New_York')::date::text as day, count(*)::int as runs,
               count(*) filter (where status::text = 'succeeded' or status::text = 'success')::int as ok,
               string_agg(distinct status::text, ',') as statuses
        from job_runs where job = 'ingest' and started_at >= now() - interval '16 days' group by 1 order by 1`;
      console.log("ingest runs by day (ET): runs, statuses");
      for (const r of runs) console.log(`  ${r.day} ${r.runs} runs (${r.statuses})`);
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

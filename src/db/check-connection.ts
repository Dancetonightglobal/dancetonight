// `pnpm db:check`: says what is wrong with DATABASE_URL and DIRECT_DATABASE_URL without ever
// printing a password. Run by the ingest workflow before anything touches the database, so a
// mistyped secret is diagnosed in plain words instead of as "password authentication failed".
//
// For each address it reports the host, port, user and database, the password's length, and
// the mistakes seen in practice: the `[YOUR-PASSWORD]` placeholder or its brackets left in,
// spaces, symbols that need percent-encoding, the IPv6-only direct host (unreachable from
// GitHub's runners), and a pooler address whose user lacks the project reference. Then it
// connects and runs `select 1`.

import postgres from "postgres";

export interface UrlFindings {
  ok: boolean;
  summary: string;
  problems: string[];
}

const PROJECT_REF_USER = /^postgres\.[a-z0-9]{10,}$/;

/** Everything knowable about a connection address without connecting. Never includes the password. */
export function inspectUrl(name: string, raw: string | undefined): UrlFindings {
  const problems: string[] = [];
  if (!raw || !raw.trim()) {
    return { ok: false, summary: `${name}: not set`, problems: [`${name} is empty or missing`] };
  }
  if (raw !== raw.trim())
    problems.push("it starts or ends with a space or a line break; delete them");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return {
      ok: false,
      summary: `${name}: not a readable address`,
      problems: ["it is not a valid postgresql:// address; copy it again from Supabase"],
    };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    problems.push(`it starts with "${url.protocol}//" instead of "postgresql://"`);
  }
  const user = decodeURIComponent(url.username);
  let password = "";
  try {
    password = decodeURIComponent(url.password);
  } catch {
    problems.push("the password contains a % that is not a valid percent-encoding");
    password = url.password;
  }
  const host = url.hostname;
  const port = url.port || "5432";
  const database = url.pathname.replace(/^\//, "") || "(none)";

  if (!password) problems.push("there is no password in it");
  if (/YOUR-PASSWORD/i.test(raw)) problems.push("the placeholder [YOUR-PASSWORD] is still in it");
  else if (/[[\]]/.test(password))
    problems.push("the password contains [ or ]: the placeholder's brackets were left in");
  if (/\s/.test(password)) problems.push("the password contains a space");

  const pooler = /\.pooler\.supabase\.com$/i.test(host);
  const direct = /^db\.[a-z0-9]+\.supabase\.co$/i.test(host);
  if (direct) {
    problems.push(
      "this is the Direct connection address (db.….supabase.co), which is IPv6 only and unreachable from GitHub; use the Transaction or Session pooler address",
    );
  }
  if (pooler && !PROJECT_REF_USER.test(user)) {
    problems.push(
      `the user is "${user}", but the pooler needs "postgres.<project id>"; copy the pooler address again rather than editing the direct one`,
    );
  }

  const kind = pooler
    ? port === "6543"
      ? "transaction pooler"
      : "session pooler"
    : direct
      ? "direct"
      : "other host";
  return {
    ok: problems.length === 0,
    summary: `${name}: ${kind} ${host}:${port}, user ${user}, database ${database}, password ${password.length} characters`,
    problems,
  };
}

/** Connects and runs `select 1`; the error message, if any, carries no password. */
export async function tryConnect(raw: string): Promise<string | null> {
  const sql = postgres(raw.trim(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 1,
    onnotice: () => {},
  });
  try {
    await sql`select 1`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

async function main(): Promise<number> {
  let failed = false;
  for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL"] as const) {
    const raw = process.env[name];
    const findings = inspectUrl(name, raw);
    console.log(findings.summary);
    for (const problem of findings.problems) console.log(`  - problem: ${problem}`);
    if (raw && raw.trim()) {
      const error = await tryConnect(raw);
      if (error) {
        failed = true;
        console.log(`  - connecting failed: ${error}`);
        if (/password authentication failed/i.test(error)) {
          console.log(
            "  - the address reaches the database but the password is wrong for it. Reset the password in Supabase (letters and numbers only), put it in both addresses, update both secrets, wait a minute, and run again.",
          );
        }
      } else {
        console.log("  - connected: ok");
      }
    }
    if (!findings.ok) failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1]?.endsWith("check-connection.ts")) {
  main().then((code) => process.exit(code));
}

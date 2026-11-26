// Maintenance M1 (the owner 2026-11-16): copy nights more than 7 days past (D-894) to the archive spreadsheet (a tab per month),
// then delete them; their addresses then say "This night has passed" (archived_events).
// `pnpm archive:past`, run daily by .github/workflows/archive.yml.
// A dry run (the default: anything but ARCHIVE_DRY_RUN=0) only counts and needs no Google credentials.
import { closeDb, getDb } from "@/src/db/client";
import { runArchive } from "@/src/pipeline/archive-past";
import { googleSheetsClient } from "@/src/pipeline/google-sheets";

async function main(): Promise<number> {
  const dryRun = process.env.ARCHIVE_DRY_RUN?.trim() !== "0";
  const saJson = process.env.GOOGLE_SA_JSON?.trim() ?? "";
  const spreadsheetId = process.env.ARCHIVE_SPREADSHEET_ID?.trim() ?? "";
  if (!dryRun && (saJson === "" || spreadsheetId === "")) {
    console.error(
      "ARCHIVE_DRY_RUN=0 needs the GOOGLE_SA_JSON secret and the ARCHIVE_SPREADSHEET_ID variable",
    );
    return 1;
  }
  const sheets = dryRun ? null : googleSheetsClient({ saJson, spreadsheetId });
  const result = await runArchive({ db: getDb(), sheets, now: new Date(), dryRun });
  const verb = result.dryRun ? "would archive" : "archived";
  console.log(
    `${verb} ${result.events} events and ${result.reports} reports` +
      (result.months.length > 0 ? ` (months ${result.months.join(", ")})` : ""),
  );
  return 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    // Never print the service-account key: the clients' errors carry a status and a short body only.
    console.error("archive failed:", error instanceof Error ? error.message : String(error));
    await closeDb();
    process.exit(1);
  });

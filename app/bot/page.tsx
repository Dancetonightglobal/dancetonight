// /bot: the page DanceTonightBot's User-Agent links to (D-021, D-041), for the people who run the
// sites it reads. Who we are, what it fetches, the rules it keeps and how to opt out, on the same
// paper as the rest of the site (D-069). Every rule stated here is one the crawler keeps in code
// (src/pipeline/http.ts); the interval is read from there so the page cannot drift from it.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { env } from "@/src/config/env";
import { t } from "@/src/i18n";
import { CRAWL_INTERVAL_MS, buildUserAgent } from "@/src/pipeline/http";
import { siteOrigin } from "@/src/ui/detail/page-url";
import { SectionHead } from "@/src/ui/primitives";

export const metadata: Metadata = { title: t("bot.title") };

export default async function BotPage() {
  // The User-Agent line names this site's own address, which comes from the request when no
  // base URL is configured.
  await connection();
  const origin = (await siteOrigin()) ?? "";
  const contact = env.BOT_CONTACT_EMAIL;
  const userAgent = buildUserAgent(origin, contact);
  const body = "type-body text-ink mt-4";
  return (
    <main className="max-w-list mx-auto px-4 pt-4 pb-16">
      <nav>
        <Link
          href="/"
          className="type-label text-ink inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {t("errors.goHome")}
        </Link>
      </nav>
      <h1 className="type-detail-title text-ink mt-3">{t("bot.title")}</h1>
      <p className={body}>{t("bot.what")}</p>
      <p className={body}>{t("bot.fetches")}</p>
      <p className={body}>{t("bot.how", { count: CRAWL_INTERVAL_MS / 1000 })}</p>
      <p className={body}>{t("bot.stores")}</p>
      <p className={body}>{t("bot.optOut")}</p>
      {contact === undefined ? null : (
        <>
          <p className={body}>{t("bot.contactLead")}</p>
          <p>
            <a
              className="type-body text-ink inline-flex min-h-11 items-center underline underline-offset-4"
              href={`mailto:${contact}`}
            >
              {t("bot.email", { email: contact })}
            </a>
          </p>
        </>
      )}
      <SectionHead>{t("bot.userAgent")}</SectionHead>
      <p className="type-secondary text-ink bg-halftone border-halftone mt-3 border px-3 py-2 break-words">
        {userAgent}
      </p>
    </main>
  );
}

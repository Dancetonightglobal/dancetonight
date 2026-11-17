// The page for something we do not have: a listing that is gone, or any address we never had.
// Same paper, same ink, one way back: this is a flyer that is no longer on the lamppost (D-069).
// A server component, so the message, the button and the title are in the HTML itself.

import Link from "next/link";

import { t } from "@/src/i18n";
import { SECONDARY_BUTTON } from "@/src/ui/detail/buttons";

export function MissingPage({ message }: { message: string }) {
  return (
    <main className="max-w-list mx-auto px-4 py-6">
      <h1 className="type-card-name text-ink">{message}</h1>
      <p className="mt-6">
        <Link className={SECONDARY_BUTTON} href="/">
          {t("errors.goHome")}
        </Link>
      </p>
    </main>
  );
}

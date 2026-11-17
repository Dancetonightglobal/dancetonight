import type { Metadata, Viewport } from "next";

import { t } from "@/src/i18n";
import { NavMemoryScript } from "@/src/ui/detail/nav-memory-script";
import { ThemeScript } from "@/src/ui/theme";
import { PAPER_DARK, PAPER_LIGHT } from "@/src/ui/home/page-tokens";

import "./globals.css";

export const metadata: Metadata = {
  // Every page's own title carries the site name after it ("Tango Cafe · Wed, Sep 30 ·
  // DanceTonight"), so a tab, a bookmark or a shared link says where it is from (D-069). Next
  // fills %s with the page's title, and a page that sets none is the site name alone. The template
  // reaches child segments only, not a page in this layout's own segment, so the home page writes
  // the same form itself from its headline, "Tonight near New York · DanceTonight" (app/page.tsx,
  // D-067, D-076).
  title: {
    default: t("common.siteName"),
    template: t("common.titleTemplate", { page: "%s", site: t("common.siteName") }),
  },
  description: t("common.tagline"),
};

export const viewport: Viewport = {
  // iOS 26 Safari draws the page under its status bar and blurs that strip, even at the top of the
  // scroll, which cut into the headline (owner, 2026-10-29). With `cover` the page gets the real
  // insets (env(safe-area-inset-*)), and the header, now strip, phone map and toggle leave room.
  viewportFit: "cover",
  // The browser chrome is painted from the same paper the page is, in whichever theme is on, so
  // the flyer runs to the edge of the screen instead of stopping at a white bar.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PAPER_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: PAPER_DARK },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // scroll-pt-8 is the sticky now strip's 32px and scroll-pb-16 the list/map toggle, so a card
    // or chip scrolled into view by keyboard focus never lands under either (WCAG 2.2, 2.4.11).
    <html lang="en" className="scroll-pt-8 scroll-pb-16">
      <head>
        <ThemeScript />
        {/*
          The face every role uses, asked for with the HTML rather than after the CSS is parsed:
          on a slow phone network it arrived at about 2.1s and the page jumped (CLS 0.114, review
          2026-09-28). DESIGN section 4 asks for it preloaded.
        */}
        <link
          rel="preload"
          href="/fonts/InterVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Records, on this history entry, which page of ours is behind it, for the detail
            page's back link (D-069). */}
        <NavMemoryScript />
      </head>
      <body className="bg-paper text-ink">{children}</body>
    </html>
  );
}

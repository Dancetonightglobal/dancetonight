// First paint (DESIGN section 5): the server-rendered page opens with the now rule about a
// third of the way down the viewport, whenever at least one card sits above it. If nothing has
// started yet the rule is already at the top of the bill and the page starts at the top, so
// this renders nothing.
//
// It is an inline script placed immediately after the list, so it runs during parse — before
// hydration and before the first paint of the scrolled position — which is what "no visible
// jump" means. A failure leaves the page at the top, which is the correct fallback.

// Arrivals only: a load that came from this page itself (the more-filters form, or a filter link
// tapped before hydration) keeps the dancer at the controls they just used, rather than jumping
// past them to the now rule (review, 2026-09-28). Filter links after hydration re-render in place
// and never run this script at all.
const SCRIPT = (id: string) =>
  `(function(){try{if(document.referrer){var r=new URL(document.referrer);` +
  `if(r.origin===location.origin&&r.pathname===location.pathname)return}` +
  `var e=document.getElementById(${JSON.stringify(id)});if(!e)return;` +
  `var y=e.getBoundingClientRect().top+window.pageYOffset-window.innerHeight/3;` +
  `if(y>0)window.scrollTo(0,y)}catch(e){}})()`;

export function ScrollToNow({ targetId, enabled }: { targetId: string; enabled: boolean }) {
  if (!enabled) return null;
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT(targetId) }} />;
}

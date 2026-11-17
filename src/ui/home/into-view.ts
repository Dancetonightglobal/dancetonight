// A sideways strip (the day picker, the chip row) is a plain overflow-x list, so a server render
// always opens it scrolled to its start, and the chosen item can sit off the right edge where its
// underline, the only mark of which one is chosen, cannot be seen (review, 2026-09-28). This inline
// script runs as the strip is parsed, before paint, and brings the chosen item in. It moves the
// strip only, never the page, which is why it sets scrollLeft rather than calling scrollIntoView.

/** The script for the strip `listId`, bringing its first `a[aria-current]` into view. */
export function intoViewScript(listId: string): string {
  return (
    `(function(){try{var u=document.getElementById(${JSON.stringify(listId)});` +
    `var a=u&&u.querySelector("a[aria-current]");if(!a)return;` +
    `var r=a.getBoundingClientRect(),b=u.getBoundingClientRect();` +
    `if(r.right>b.right||r.left<b.left)u.scrollLeft+=r.left-b.left-16}catch(e){}})()`
  );
}

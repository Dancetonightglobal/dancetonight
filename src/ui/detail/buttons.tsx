// The two button shapes the design allows (DESIGN.md sections 4 and 5): a primary is an ink fill
// with paper text, a secondary is ink text in a hairline edge, both with the 12px control radius
// (D-147). Both are 44px targets. Kept here so the page, the actions row and the client-side
// buttons cannot drift into three different buttons.

export const PRIMARY_BUTTON =
  "type-button bg-ink text-paper rounded-control min-h-11 inline-flex items-center justify-center px-4 text-center";

export const SECONDARY_BUTTON =
  "type-button text-ink chip-edge rounded-control min-h-11 inline-flex items-center justify-center px-4 text-center";

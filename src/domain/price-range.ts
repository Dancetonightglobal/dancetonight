// A ticket price range from a ticketing API or a feed's AggregateOffer, as the label of one price
// row (D-071). Both ends
// carry the currency, "$10 to $20", the way the detail page prints an amount: the bare
// "Tickets, 27.46 to 70.72" that runs 20 to 26 stored read as two counts, not two prices.
// The row's amount stays null, since a range is not one amount.

/** An amount with its currency: "$20", "$27.46", "€12.50". Whole amounts have no cents. */
export function formatMoney(amount: number, currency: string): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    // Not a currency Intl knows: the code itself, as the price table prints it.
    return `${currency} ${amount.toFixed(digits)}`;
  }
}

/** "Tickets, $10 to $20": the row's name, then both ends with their currency. */
export function priceRangeLabel(name: string, min: number, max: number, currency: string): string {
  return `${name}, ${formatMoney(min, currency)} to ${formatMoney(max, currency)}`;
}

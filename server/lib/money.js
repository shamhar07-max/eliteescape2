/* AED amounts are stored as integer fils (1 AED = 100 fils) so financial
 * arithmetic never touches IEEE754 floating point — a REAL/float column
 * can silently misrepresent currency after enough sums (e.g. repeated 5%
 * VAT calculations across many invoices). The API contract at the route
 * boundary is unchanged: callers still send/receive AED as a decimal
 * number; conversion happens only here, at the edges. */
export const toFils = (aed) => Math.round(Number(aed) * 100);
export const toAed = (fils) => Math.round(Number(fils)) / 100;

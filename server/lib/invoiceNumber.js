import { nextSequence } from "./sequence.js";

export const nextInvoiceNumber = () => nextSequence("invoice", "INV");

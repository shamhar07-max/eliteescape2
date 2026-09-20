import crypto from "node:crypto";

export const genToken = () => crypto.randomBytes(32).toString("hex");

export const SESSION_DAYS = 7;
export const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();

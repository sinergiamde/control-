/** How the app recognizes the same bank statement uploaded twice. Two independent fingerprints, both
 * unique in the database (analyses.file_hash / analyses.statement_key):
 *  - the SHA-256 of the file itself (same PDF uploaded again), and
 *  - what the bank printed on it: account (last 4 digits), period and opening/closing balances — so a
 *    re-downloaded copy of the same statement, with different bytes, is caught too. */

const US_RANGE = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:-|–|—|to|al|a)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
const ISO_RANGE = /(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:-|–|—|to|al|a)\s*(\d{4})-(\d{1,2})-(\d{1,2})/i;
const pad = (n: string | number) => String(n).padStart(2, "0");

const isoDate = (v: unknown) => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** A balance the statement printed (the analyzer marks "not printed" with -999999999 or, in the bank
 * summary box, -1). */
const headerBalance = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > -999999990 ? v : null);
const boxBalance = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v !== -1 ? v : null);

export const statementKey = (fullAnalysis: any): string | null => {
  const src = fullAnalysis?.analysis ?? fullAnalysis;
  if (!src || typeof src !== "object") return null;
  const info = src.accountInfo || {};
  const box = src.bankSummary?.found ? src.bankSummary : {};

  let start = isoDate(info.periodStart);
  let end = isoDate(info.periodEnd);
  if (!start || !end) {
    const text = String(src.period || "");
    const us = text.match(US_RANGE);
    const iso = text.match(ISO_RANGE);
    if (us) {
      start = `${us[3]}-${pad(us[1])}-${pad(us[2])}`;
      end = `${us[6]}-${pad(us[4])}-${pad(us[5])}`;
    } else if (iso) {
      start = `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
      end = `${iso[4]}-${pad(iso[5])}-${pad(iso[6])}`;
    }
  }
  const opening = headerBalance(info.beginningBalance) ?? boxBalance(box.beginningBalance);
  const closing = headerBalance(info.endingBalance) ?? boxBalance(box.endingBalance);
  if (!start || !end || opening === null || closing === null) return null;
  const last4 = String(info.accountNumberLast4 || "").replace(/\D/g, "").slice(-4) || "----";
  return [last4, start, end, opening.toFixed(2), closing.toFixed(2)].join("|");
};

/** SHA-256 of the file, hex. Null where the browser offers no crypto (plain-http LAN address). */
export const fileSha256 = async (file: Blob): Promise<string | null> => {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
};

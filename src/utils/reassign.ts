import { needsSpecify, normalizeAnalysisTransactions, type TransactionList } from "./reportTypes";

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : 0;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

const sumList = (arr: unknown) =>
  (Array.isArray(arr) ? arr : []).reduce((sum: number, it: any) => sum + toNumber(it?.amt ?? it?.amount), 0);

/** Words that say nothing about who the transaction was with. */
const GENERIC_WORDS = new Set([
  "debit", "credit", "card", "purchase", "payment", "pymt", "pmt", "online", "transfer", "mobile", "recurring", "pin",
  "pos", "ach", "withdrawal", "deposit", "check", "cheque", "from", "with", "store", "inc", "llc", "corp",
]);
const amountVariants = (amount: number) => {
  const fixed = amount.toFixed(2);
  const grouped = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [...new Set([fixed, grouped, grouped.replace(/,/g, "#").replace(/\./g, ",").replace(/#/g, ".")])];
};

/** Removes the AI alerts that talk about this transaction (they mention its amount and something of its
 * description), from both languages at once: after a person reclassifies it, those alerts are stale —
 * e.g. "Texas Roadhouse $436.85 classified as personal" once it was moved to work meals. */
export const dropAlertsAbout = (source: any, txn: { amount: number; desc: string }) => {
  const variants = amountVariants(txn.amount);
  const words = String(txn.desc || "")
    .toLowerCase()
    .split(/[^a-záéíóúñ0-9]+/i)
    .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w) && !/^\d+$/.test(w));
  const mentions = (text: unknown) => {
    const t = String(text ?? "").toLowerCase();
    return variants.some((v) => t.includes(v)) && (words.length === 0 || words.some((w) => t.includes(w)));
  };
  const en: unknown[] = Array.isArray(source.alerts_en) ? source.alerts_en : [];
  const es: unknown[] = Array.isArray(source.alerts_es) ? source.alerts_es : [];
  const stale = new Set<number>();
  en.forEach((a, i) => mentions(a) && stale.add(i));
  es.forEach((a, i) => mentions(a) && stale.add(i));
  if (stale.size === 0) return;
  // alerts_en[i] and alerts_es[i] are the same alert in two languages.
  if (Array.isArray(source.alerts_en)) source.alerts_en = en.filter((_, i) => !stale.has(i));
  if (Array.isArray(source.alerts_es)) source.alerts_es = es.filter((_, i) => !stale.has(i));
};

export interface TxnRef {
  list: TransactionList;
  rawDate: string;
  desc: string;
  amount: number;
}

/** Moves one transaction of a saved statement to another category (and, if needed, another section:
 * e.g. a "Meals" line in OpEx becomes "Entertainment" in Personal). The transaction is found by its
 * date, description and amount rather than its position, so it works from any screen. Returns the
 * updated analysis plus the stored totals that must be refreshed with it. */
export const moveTransaction = (fullAnalysis: any, ref: TxnRef, targetList: TransactionList, targetCategory: string, specify = "") => {
  if (needsSpecify(targetCategory) && !specify.trim()) throw new Error("Escribe qué es esta transacción (obligatorio al elegir “Otro”).");
  const full = JSON.parse(JSON.stringify(fullAnalysis ?? {}));
  const source = full?.analysis ?? full;
  // Same cleanup the report applies, so positions and sections match what the person saw.
  normalizeAnalysisTransactions(source);

  const from: any[] = Array.isArray(source[ref.list]) ? source[ref.list] : [];
  const index = from.findIndex(
    (item) =>
      String(item?.date ?? "") === ref.rawDate &&
      String(item?.desc || item?.name || "") === ref.desc &&
      Math.abs(toNumber(item?.amt ?? item?.amount) - ref.amount) < 0.005
  );
  if (index < 0) throw new Error("Transaction not found");
  const [moved] = from.splice(index, 1);
  moved.category = targetCategory;
  moved.manual = true;
  if (needsSpecify(targetCategory)) moved.specify = specify.trim();
  else delete moved.specify;
  if (!Array.isArray(source[targetList])) source[targetList] = [];
  source[targetList].push(moved);
  dropAlertsAbout(source, { amount: ref.amount, desc: ref.desc });

  const revenues = sumList(source.revenues);
  const cogs = sumList(source.cogs);
  const opex = sumList(source.opex);
  const fees = sumList(source.fees);
  const personal = sumList(source.personal);
  const top = [...(source.cogs || []), ...(source.opex || []), ...(source.fees || []), ...(source.personal || [])]
    .sort((a: any, b: any) => toNumber(b?.amt ?? b?.amount) - toNumber(a?.amt ?? a?.amount))[0];

  return {
    full,
    totals: {
      revenues_total: revenues,
      cogs_total: cogs,
      opex_total: opex,
      fees_total: fees,
      personal_total: personal,
      total_spent: cogs + opex + fees + personal,
      top_category: String(top?.desc || top?.category || ""),
    },
  };
};

/** Check number in a bank line ("CHECK 2550", "Check #2550", "CHK 2550"), or null. */
export const checkNumberOf = (desc: unknown): string | null => {
  const m = String(desc ?? "").match(/\b(?:check|cheque|chk)\b\s*(?:no\.?|#)?\s*(\d{2,})/i);
  return m ? m[1] : null;
};

/** Records who a check (or any transaction) was paid to and what for. Also fills the payee of the
 * matching entry in the 1099 list, and removes AI alerts asking to document checks once every check
 * they list is documented. */
export const documentTransaction = (fullAnalysis: any, ref: TxnRef, payee: string, purpose: string) => {
  const full = JSON.parse(JSON.stringify(fullAnalysis ?? {}));
  const source = full?.analysis ?? full;
  normalizeAnalysisTransactions(source);
  const list: any[] = Array.isArray(source[ref.list]) ? source[ref.list] : [];
  const item = list.find(
    (it) =>
      String(it?.date ?? "") === ref.rawDate &&
      String(it?.desc || it?.name || "") === ref.desc &&
      Math.abs(toNumber(it?.amt ?? it?.amount) - ref.amount) < 0.005
  );
  if (!item) throw new Error("Transaction not found");
  item.payee = payee.trim();
  item.purpose = purpose.trim();

  const number = checkNumberOf(item.desc || item.name);
  if (number && Array.isArray(source.thirdPartyPayments)) {
    for (const p of source.thirdPartyPayments) {
      if (String(p?.method) === "Check" && String(p?.identifier ?? "").replace(/\D/g, "") === number) p.payee = item.payee;
    }
  }

  // Check numbers already documented in this statement.
  const documented = new Set<string>();
  for (const l of ["revenues", "cogs", "opex", "fees", "personal"]) {
    for (const it of Array.isArray(source[l]) ? source[l] : []) {
      const n = checkNumberOf(it?.desc || it?.name);
      if (n && String(it?.payee ?? "").trim()) documented.add(n);
    }
  }
  const allDocumented = (text: unknown) => {
    const numbers = [...String(text ?? "").matchAll(/#\s?(\d{2,})/g)].map((m) => m[1]);
    return numbers.length > 0 && numbers.every((n) => documented.has(n));
  };
  const en: unknown[] = Array.isArray(source.alerts_en) ? source.alerts_en : [];
  const es: unknown[] = Array.isArray(source.alerts_es) ? source.alerts_es : [];
  const done = new Set<number>();
  en.forEach((a, i) => allDocumented(a) && done.add(i));
  es.forEach((a, i) => allDocumented(a) && done.add(i));
  if (done.size > 0) {
    if (Array.isArray(source.alerts_en)) source.alerts_en = en.filter((_, i) => !done.has(i));
    if (Array.isArray(source.alerts_es)) source.alerts_es = es.filter((_, i) => !done.has(i));
  }
  return full;
};

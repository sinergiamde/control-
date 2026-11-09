// Shared shapes for the P&L report pipeline: analyze-statement response ->
// Results.tsx / consolidateReport.ts (produce ResultsData) -> generateExcel.ts / generatePDF.ts (render it).
// Keeping these in one place avoids the 4 call sites drifting out of sync as fields are added.

export type SectionKind = "revenue" | "cogs" | "opex" | "food" | "personal" | "thirdParty";

export interface LineItem {
  name: string;
  amount: number;
  percentage: number;
  detail?: string;
  category?: string;
}

export interface Section {
  title: string;
  // Optional so legacy/fallback response shapes (pre-dating this field) still typecheck;
  // renderers should fall back to a default color/order when it's missing.
  kind?: SectionKind;
  items: LineItem[];
  total: number;
  totalLabel: string;
}

export type ThirdPartyDirection = "incoming" | "outgoing";

export interface ThirdPartyPayment {
  method: string; // "Check" | "Zelle"
  direction: ThirdPartyDirection;
  identifier: string;
  payee?: string;
  date?: string;
  amt: number;
  category?: string;
  classification?: string;
  alert?: string;
}

export interface ThirdPartyBuckets {
  checks: ThirdPartyPayment[];
  zelleOutgoing: ThirdPartyPayment[];
  zelleIncoming: ThirdPartyPayment[];
  personalTransfers: LineItem[];
}

export interface BankSummaryField {
  instances: number | null;
  amount: number | null;
}

export interface BankSummary {
  found: boolean;
  beginningBalance: number | null;
  endingBalance: number | null;
  deposits: BankSummaryField;
  checksPaid: BankSummaryField;
  atmDebitWithdrawals: BankSummaryField;
  electronicWithdrawals: BankSummaryField;
  otherWithdrawals: BankSummaryField;
}

export interface ReconciliationField {
  /** Stable, language-independent key for matching a specific field (e.g. "checksIssued") —
   * use this instead of `label` when looking up a specific field, since `label` is a
   * display string that changes with the selected report language. */
  id: string;
  label: string;
  bankAmount: number | null;
  computedAmount: number;
  delta: number | null;
  ok: boolean;
}

export interface ReconciliationResult {
  bankSummaryFound: boolean;
  ok: boolean;
  fields: ReconciliationField[];
  discrepancies: string[];
}

export interface KPI {
  label: string;
  value: string;
  description: string;
}

/** The raw array a transaction lives in inside analyze-statement's response (`analysis.revenues`,
 * `analysis.cogs`, etc.) — used by the "reassign transaction" feature to know exactly where to
 * remove/re-insert an item when the user moves it to a different category. */
export type TransactionList = "revenues" | "cogs" | "opex" | "fees" | "personal";

/** Same taxonomy analyze-statement's system prompt classifies into (keep these two in sync) — the
 * category picker for reassigning a transaction offers exactly these, grouped by list, so a moved
 * transaction always lands in a category the rest of the report (Excel/PDF/consolidation) already
 * knows how to translate and total correctly. */
export const REASSIGN_TAXONOMY: Record<TransactionList, string[]> = {
  revenues: ["Bank transfer", "Wire transfer", "Zelle", "Check", "Cash deposit", "Refunds and returns", "Other income (specify)"],
  cogs: [
    "Materials", "Supplies", "Storage", "Startup and moving costs", "Subcontractor costs",
    "Tolls (work)", "Permits",
  ],
  opex: [
    "Payroll", "Rent (lease or mortgage)", "Utilities (electric/water)", "Internet", "Business insurance",
    "Fuel (work)", "Parking", "Car insurance", "Car payment", "Repairs and maintenance", "Vehicle expenses",
    "Marketing and advertising", "Subscriptions and membership dues", "Business software",
    "Website and hosting", "Training and development", "Licenses and permits", "Legal and compliance fees",
    "Professional services", "Office supplies", "Office furniture and equipment", "Operating costs",
    "Bad debts or loans", "Travel expenses", "Hotels or lodging", "Meals (work — fast food/coffee/snacks)",
    "Credit card payment", "Business loan",
  ],
  fees: ["Bank fees"],
  personal: [
    "Clothing", "Entertainment", "Personal purchases", "Zelle to family (no business justification)",
    "Personal bank transfer", "Health / personal services", "Meals (restaurant/bar)", "Other personal (specify)",
  ],
};

const TRANSACTION_LISTS: TransactionList[] = ["revenues", "cogs", "opex", "fees", "personal"];

/** Canonical list for every category string in REASSIGN_TAXONOMY (e.g. "Fuel (work)" -> "cogs"),
 * derived from that taxonomy so the two can't drift apart. */
const CANONICAL_LIST_BY_CATEGORY: Record<string, TransactionList> = Object.fromEntries(
  (Object.keys(REASSIGN_TAXONOMY) as TransactionList[]).flatMap((list) =>
    REASSIGN_TAXONOMY[list].map((category) => [category, list] as const)
  )
);

const looseNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.abs(n) : 0;
  }
  return 0;
};

const transactionSignature = (item: any): string => {
  const date = String(item?.date || "").trim().toLowerCase();
  const amt = looseNumber(item?.amt ?? item?.amount);
  const desc = String(item?.desc || item?.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${date}|${amt.toFixed(2)}|${desc}`;
};

/** A deposit that is the bank handing money back for an earlier purchase (a refund, return or
 * reversal). It is income — the money returned to the account — never an expense. Fees for returned
 * checks/items are real expenses, so those are excluded. */
const REFUND_PATTERN = /(debit card return|purchase return|merchant (credit|return)|\brefund(ed)?\b|\breversal\b|credit adjustment|reembolso|devoluci[oó]n)/i;
const NOT_REFUND_PATTERN = /(fee|returned (check|item)|\bnsf\b|insufficient)/i;
export const REFUND_CATEGORY = "Refunds and returns";
/** Every dollar that comes INTO the account is income (the client's rule: total income = the bank's
 * total deposits). An incoming transfer, even from another account of the same owner, is reported in
 * revenues with this category. */
export const INCOMING_TRANSFER_CATEGORY = "Bank transfer";
/** Category an earlier version used to keep incoming transfers out of income; items stored with it
 * (or in the old `transfersIn` list) are moved back into revenues. */
const LEGACY_TRANSFER_IN_CATEGORY = "Transfer in (not income)";
/** A bank line that is money coming in ("ONLINE TRANSFER MOBILE FROM ****4612", "ZELLE FROM ...").
 * Lines naming both a source and a destination ("transfer from CHK to SAV") are ambiguous and left alone. */
const INCOMING_PATTERN = /\b(transfer|xfer|trnsfr|zelle)\b.*\bfrom\b/i;
const NOT_INCOMING_PATTERN = /\bto\b|\bfee\b/i;

const bankNumber = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

/** Smallest group (1-3) of items whose amounts add up to `target` to the cent. */
const findSubset = (items: { amt: number }[], target: number): number[] | null => {
  const eq = (v: number) => Math.abs(v - target) < 0.011;
  const n = items.length;
  for (let i = 0; i < n; i++) if (eq(items[i].amt)) return [i];
  if (n > 80) return null;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (eq(items[i].amt + items[j].amt)) return [i, j];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    if (eq(items[i].amt + items[j].amt + items[k].amt)) return [i, j, k];
  }
  return null;
};

/** Cleans up one statement's raw AI output before anything totals, stores, or renders it:
 *  1) De-duplicates transactions the AI accidentally classified into two different lists (same
 *     date + amount + description) — keeps the first occurrence, drops the rest, so the same
 *     dollar amount never gets counted twice toward expenses/income.
 *  2) Re-buckets any item whose `category` doesn't match the list it's sitting in (e.g. a "Fuel
 *     (work)" item that landed in `opex` one month and `cogs` another) into its one canonical list
 *     per REASSIGN_TAXONOMY, so the same category always rolls up into the same P&L section no
 *     matter which statement/month it came from.
 * Mutates `source` in place (the revenues/cogs/opex/fees/personal arrays) and returns
 * human-readable notes about anything it changed (empty arrays if nothing needed fixing) — call
 * this once, as early as possible, on every raw analyze-statement response, before computing any
 * totals or persisting/rendering anything from it. Idempotent: running it twice on already-clean
 * data is a no-op. */
export const normalizeAnalysisTransactions = (source: any): { notesEn: string[]; notesEs: string[] } => {
  const notesEn: string[] = [];
  const notesEs: string[] = [];
  if (!source || typeof source !== "object") return { notesEn, notesEs };

  // Only a transaction that shows up in TWO DIFFERENT categories is a duplicate. Identical lines
  // inside one category (two $5.00 coffees the same day, two same-amount checks) are real and stay:
  // the report must show exactly what the bank statement shows.
  const seen = new Map<string, TransactionList>();
  for (const list of TRANSACTION_LISTS) {
    if (!Array.isArray(source[list])) continue;
    const kept: any[] = [];
    for (const item of source[list]) {
      const desc = String(item?.desc || item?.name || "").trim();
      const amt = looseNumber(item?.amt ?? item?.amount);
      const isBlank = !desc && amt === 0;
      const sig = transactionSignature(item);
      const owner = seen.get(sig);
      if (!isBlank && owner !== undefined && owner !== list) {
        notesEn.push(`Removed a duplicate transaction found in more than one category: "${desc || "?"}" (${item?.date || "?"}, $${amt.toFixed(2)}) — kept only the first occurrence.`);
        notesEs.push(`Se eliminó una transacción duplicada encontrada en más de una categoría: "${desc || "?"}" (${item?.date || "?"}, $${amt.toFixed(2)}) — se conservó solo la primera aparición.`);
        continue;
      }
      if (!isBlank && owner === undefined) seen.set(sig, list);
      kept.push(item);
    }
    source[list] = kept;
  }

  const rebucketed: Record<TransactionList, any[]> = { revenues: [], cogs: [], opex: [], fees: [], personal: [] };
  // An earlier version kept incoming transfers in a separate `transfersIn` list, outside income.
  if (Array.isArray(source.transfersIn)) {
    for (const item of source.transfersIn) {
      if (item && typeof item === "object") item.category = INCOMING_TRANSFER_CATEGORY;
      rebucketed.revenues.push(item);
    }
  }
  delete source.transfersIn;
  for (const list of TRANSACTION_LISTS) {
    for (const item of Array.isArray(source[list]) ? source[list] : []) {
      const text = String(item?.desc || item?.name || "");
      // Money that came into the account is income, never an expense.
      if (item?.category === LEGACY_TRANSFER_IN_CATEGORY) {
        item.category = INCOMING_TRANSFER_CATEGORY;
        rebucketed.revenues.push(item);
        continue;
      }
      if (list !== "revenues" && !item?.manual && INCOMING_PATTERN.test(text) && !NOT_INCOMING_PATTERN.test(text)) {
        item.category = INCOMING_TRANSFER_CATEGORY;
        rebucketed.revenues.push(item);
        notesEn.push(`"${text}" is money that came INTO the account — it is reported as income, not as an expense.`);
        notesEs.push(`"${text}" es dinero que ENTRÓ a la cuenta — se reporta como ingreso, no como gasto.`);
        continue;
      }
      // Safety net for refunds the AI left among the expenses (unless a person moved it there on purpose).
      if (list !== "revenues" && !item?.manual && REFUND_PATTERN.test(text) && !NOT_REFUND_PATTERN.test(text)) {
        item.category = REFUND_CATEGORY;
        rebucketed.revenues.push(item);
        notesEn.push(`"${text}" is a refund/return — the money came back to the account, so it is reported as income, not an expense.`);
        notesEs.push(`"${text}" es una devolución/reembolso — el dinero regresó a la cuenta, por eso se reporta como ingreso y no como gasto.`);
        continue;
      }
      const canonical = item?.category ? CANONICAL_LIST_BY_CATEGORY[item.category] : undefined;
      if (canonical && canonical !== list) {
        rebucketed[canonical].push(item);
        const desc = item?.desc || item?.name || "?";
        notesEn.push(`Moved "${desc}" (category "${item.category}") from ${list} to ${canonical} for consistency with other statements.`);
        notesEs.push(`Se movió "${desc}" (categoría "${item.category}") de ${list} a ${canonical} para que sea consistente con los demás extractos.`);
      } else {
        rebucketed[list].push(item);
      }
    }
  }
  for (const list of TRANSACTION_LISTS) source[list] = rebucketed[list];

  // Self-check against the bank's own summary box. If deposits are short by exactly the amount the
  // withdrawals are long by, a deposit was filed as an expense: find the item(s) that add up to that
  // difference and move them to income. Only ever done when the bank's numbers prove it.
  const bank = source.bankSummary;
  const bankDeposits = bank?.found ? bankNumber(bank?.deposits?.amount) : null;
  const wParts = bank?.found
    ? [bank.checksPaid, bank.atmDebitWithdrawals, bank.electronicWithdrawals, bank.otherWithdrawals].map((p: any) => bankNumber(p?.amount))
    : [];
  // What really left the account: the bank's printed withdrawal buckets when all are there, otherwise
  // opening balance + deposits - closing balance (the account's own arithmetic).
  // The bank summary marks "not printed" with -1, so only non-negative balances are trusted here.
  const opening = bank?.found ? bankNumber(bank.beginningBalance) : null;
  const closing = bank?.found ? bankNumber(bank.endingBalance) : null;
  const bankOutKnown: number | null =
    wParts.length === 4 && wParts.every((v) => v !== null)
      ? (wParts as number[]).reduce((s, v) => s + v, 0)
      : bankDeposits !== null && opening !== null && closing !== null
      ? opening + bankDeposits - closing
      : null;
  if (bankDeposits !== null && bankOutKnown !== null) {
    const sum = (arr: any[]) => arr.reduce((s, it) => s + looseNumber(it?.amt ?? it?.amount), 0);
    const bankOut = bankOutKnown;
    const depDelta = bankDeposits - sum(source.revenues);
    const outDelta = sum(source.cogs) + sum(source.opex) + sum(source.fees) + sum(source.personal) - bankOut;
    if (depDelta > 1 && Math.abs(depDelta - outDelta) <= 1) {
      for (const list of ["personal", "opex", "cogs", "fees"] as TransactionList[]) {
        const arr: any[] = source[list];
        const hit = findSubset(arr.map((it) => ({ amt: looseNumber(it?.amt ?? it?.amount) })), depDelta);
        if (!hit) continue;
        const moved = hit.map((i) => arr[i]);
        source[list] = arr.filter((_, i) => !hit.includes(i));
        for (const it of moved) {
          it.category = INCOMING_TRANSFER_CATEGORY;
          source.revenues.push(it);
          const desc = it?.desc || it?.name || "?";
          notesEn.push(`"${desc}" (${it?.date || "?"}, $${looseNumber(it?.amt ?? it?.amount).toFixed(2)}) is money that came INTO the account (the bank's deposits include it) — it is reported as income, not as an expense.`);
          notesEs.push(`"${desc}" (${it?.date || "?"}, $${looseNumber(it?.amt ?? it?.amount).toFixed(2)}) es dinero que ENTRÓ a la cuenta (los depósitos del banco lo incluyen) — se reporta como ingreso, no como gasto.`);
        }
        break;
      }
    }
  }

  return { notesEn, notesEs };
};

export interface ResultsData {
  companyName?: string;
  period?: string;
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  totalOpex: number;
  totalFood?: number;
  ebitda: number;
  totalPersonal: number;
  netIncome: number;
  sections: Section[];
  kpis: KPI[];
  redFlags?: string[];
  thirdPartyPayments?: ThirdPartyPayment[];
  thirdPartyBuckets?: ThirdPartyBuckets;
  bankSummary?: BankSummary;
  reconciliation?: ReconciliationResult;
}

export const FOOD_OPEX_CATEGORY = "Meals (work — fast food/coffee/snacks)";
export const PERSONAL_TRANSFER_CATEGORY = "Personal bank transfer";
export const ZELLE_TO_FAMILY_CATEGORY = "Zelle to family (no business justification)";

/** Categories that get pulled out of the "Personal / Other Expenses" line-item list and shown
 * instead (itemized) in the Third Party Payments section/sheet/page, so the same transaction
 * isn't listed twice across the report. The aggregate dollar total is unaffected — these amounts
 * still count toward totalPersonal / Net Income, just displayed in one place instead of two. */
export const PERSONAL_THIRD_PARTY_CATEGORIES = [PERSONAL_TRANSFER_CATEGORY, ZELLE_TO_FAMILY_CATEGORY] as const;

/** Bank-printed summary fields use -1 as "not printed on this statement" — never run them through
 * a generic toNumber()/Math.abs() helper, that would turn -1 into 1 and corrupt the sentinel. */
export const sentinelToNull = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;

export interface ThirdPartyPayeeGroup {
  payee: string;
  rows: ThirdPartyPayment[];
  total: number;
}

/** Best-effort chronological sort key for the free-text "date" the AI copies verbatim off each
 * statement (format varies statement to statement — "01/15", "01/15/2026", "Jan 15 2026", ...).
 * Falls back to the raw string when it can't be parsed, so unparseable dates still sort together
 * in a stable order instead of throwing the whole group out of sequence. */
const dateSortKey = (raw: string | undefined): string => {
  const s = (raw || "").trim();
  if (!s) return "";
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (slash) {
    const [, mm, dd, yy] = slash;
    const year = yy ? (yy.length === 2 ? `20${yy}` : yy) : "0000";
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return s;
};

/** Groups third-party payments by payee (checks carry the name in `payee`; Zelle carries it in
 * `identifier`) so every payment made to the same person shows together — sorted oldest to newest
 * — with its own subtotal, instead of interleaved by date across different people. That subtotal
 * is what answers "how much did I pay Luisa this year" without adding a line up by hand. */
export const groupThirdPartyByPayee = (
  payments: ThirdPartyPayment[],
  fallbackLabel: string
): ThirdPartyPayeeGroup[] => {
  const map = new Map<string, ThirdPartyPayment[]>();
  for (const p of payments) {
    const key = (p.payee || p.identifier || "").trim() || fallbackLabel;
    const arr = map.get(key) || [];
    arr.push(p);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([payee, rows]) => ({
      payee,
      rows: [...rows].sort((a, b) => dateSortKey(a.date).localeCompare(dateSortKey(b.date))),
      total: rows.reduce((sum, p) => sum + p.amt, 0),
    }))
    .sort((a, b) => b.total - a.total);
};

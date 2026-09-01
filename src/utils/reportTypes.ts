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

/** The raw array a transaction lives in inside analyze-statement's response (`analysis.revenues`,
 * `analysis.cogs`, etc.) — used by the "reassign transaction" feature to know exactly where to
 * remove/re-insert an item when the user moves it to a different category. */
export type TransactionList = "revenues" | "cogs" | "opex" | "fees" | "personal";

/** Same taxonomy analyze-statement's system prompt classifies into (keep these two in sync) — the
 * category picker for reassigning a transaction offers exactly these, grouped by list, so a moved
 * transaction always lands in a category the rest of the report (Excel/PDF/consolidation) already
 * knows how to translate and total correctly. */
export const REASSIGN_TAXONOMY: Record<TransactionList, string[]> = {
  revenues: ["Bank transfer", "Wire transfer", "Zelle", "Check", "Cash deposit", "Other income (specify)"],
  cogs: [
    "Materials", "Supplies", "Storage", "Startup and moving costs", "Subcontractor costs",
    "Fuel (work)", "Tolls (work)", "Permits",
  ],
  opex: [
    "Payroll", "Rent (lease or mortgage)", "Utilities (electric/water)", "Internet", "Business insurance",
    "Parking", "Car insurance", "Car payment", "Repairs and maintenance", "Vehicle expenses",
    "Marketing and advertising", "Subscriptions and membership dues", "Business software",
    "Website and hosting", "Training and development", "Licenses and permits", "Legal and compliance fees",
    "Professional services", "Office supplies", "Office furniture and equipment", "Operating costs",
    "Bad debts or loans", "Travel expenses", "Hotels or lodging", "Meals (work — fast food/coffee/snacks)",
  ],
  fees: ["Bank fees"],
  personal: [
    "Clothing", "Entertainment", "Personal purchases", "Zelle to family (no business justification)",
    "Personal bank transfer", "Health / personal services", "Meals (restaurant/bar)", "Other personal (specify)",
  ],
};

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

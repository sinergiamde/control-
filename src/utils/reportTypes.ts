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

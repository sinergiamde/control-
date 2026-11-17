import type { PeriodSelection } from "@/components/PeriodPicker";
import type { FilteredStatement } from "./statementPeriod";

const BUCKETS = ["deposits", "checksPaid", "atmDebitWithdrawals", "electronicWithdrawals", "otherWithdrawals"] as const;
const LISTS = ["revenues", "cogs", "opex", "fees", "personal"] as const;

const srcOf = (full: any) => full?.analysis ?? full;
const printed = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n > -999999990 ? n : null);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Balance a statement printed, from the account header (new analyses) or the bank's summary box. */
const balanceOf = (full: any, key: "beginningBalance" | "endingBalance"): number | null => {
  const src = srcOf(full);
  const fromHeader = printed(src?.accountInfo?.[key]);
  if (fromHeader !== null) return fromHeader;
  return src?.bankSummary?.found ? printed(src.bankSummary[key]) : null;
};

/** One analysis object covering every statement in `filtered` (already cut to the selected dates), in
 * the same shape a single statement has, so the P&L page, its reconciliation and the PDF/Excel all work
 * on it unchanged. Each transaction keeps the id of the statement it came from (`_analysisId`) so a
 * category change can be saved back to that statement. */
export const mergeStatements = (filtered: FilteredStatement[], period: { en: string; es: string }) => {
  const sorted = [...filtered].sort((a, b) => a.range.from.getTime() - b.range.from.getTime());
  const tagged = sorted.map((f) => {
    const src = srcOf(f.data);
    for (const list of LISTS) {
      for (const item of Array.isArray(src?.[list]) ? src[list] : []) {
        if (item && typeof item === "object") item._analysisId = f.row.id;
      }
    }
    return { f, src };
  });

  if (tagged.length === 1) {
    const { f, src } = tagged[0];
    // Only part of the statement is shown: its printed totals and balances no longer apply, the period does.
    if (f.partial) {
      src.period_en = period.en;
      src.period_es = period.es;
      src.balancesPartial = true;
    }
    return f.data;
  }

  const first = tagged[0];
  const last = tagged[tagged.length - 1];
  const merged: any = {
    company: first.src?.company || "",
    period: period.en,
    period_en: period.en,
    period_es: period.es,
    industry: first.src?.industry || "",
    insights_en: [],
    insights_es: [],
    alerts_en: tagged.flatMap(({ src }) => (Array.isArray(src?.alerts_en) ? src.alerts_en : [])),
    alerts_es: tagged.flatMap(({ src }) => (Array.isArray(src?.alerts_es) ? src.alerts_es : [])),
    thirdPartyPayments: tagged.flatMap(({ src }) => (Array.isArray(src?.thirdPartyPayments) ? src.thirdPartyPayments : [])),
    annualSummary: tagged.flatMap(({ src }) => (Array.isArray(src?.annualSummary) ? src.annualSummary : [])),
  };
  for (const list of LISTS) merged[list] = tagged.flatMap(({ src }) => (Array.isArray(src?.[list]) ? src[list] : []));

  // The bank's own totals still add up across whole statements: deposits and each withdrawal type are
  // summed, the opening balance is the first statement's and the closing one the last's. When a
  // statement is cut by the dates or has no summary box, there is nothing to reconcile against.
  const whole = tagged.every(({ f, src }) => !f.partial && src?.bankSummary?.found);
  if (whole) {
    const bank: any = {
      found: true,
      beginningBalance: printed(first.src.bankSummary.beginningBalance) ?? -1,
      endingBalance: printed(last.src.bankSummary.endingBalance) ?? -1,
    };
    for (const bucket of BUCKETS) {
      const parts = tagged.map(({ src }) => src.bankSummary?.[bucket]);
      const amounts = parts.map((p) => (typeof p?.amount === "number" && p.amount >= 0 ? p.amount : null));
      const counts = parts.map((p) => (typeof p?.instances === "number" && p.instances >= 0 ? p.instances : null));
      bank[bucket] = {
        amount: amounts.every((a) => a !== null) ? Math.round((amounts as number[]).reduce((s, a) => s + a, 0) * 100) / 100 : -1,
        instances: counts.every((c) => c !== null) ? (counts as number[]).reduce((s, c) => s + c, 0) : -1,
      };
    }
    merged.bankSummary = bank;
  }

  const firstInfo = first.src?.accountInfo ?? {};
  merged.accountInfo = {
    bankName: firstInfo.bankName || "",
    accountHolder: firstInfo.accountHolder || first.src?.company || "",
    accountNumberLast4: firstInfo.accountNumberLast4 || "",
    // A statement cut by the dates has no printed balance for the day the dates start or end.
    beginningBalance: first.f.partial ? -999999999 : balanceOf(first.f.data, "beginningBalance") ?? -999999999,
    endingBalance: last.f.partial ? -999999999 : balanceOf(last.f.data, "endingBalance") ?? -999999999,
    // The balances above are the first statement's opening and the last one's closing, so their dates
    // come from those statements' own periods.
    periodStart: isoDay(first.f.range.from),
    periodEnd: isoDay(last.f.range.to),
  };
  merged.balancesPartial = first.f.partial || last.f.partial;
  return merged;
};

/** The picker value that describes a statement's dates: its month when it covers exactly one calendar
 * month, otherwise its exact range. */
export const selectionForRange = (range: { from: Date; to: Date }): PeriodSelection => {
  const { from, to } = range;
  const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  if (from.getDate() === 1 && to.getFullYear() === from.getFullYear() && to.getMonth() === from.getMonth() && to.getDate() === lastDay) {
    return { kind: "month", year: from.getFullYear(), month: from.getMonth() };
  }
  return { kind: "custom", from: new Date(from.getFullYear(), from.getMonth(), from.getDate()), to: new Date(to.getFullYear(), to.getMonth(), to.getDate()) };
};

/** Picker values travel in the page's history state, which can't hold Date objects reliably. */
export const serializeSelection = (sel: PeriodSelection) =>
  sel.kind === "custom" ? { kind: "custom", from: isoDay(sel.from), to: isoDay(sel.to) } : sel;

export const deserializeSelection = (value: any): PeriodSelection | null => {
  if (!value || typeof value !== "object") return null;
  if (value.kind === "all") return { kind: "all" };
  if (value.kind === "year" && Number.isFinite(value.year)) return { kind: "year", year: value.year };
  if (value.kind === "month" && Number.isFinite(value.year) && Number.isFinite(value.month)) return { kind: "month", year: value.year, month: value.month };
  if (value.kind === "custom") {
    const parse = (s: unknown) => {
      const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    };
    const from = parse(value.from);
    const to = parse(value.to);
    if (from && to) return { kind: "custom", from, to };
  }
  return null;
};

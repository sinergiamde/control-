import { normalizeAnalysisTransactions, type TransactionList } from "./reportTypes";

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : 0;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

const sumList = (arr: unknown) =>
  (Array.isArray(arr) ? arr : []).reduce((sum: number, it: any) => sum + toNumber(it?.amt ?? it?.amount), 0);

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
export const moveTransaction = (fullAnalysis: any, ref: TxnRef, targetList: TransactionList, targetCategory: string) => {
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
  if (!Array.isArray(source[targetList])) source[targetList] = [];
  source[targetList].push(moved);

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

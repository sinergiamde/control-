import { statementRange } from "./statementPeriod";

/** The dates the two balances refer to: the beginning balance is the one the account had at the end
 * of the day BEFORE the statement starts (for a January statement, December 31), and the ending
 * balance is the one on the statement's last day (January 31). Read from the period the statement
 * prints (accountInfo.periodStart/periodEnd on new analyses, else the analyzer's `period`); null when
 * the statement's dates can't be told. */
export const balanceDates = (fullAnalysis: any): { beginning: Date | null; ending: Date | null } => {
  const src = fullAnalysis?.analysis ?? fullAnalysis;
  const iso = (v: unknown) => {
    const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  let from = iso(src?.accountInfo?.periodStart);
  let to = iso(src?.accountInfo?.periodEnd);
  if (!from || !to) {
    // No upload date to fall back on: an unparseable period gives Invalid Dates, which mean "unknown".
    const range = statementRange({
      id: "", user_id: "", client_id: null, period: String(src?.period || ""), original_filename: "", created_at: "",
      full_analysis: fullAnalysis,
    });
    if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime())) return { beginning: null, ending: null };
    from = range.from;
    to = range.to;
  }
  return {
    beginning: new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1),
    ending: new Date(to.getFullYear(), to.getMonth(), to.getDate()),
  };
};

export const longDate = (d: Date, isEnglish: boolean) =>
  d.toLocaleDateString(isEnglish ? "en-US" : "es-ES", { day: "numeric", month: "long", year: "numeric" });

/** "Saldo Inicial al 31 de diciembre de 2024" / "Beginning Balance as of December 31, 2024". */
export const balanceLabel = (base: string, date: Date | null, isEnglish: boolean) =>
  date ? `${base} ${isEnglish ? "as of" : "al"} ${longDate(date, isEnglish)}` : base;

import { BankSummary, ReconciliationField, ReconciliationResult, sentinelToNull } from "./reportTypes";

const TOLERANCE = 1;

const sumAmt = (items: any[] = []) =>
  (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const v = Number(item?.amt ?? item?.amount);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);

const normalizeBankField = (f: any) => ({
  instances: sentinelToNull(f?.instances),
  amount: sentinelToNull(f?.amount),
});

export const normalizeBankSummary = (raw: any): BankSummary => ({
  found: !!raw?.found,
  beginningBalance: sentinelToNull(raw?.beginningBalance),
  endingBalance: sentinelToNull(raw?.endingBalance),
  deposits: normalizeBankField(raw?.deposits),
  checksPaid: normalizeBankField(raw?.checksPaid),
  atmDebitWithdrawals: normalizeBankField(raw?.atmDebitWithdrawals),
  electronicWithdrawals: normalizeBankField(raw?.electronicWithdrawals),
  otherWithdrawals: normalizeBankField(raw?.otherWithdrawals),
});

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Sum of the bank's own printed withdrawal buckets — null unless every bucket was printed. */
export const totalBankWithdrawals = (bank: BankSummary): number | null => {
  const parts = [bank.checksPaid, bank.atmDebitWithdrawals, bank.electronicWithdrawals, bank.otherWithdrawals];
  if (!parts.every((p) => p.amount !== null)) return null;
  return parts.reduce((sum, p) => sum + (p.amount as number), 0);
};

const buildField = (label: string, bankAmount: number | null, computedAmount: number): ReconciliationField => {
  if (bankAmount === null) {
    return { label, bankAmount: null, computedAmount, delta: null, ok: true };
  }
  const delta = computedAmount - bankAmount;
  return { label, bankAmount, computedAmount, delta, ok: Math.abs(delta) <= TOLERANCE };
};

/**
 * Cross-checks the AI's classified transactions against the bank's own printed summary box
 * (e.g. Chase "Checking Summary"). This — not the LLM's own judgment — is what guarantees a
 * transaction can't silently disappear from the report: if a check or transfer got missed,
 * the classified total won't match what the bank itself says it paid out.
 */
export function reconcileStatement(source: any): ReconciliationResult {
  const bank = normalizeBankSummary(source?.bankSummary);

  if (!bank.found) {
    return { bankSummaryFound: false, ok: true, fields: [], discrepancies: [] };
  }

  const revenues = Array.isArray(source?.revenues) ? source.revenues : [];
  const cogs = Array.isArray(source?.cogs) ? source.cogs : [];
  const opex = Array.isArray(source?.opex) ? source.opex : [];
  const fees = Array.isArray(source?.fees) ? source.fees : [];
  const personal = Array.isArray(source?.personal) ? source.personal : [];
  const thirdParty = Array.isArray(source?.thirdPartyPayments) ? source.thirdPartyPayments : [];

  const computedDeposits = sumAmt(revenues);
  const computedOutflows = sumAmt(cogs) + sumAmt(opex) + sumAmt(fees) + sumAmt(personal);
  const computedChecks = thirdParty
    .filter((p: any) => String(p?.method) === "Check")
    .reduce((sum: number, p: any) => sum + (Number(p?.amt) || 0), 0);

  const bankWithdrawalParts = [bank.checksPaid, bank.atmDebitWithdrawals, bank.electronicWithdrawals, bank.otherWithdrawals];
  const bankWithdrawalsKnown = bankWithdrawalParts.every((p) => p.amount !== null);
  const bankWithdrawalsTotal = bankWithdrawalsKnown
    ? bankWithdrawalParts.reduce((sum, p) => sum + (p.amount as number), 0)
    : null;

  const fields: ReconciliationField[] = [
    buildField("Depósitos (Ingresos)", bank.deposits.amount, computedDeposits),
    buildField("Retiros totales (COGS + OpEx + Personal)", bankWithdrawalsTotal, computedOutflows),
    buildField("Cheques Emitidos", bank.checksPaid.amount, computedChecks),
  ];

  if (bank.beginningBalance !== null && bank.endingBalance !== null && bankWithdrawalsTotal !== null && bank.deposits.amount !== null) {
    const expectedEnding = bank.beginningBalance + bank.deposits.amount - bankWithdrawalsTotal;
    fields.push(buildField("Saldo final (consistencia del resumen del banco)", bank.endingBalance, expectedEnding));
  }

  const discrepancies = fields
    .filter((f) => !f.ok)
    .map((f) => {
      const delta = f.delta ?? 0;
      const sign = delta > 0 ? "de más" : "de menos";
      return `⚠ ${f.label}: el banco reporta ${fmt(f.bankAmount ?? 0)} pero se clasificaron ${fmt(f.computedAmount)} (diferencia ${fmt(Math.abs(delta))} ${sign}) — revisar transacciones no capturadas o mal clasificadas.`;
    });

  return {
    bankSummaryFound: true,
    ok: discrepancies.length === 0,
    fields,
    discrepancies,
  };
}

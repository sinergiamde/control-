import { reconcileStatement } from "./reconciliation";
import { FOOD_OPEX_CATEGORY, PERSONAL_TRANSFER_CATEGORY, PERSONAL_THIRD_PARTY_CATEGORIES, type LineItem, type ThirdPartyPayment } from "./reportTypes";
import { STR, tr, translateCategory } from "./i18n";

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  }
  return 0;
};

const getAnalysisSource = (data: any) => data?.analysis ?? data;

const addToCategoryMap = (map: Record<string, number>, items: any[] = [], isEnglish: boolean) => {
  for (const item of items) {
    const rawName = String(item?.category || item?.desc || item?.name || "Other").trim() || "Other";
    const name = item?.category ? translateCategory(rawName, isEnglish) : rawName;
    map[name] = (map[name] || 0) + toNumber(item?.amt ?? item?.amount);
  }
};

const mapToLineItems = (map: Record<string, number>, revenueBase: number) =>
  Object.entries(map)
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: revenueBase > 0 ? (amount / revenueBase) * 100 : 0,
    }));

export const buildConsolidatedReport = (allData: any[], companyName: string, isEnglish: boolean) => {
  const revenueMap: Record<string, number> = {};
  const cogsMap: Record<string, number> = {};
  const opexMap: Record<string, number> = {};
  const foodMap: Record<string, number> = {};
  const personalMap: Record<string, number> = {};
  let movedPersonalTotal = 0;
  const alerts: string[] = [];
  const periods: string[] = [];
  const thirdPartyPayments: ThirdPartyPayment[] = [];
  const rawPersonalTransfers: { name: string; amount: number; detail?: string; category?: string }[] = [];

  let statementsChecked = 0;
  let statementsOk = 0;
  const problemPeriods: string[] = [];

  for (const data of allData) {
    const src = getAnalysisSource(data);
    const period = src?.period ? String(src.period) : "";

    addToCategoryMap(revenueMap, src?.revenues, isEnglish);
    addToCategoryMap(cogsMap, src?.cogs, isEnglish);

    const rawOpex = Array.isArray(src?.opex) ? src.opex : [];
    const foodItems = rawOpex.filter((item: any) => item?.category === FOOD_OPEX_CATEGORY);
    const opexWithoutFood = rawOpex.filter((item: any) => item?.category !== FOOD_OPEX_CATEGORY);
    addToCategoryMap(opexMap, [...opexWithoutFood, ...(src?.fees || [])], isEnglish);
    addToCategoryMap(foodMap, foodItems, isEnglish);

    // Checks/Zelle/transfers get their own itemized breakdown in the Third Party Payments sheet —
    // exclude them here so the same transaction isn't listed twice in GASTOS PERSONALES. totalPersonal
    // stays correct: the moved amount is rolled back in as a single reference line below.
    const allPersonal = Array.isArray(src?.personal) ? src.personal : [];
    const isThirdPartyCategory = (item: any) => (PERSONAL_THIRD_PARTY_CATEGORIES as readonly string[]).includes(item?.category);
    addToCategoryMap(personalMap, allPersonal.filter((item: any) => !isThirdPartyCategory(item)), isEnglish);
    movedPersonalTotal += allPersonal
      .filter(isThirdPartyCategory)
      .reduce((sum: number, item: any) => sum + toNumber(item?.amt ?? item?.amount), 0);

    if (Array.isArray(src?.alerts)) alerts.push(...src.alerts);
    if (period) periods.push(period);

    if (Array.isArray(src?.thirdPartyPayments)) {
      for (const p of src.thirdPartyPayments) {
        thirdPartyPayments.push({
          method: String(p?.method || ""),
          direction: p?.direction === "incoming" ? "incoming" : "outgoing",
          identifier: String(p?.identifier || ""),
          payee: p?.payee ? String(p.payee) : "",
          date: p?.date ? String(p.date) : "",
          amt: toNumber(p?.amt ?? p?.amount),
          category: p?.category ? translateCategory(String(p.category), isEnglish) : "",
          classification: p?.classification ? String(p.classification) : "",
          alert: p?.alert ? String(p.alert) : "",
        });
      }
    }

    (Array.isArray(src?.personal) ? src.personal : [])
      .filter((item: any) => item?.category === PERSONAL_TRANSFER_CATEGORY)
      .forEach((item: any) => {
        const amount = toNumber(item?.amt ?? item?.amount);
        const detailParts = [period, item?.date, item?.detail].filter(Boolean);
        rawPersonalTransfers.push({
          name: item?.desc || item?.name || "Unknown",
          amount,
          detail: detailParts.length > 0 ? detailParts.join(" • ") : undefined,
          category: item?.category ? translateCategory(String(item.category), isEnglish) : undefined,
        });
      });

    const recon = reconcileStatement(src, isEnglish);
    if (recon.bankSummaryFound) {
      statementsChecked++;
      if (recon.ok) statementsOk++;
      else problemPeriods.push(period || (isEnglish ? "(no period)" : "(sin período)"));
    }
  }

  if (statementsChecked > 0 && statementsOk < statementsChecked) {
    alerts.unshift(
      isEnglish
        ? `⚠ ${statementsChecked - statementsOk} of ${statementsChecked} statement(s) do not reconcile against the bank's own printed summary: ${problemPeriods.join(", ")}. Review those periods individually.`
        : `⚠ ${statementsChecked - statementsOk} de ${statementsChecked} extracto(s) no concilian contra el resumen impreso por el banco: ${problemPeriods.join(", ")}. Revisa esos períodos individualmente.`
    );
  }

  const totalRevenue = Object.values(revenueMap).reduce((s, v) => s + v, 0);
  const totalCOGS = Object.values(cogsMap).reduce((s, v) => s + v, 0);
  const totalOpex = Object.values(opexMap).reduce((s, v) => s + v, 0);
  const totalFood = Object.values(foodMap).reduce((s, v) => s + v, 0);
  const totalPersonal = Object.values(personalMap).reduce((s, v) => s + v, 0) + movedPersonalTotal;
  const grossProfit = totalRevenue - totalCOGS;
  const ebitda = grossProfit - totalOpex - totalFood;
  const netIncome = ebitda - totalPersonal;

  const pct = (n: number) => `${(totalRevenue > 0 ? (n / totalRevenue) * 100 : 0).toFixed(1)}%`;

  const personalTransfers: LineItem[] = rawPersonalTransfers.map((item) => ({
    name: item.name,
    amount: item.amount,
    percentage: totalRevenue > 0 ? (item.amount / totalRevenue) * 100 : 0,
    detail: item.detail,
    category: item.category,
  }));

  const personalItems = mapToLineItems(personalMap, totalRevenue);
  if (movedPersonalTotal > 0) {
    personalItems.push({
      name: tr(STR.movedPersonalName, isEnglish),
      amount: movedPersonalTotal,
      percentage: totalRevenue > 0 ? (movedPersonalTotal / totalRevenue) * 100 : 0,
    });
  }

  return {
    companyName,
    period: periods.length ? `${periods[periods.length - 1]} – ${periods[0]} (${periods.length} ${isEnglish ? "statements" : "extractos"})` : "",
    totalRevenue,
    totalCOGS,
    grossProfit,
    totalOpex,
    totalFood,
    ebitda,
    totalPersonal,
    netIncome,
    sections: [
      { title: tr(STR.revenue, isEnglish), kind: "revenue" as const, items: mapToLineItems(revenueMap, totalRevenue), total: totalRevenue, totalLabel: tr(STR.totalRevenue, isEnglish) },
      { title: "COGS", kind: "cogs" as const, items: mapToLineItems(cogsMap, totalRevenue), total: totalCOGS, totalLabel: tr(STR.totalCOGS, isEnglish) },
      { title: tr(STR.operatingExpenses, isEnglish), kind: "opex" as const, items: mapToLineItems(opexMap, totalRevenue), total: totalOpex, totalLabel: tr(STR.totalOpex, isEnglish) },
      { title: tr(STR.foodFull, isEnglish), kind: "food" as const, items: mapToLineItems(foodMap, totalRevenue), total: totalFood, totalLabel: tr(STR.totalFood, isEnglish) },
      { title: tr(STR.otherExpensesDeductions, isEnglish), kind: "personal" as const, items: personalItems, total: totalPersonal, totalLabel: tr(STR.totalPersonal, isEnglish) },
    ].filter((section) => section.items.length > 0 || section.total !== 0),
    kpis: [
      { label: tr(STR.grossMargin, isEnglish), value: pct(grossProfit), description: "" },
      { label: tr(STR.ebitdaMargin, isEnglish), value: pct(ebitda), description: "" },
      { label: tr(STR.netMargin, isEnglish), value: pct(netIncome), description: "" },
    ],
    redFlags: alerts,
    thirdPartyPayments,
    thirdPartyBuckets: {
      checks: thirdPartyPayments.filter((p) => p.method === "Check"),
      zelleOutgoing: thirdPartyPayments.filter((p) => p.method === "Zelle" && p.direction === "outgoing"),
      zelleIncoming: thirdPartyPayments.filter((p) => p.method === "Zelle" && p.direction === "incoming"),
      personalTransfers,
    },
  };
};

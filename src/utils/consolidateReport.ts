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

const addToCategoryMap = (map: Record<string, number>, items: any[] = []) => {
  for (const item of items) {
    const name = String(item?.category || item?.desc || item?.name || "Other").trim() || "Other";
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
  const personalMap: Record<string, number> = {};
  const alerts: string[] = [];
  const periods: string[] = [];

  for (const data of allData) {
    const src = getAnalysisSource(data);
    addToCategoryMap(revenueMap, src?.revenues);
    addToCategoryMap(cogsMap, src?.cogs);
    addToCategoryMap(opexMap, [...(src?.opex || []), ...(src?.fees || [])]);
    addToCategoryMap(personalMap, src?.personal);
    if (Array.isArray(src?.alerts)) alerts.push(...src.alerts);
    if (src?.period) periods.push(String(src.period));
  }

  const totalRevenue = Object.values(revenueMap).reduce((s, v) => s + v, 0);
  const totalCOGS = Object.values(cogsMap).reduce((s, v) => s + v, 0);
  const totalOpex = Object.values(opexMap).reduce((s, v) => s + v, 0);
  const totalPersonal = Object.values(personalMap).reduce((s, v) => s + v, 0);
  const grossProfit = totalRevenue - totalCOGS;
  const ebitda = grossProfit - totalOpex;
  const netIncome = ebitda - totalPersonal;

  const pct = (n: number) => `${(totalRevenue > 0 ? (n / totalRevenue) * 100 : 0).toFixed(1)}%`;

  return {
    companyName,
    period: periods.length ? `${periods[periods.length - 1]} – ${periods[0]} (${periods.length} ${isEnglish ? "statements" : "extractos"})` : "",
    totalRevenue,
    totalCOGS,
    grossProfit,
    totalOpex,
    ebitda,
    totalPersonal,
    netIncome,
    sections: [
      { title: isEnglish ? "Revenue" : "Ingresos", items: mapToLineItems(revenueMap, totalRevenue), total: totalRevenue, totalLabel: isEnglish ? "Total Revenue" : "Total Ingresos" },
      { title: "COGS", items: mapToLineItems(cogsMap, totalRevenue), total: totalCOGS, totalLabel: "Total COGS" },
      { title: isEnglish ? "Operating Expenses" : "Gastos Operativos (OpEx)", items: mapToLineItems(opexMap, totalRevenue), total: totalOpex, totalLabel: "Total OpEx" },
      { title: isEnglish ? "Personal (Non-Deductible)" : "Personal (No Deducible)", items: mapToLineItems(personalMap, totalRevenue), total: totalPersonal, totalLabel: isEnglish ? "Total Personal" : "Total Personal" },
    ],
    kpis: [
      { label: isEnglish ? "Gross Margin" : "Margen Bruto", value: pct(grossProfit), description: "" },
      { label: "EBITDA Margin", value: pct(ebitda), description: "" },
      { label: isEnglish ? "Net Margin" : "Margen Neto", value: pct(netIncome), description: "" },
    ],
    redFlags: alerts,
  };
};

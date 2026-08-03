import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { totalBankWithdrawals } from "./reconciliation";
import type { LineItem, ResultsData, Section, SectionKind, ThirdPartyPayment } from "./reportTypes";

const COLORS = {
  headerBg: "0D1B2A",
  headerFont: "FFFFFF",
  sectionRevenue: "145A32",
  sectionCOGS: "1B4F72",
  sectionOpex: "D35400",
  sectionFood: "7D6608",
  sectionPersonal: "922B21",
  sectionThirdParty: "6C3483",
  subSectionBg: "5D6D7E",
  totalRevenueBg: "D5F5E3",
  totalCOGSBg: "D6E4F0",
  totalOpexBg: "FDEBD0",
  totalFoodBg: "FCF3CF",
  totalPersonalBg: "FADBD8",
  totalThirdPartyBg: "E8DAEF",
  grossProfitBg: "D5F5E3",
  ebitdaBg: "D5F5E3",
  netIncomeBg: "D5F5E3",
  altRow1: "FFFFFF",
  altRow2: "F2F2F2",
  detailFont: "555555",
  kpiBg: "EBF5FB",
  redFlagBg: "FDEDEC",
  reconOkBg: "D5F5E3",
  reconBadBg: "FADBD8",
};

const SECTION_COLOR_BY_KIND: Record<SectionKind, { bg: string; totalBg: string }> = {
  revenue: { bg: COLORS.sectionRevenue, totalBg: COLORS.totalRevenueBg },
  cogs: { bg: COLORS.sectionCOGS, totalBg: COLORS.totalCOGSBg },
  opex: { bg: COLORS.sectionOpex, totalBg: COLORS.totalOpexBg },
  food: { bg: COLORS.sectionFood, totalBg: COLORS.totalFoodBg },
  personal: { bg: COLORS.sectionPersonal, totalBg: COLORS.totalPersonalBg },
  thirdParty: { bg: COLORS.sectionThirdParty, totalBg: COLORS.totalThirdPartyBg },
};

const thin: ExcelJS.Border = { style: "thin", color: { argb: "DDDDDD" } };
const borders = { top: thin, bottom: thin, left: thin, right: thin };

function styleRow(
  ws: ExcelJS.Worksheet,
  row: number,
  bgColor: string,
  fontColor: string,
  bold: boolean,
  fontSize = 10,
  cols = 5
) {
  for (let col = 1; col <= cols; col++) {
    const cell = ws.getCell(row, col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cell.font = { name: "Arial", size: fontSize, bold, color: { argb: fontColor } };
    cell.border = borders;
    cell.alignment = { vertical: "middle", wrapText: true };
  }
}

function writeTitleBar(ws: ExcelJS.Worksheet, r: number, text: string, cols: number) {
  ws.mergeCells(r, 1, r, cols);
  ws.getCell(r, 1).value = text;
  styleRow(ws, r, COLORS.headerBg, COLORS.headerFont, true, 14, cols);
  ws.getRow(r).height = 30;
}

function writeSubtitleBar(ws: ExcelJS.Worksheet, r: number, text: string, cols: number) {
  ws.mergeCells(r, 1, r, cols);
  ws.getCell(r, 1).value = text;
  styleRow(ws, r, "2E75B6", COLORS.headerFont, false, 9, cols);
  ws.getRow(r).height = 20;
}

/** Writes the standard 5-column (Descripción | Categoría | Fecha/Detalle | Monto | % Ingresos) line-item
 * table used by Ingresos/COGS/OpEx/Personal/Transferencias Personales. Returns the next free row. */
function writeLineItemsTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  items: LineItem[],
  totalLabel: string,
  totalBg: string,
  totalRevenue: number
): { nextRow: number; subtotalRow: number } {
  let r = startRow;

  ws.getCell(r, 1).value = "Descripción";
  ws.getCell(r, 2).value = "Categoría";
  ws.getCell(r, 3).value = "Fecha / Detalle";
  ws.getCell(r, 4).value = "Monto";
  ws.getCell(r, 5).value = "% Ingresos";
  styleRow(ws, r, "34495E", COLORS.headerFont, true, 10);
  r++;

  const itemStartRow = r;
  items.forEach((item, ii) => {
    const bgColor = ii % 2 === 0 ? COLORS.altRow2 : COLORS.altRow1;
    ws.getCell(r, 1).value = item.name;
    ws.getCell(r, 2).value = item.category || "";
    ws.getCell(r, 3).value = item.detail || "";
    ws.getCell(r, 4).value = item.amount;
    ws.getCell(r, 4).numFmt = "#,##0.00";
    ws.getCell(r, 5).value = totalRevenue > 0 ? item.percentage / 100 : 0;
    ws.getCell(r, 5).numFmt = "0.0%";
    styleRow(ws, r, bgColor, "000000", false, 10);
    ws.getCell(r, 3).font = { name: "Arial", size: 9, color: { argb: COLORS.detailFont } };
    r++;
  });

  const subtotalRow = r;
  ws.getCell(r, 1).value = totalLabel;
  const sum = items.reduce((s, i) => s + i.amount, 0);
  ws.getCell(r, 4).value = items.length > 0 ? ({ formula: `SUM(D${itemStartRow}:D${r - 1})`, result: sum } as any) : sum;
  ws.getCell(r, 4).numFmt = "#,##0.00";
  ws.getCell(r, 5).value = totalRevenue > 0 ? sum / totalRevenue : 0;
  ws.getCell(r, 5).numFmt = "0.0%";
  styleRow(ws, r, totalBg, "000000", true, 10);
  ws.getRow(r).height = 22;
  r += 2;

  return { nextRow: r, subtotalRow };
}

function addLineItemSheet(wb: ExcelJS.Workbook, sheetName: string, title: string, subtitle: string, section: Section | undefined, totalRevenue: number) {
  const ws = wb.addWorksheet(sheetName, { properties: { defaultColWidth: 20 } });
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 30;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 12;

  let r = 1;
  writeTitleBar(ws, r, title, 5);
  r++;
  writeSubtitleBar(ws, r, subtitle, 5);
  r += 2;

  const colors = section?.kind ? SECTION_COLOR_BY_KIND[section.kind] : SECTION_COLOR_BY_KIND.opex;
  writeLineItemsTable(ws, r, section?.items || [], section?.totalLabel || "Total", colors.totalBg, totalRevenue);
}

function addOpexSheet(wb: ExcelJS.Workbook, data: ResultsData) {
  const ws = wb.addWorksheet("OPEX", { properties: { defaultColWidth: 20 } });
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 30;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 12;

  let r = 1;
  writeTitleBar(ws, r, "GASTOS OPERATIVOS (OPEX)", 5);
  r++;
  writeSubtitleBar(ws, r, `${data.period || ""} | Incluye subcategoría de Alimentación (comidas de trabajo)`, 5);
  r += 2;

  const opexSection = data.sections.find((s) => s.kind === "opex");
  const foodSection = data.sections.find((s) => s.kind === "food");

  const opexResult = writeLineItemsTable(
    ws, r, opexSection?.items || [], opexSection?.totalLabel || "Total OpEx",
    SECTION_COLOR_BY_KIND.opex.totalBg, data.totalRevenue
  );
  r = opexResult.nextRow;

  if (foodSection && foodSection.items.length > 0) {
    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value = "  ALIMENTACIÓN (Comidas de trabajo — fast food/café/snacks)";
    styleRow(ws, r, COLORS.sectionFood, COLORS.headerFont, true, 11, 5);
    ws.getRow(r).height = 24;
    r++;

    const foodResult = writeLineItemsTable(
      ws, r, foodSection.items, foodSection.totalLabel || "Total Alimentación",
      SECTION_COLOR_BY_KIND.food.totalBg, data.totalRevenue
    );
    r = foodResult.nextRow;
  }

  ws.getCell(r, 1).value = "TOTAL OPEX (incluye Alimentación)";
  ws.getCell(r, 4).value = data.totalOpex + (data.totalFood || 0);
  ws.getCell(r, 4).numFmt = "#,##0.00";
  ws.getCell(r, 5).value = data.totalRevenue > 0 ? (data.totalOpex + (data.totalFood || 0)) / data.totalRevenue : 0;
  ws.getCell(r, 5).numFmt = "0.0%";
  styleRow(ws, r, COLORS.totalOpexBg, "000000", true, 11);
  ws.getRow(r).height = 24;
}

function addThirdPartySheet(wb: ExcelJS.Workbook, data: ResultsData) {
  const ws = wb.addWorksheet("THIRD PARTY PAYMENTS", { properties: { defaultColWidth: 18 } });
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 22;
  ws.getColumn(6).width = 26;

  let r = 1;
  writeTitleBar(ws, r, "THIRD PARTY PAYMENTS (for 1099 determination)", 6);
  r++;
  writeSubtitleBar(ws, r, `${data.period || ""} | Checks, Zelle and personal transfers — itemized one by one`, 6);
  r += 2;

  const buckets = data.thirdPartyBuckets;

  // --- Checks Issued ---
  ws.mergeCells(r, 1, r, 6);
  ws.getCell(r, 1).value = "  CHECKS ISSUED";
  styleRow(ws, r, COLORS.sectionCOGS, COLORS.headerFont, true, 11, 6);
  ws.getRow(r).height = 24;
  r++;

  ws.getCell(r, 1).value = "Check #";
  ws.getCell(r, 2).value = "Payee";
  ws.getCell(r, 3).value = "Date";
  ws.getCell(r, 4).value = "Amount";
  ws.getCell(r, 5).value = "Category";
  ws.getCell(r, 6).value = "Classification";
  styleRow(ws, r, "34495E", COLORS.headerFont, true, 10, 6);
  r++;

  const checks = buckets?.checks || [];
  const checksStartRow = r;
  checks.forEach((p, i) => {
    const bg = i % 2 === 0 ? COLORS.altRow2 : COLORS.altRow1;
    ws.getCell(r, 1).value = p.identifier;
    ws.getCell(r, 2).value = p.payee || "Verify (no payee shown on statement)";
    ws.getCell(r, 3).value = p.date || "";
    ws.getCell(r, 4).value = p.amt;
    ws.getCell(r, 4).numFmt = "#,##0.00";
    ws.getCell(r, 5).value = p.category || "";
    ws.getCell(r, 6).value = p.classification || "";
    styleRow(ws, r, bg, "000000", false, 10, 6);
    r++;
  });
  const checksTotal = checks.reduce((sum, p) => sum + p.amt, 0);
  ws.getCell(r, 1).value = "TOTAL CHECKS ISSUED";
  ws.getCell(r, 4).value = checks.length > 0 ? ({ formula: `SUM(D${checksStartRow}:D${r - 1})`, result: checksTotal } as any) : 0;
  ws.getCell(r, 4).numFmt = "#,##0.00";
  styleRow(ws, r, COLORS.totalCOGSBg, "000000", true, 10, 6);
  r++;

  const checksField = data.reconciliation?.fields.find((f) => f.label === "Cheques Emitidos");
  if (checksField && checksField.bankAmount !== null) {
    ws.getCell(r, 1).value = "Per bank statement summary (Checks Paid)";
    ws.getCell(r, 4).value = checksField.bankAmount;
    ws.getCell(r, 4).numFmt = "#,##0.00";
    styleRow(ws, r, COLORS.altRow2, "000000", false, 9, 6);
    r++;
    ws.getCell(r, 1).value = "Difference";
    ws.getCell(r, 4).value = checksField.delta ?? 0;
    ws.getCell(r, 4).numFmt = "#,##0.00";
    styleRow(ws, r, checksField.ok ? COLORS.reconOkBg : COLORS.reconBadBg, "000000", true, 9, 6);
    r++;
  }
  r++;

  // --- Zelle Transactions ---
  ws.mergeCells(r, 1, r, 6);
  ws.getCell(r, 1).value = "  ZELLE TRANSACTIONS";
  styleRow(ws, r, COLORS.sectionOpex, COLORS.headerFont, true, 11, 6);
  ws.getRow(r).height = 24;
  r++;

  ws.getCell(r, 1).value = "Direction";
  ws.getCell(r, 2).value = "Payee / Sender";
  ws.getCell(r, 3).value = "Date";
  ws.getCell(r, 4).value = "Amount";
  ws.getCell(r, 5).value = "Category";
  ws.getCell(r, 6).value = "Classification / Alert";
  styleRow(ws, r, "34495E", COLORS.headerFont, true, 10, 6);
  r++;

  const zelle: ThirdPartyPayment[] = [...(buckets?.zelleOutgoing || []), ...(buckets?.zelleIncoming || [])];
  const zelleStartRow = r;
  zelle.forEach((p, i) => {
    const bg = i % 2 === 0 ? COLORS.altRow2 : COLORS.altRow1;
    ws.getCell(r, 1).value = p.direction === "incoming" ? "Incoming (client pays)" : "Outgoing (business pays)";
    ws.getCell(r, 2).value = p.identifier;
    ws.getCell(r, 3).value = p.date || "";
    ws.getCell(r, 4).value = p.amt;
    ws.getCell(r, 4).numFmt = "#,##0.00";
    ws.getCell(r, 5).value = p.category || "";
    ws.getCell(r, 6).value = [p.classification, p.alert].filter(Boolean).join(" — ");
    styleRow(ws, r, bg, "000000", false, 10, 6);
    if (p.alert) ws.getCell(r, 6).font = { name: "Arial", size: 10, bold: true, color: { argb: "922B21" } };
    r++;
  });
  const zelleTotal = zelle.reduce((sum, p) => sum + p.amt, 0);
  ws.getCell(r, 1).value = "TOTAL ZELLE";
  ws.getCell(r, 4).value = zelle.length > 0 ? ({ formula: `SUM(D${zelleStartRow}:D${r - 1})`, result: zelleTotal } as any) : 0;
  ws.getCell(r, 4).numFmt = "#,##0.00";
  styleRow(ws, r, COLORS.totalOpexBg, "000000", true, 10, 6);
  r += 2;

  // --- Personal Transfers ---
  ws.mergeCells(r, 1, r, 6);
  ws.getCell(r, 1).value = "  PERSONAL TRANSFERS";
  styleRow(ws, r, COLORS.sectionPersonal, COLORS.headerFont, true, 11, 6);
  ws.getRow(r).height = 24;
  r++;

  ws.getCell(r, 1).value = "Description";
  ws.getCell(r, 2).value = "";
  ws.getCell(r, 3).value = "Date / Detail";
  ws.getCell(r, 4).value = "Amount";
  ws.getCell(r, 5).value = "Category";
  ws.getCell(r, 6).value = "";
  styleRow(ws, r, "34495E", COLORS.headerFont, true, 10, 6);
  r++;

  const transfers = buckets?.personalTransfers || [];
  const transfersStartRow = r;
  transfers.forEach((item, i) => {
    const bg = i % 2 === 0 ? COLORS.altRow2 : COLORS.altRow1;
    ws.getCell(r, 1).value = item.name;
    ws.getCell(r, 3).value = item.detail || "";
    ws.getCell(r, 4).value = item.amount;
    ws.getCell(r, 4).numFmt = "#,##0.00";
    ws.getCell(r, 5).value = item.category || "";
    styleRow(ws, r, bg, "000000", false, 10, 6);
    r++;
  });
  if (transfers.length === 0) {
    ws.mergeCells(r, 1, r, 6);
    ws.getCell(r, 1).value = "No personal transfers identified in this period.";
    styleRow(ws, r, COLORS.altRow2, COLORS.detailFont, false, 9, 6);
    r++;
  } else {
    const transfersTotal = transfers.reduce((sum, item) => sum + item.amount, 0);
    ws.getCell(r, 1).value = "TOTAL PERSONAL TRANSFERS";
    ws.getCell(r, 4).value = { formula: `SUM(D${transfersStartRow}:D${r - 1})`, result: transfersTotal } as any;
    ws.getCell(r, 4).numFmt = "#,##0.00";
    styleRow(ws, r, COLORS.totalPersonalBg, "000000", true, 10, 6);
  }
}

function addExecutiveSummarySheet(wb: ExcelJS.Workbook, data: ResultsData) {
  const ws = wb.addWorksheet("RESUMEN EJECUTIVO", { properties: { defaultColWidth: 20 } });
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 44;

  let r = 1;
  writeTitleBar(ws, r, `RESUMEN EJECUTIVO — ${data.companyName || "CTRL+"}`, 4);
  r++;
  writeSubtitleBar(ws, r, `${data.period || ""} | Prepared by CTRL+ by TaxForYou`, 4);
  r += 2;

  const bank = data.bankSummary;
  if (bank?.found) {
    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).value = "  ACTIVIDAD DE LA CUENTA (según extracto bancario)";
    styleRow(ws, r, COLORS.headerBg, COLORS.headerFont, true, 11, 4);
    ws.getRow(r).height = 24;
    r++;

    const withdrawals = totalBankWithdrawals(bank);
    const rows: [string, number | null][] = [
      ["Saldo Inicial", bank.beginningBalance],
      ["Saldo Final", bank.endingBalance],
      ["Total Depósitos y Adiciones", bank.deposits.amount],
      ["Total Retiros", withdrawals],
    ];
    rows.forEach(([label, value], i) => {
      if (value === null) return;
      const bg = i % 2 === 0 ? COLORS.altRow2 : COLORS.altRow1;
      ws.getCell(r, 1).value = label;
      ws.getCell(r, 2).value = value;
      ws.getCell(r, 2).numFmt = "#,##0.00";
      styleRow(ws, r, bg, "000000", false, 10, 4);
      r++;
    });

    if (bank.beginningBalance !== null && bank.endingBalance !== null) {
      ws.getCell(r, 1).value = "Resultado del Período (Cambio Neto en Caja)";
      ws.getCell(r, 2).value = bank.endingBalance - bank.beginningBalance;
      ws.getCell(r, 2).numFmt = "#,##0.00";
      styleRow(ws, r, COLORS.totalRevenueBg, "000000", true, 10, 4);
      r++;
    }
    r++;
  }

  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value = "  RESUMEN P&L";
  styleRow(ws, r, COLORS.headerBg, COLORS.headerFont, true, 11, 4);
  ws.getRow(r).height = 24;
  r++;

  const totalFood = data.totalFood || 0;
  const plRows: [string, number, string, boolean][] = [
    ["Total Ingresos", data.totalRevenue, COLORS.altRow2, false],
    ["Total COGS", data.totalCOGS, COLORS.altRow1, false],
    ["Utilidad Bruta (Gross Profit)", data.grossProfit, COLORS.totalRevenueBg, true],
    ["Total OpEx (incl. Alimentación)", data.totalOpex + totalFood, COLORS.altRow2, false],
    ["  de los cuales, Alimentación", totalFood, COLORS.altRow1, false],
    ["EBITDA", data.ebitda, COLORS.ebitdaBg, true],
    ["Total Gastos Personales", data.totalPersonal, COLORS.altRow2, false],
    ["RESULTADO NETO (Net Income)", data.netIncome, COLORS.netIncomeBg, true],
  ];
  plRows.forEach(([label, value, bg, bold]) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 2).value = value;
    ws.getCell(r, 2).numFmt = "#,##0.00";
    ws.getCell(r, 3).value = data.totalRevenue > 0 ? value / data.totalRevenue : 0;
    ws.getCell(r, 3).numFmt = "0.0%";
    styleRow(ws, r, bg, "000000", bold, 10, 4);
    r++;
  });
  r++;

  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value = "  INDICADORES CLAVE (KPIs)";
  styleRow(ws, r, COLORS.headerBg, COLORS.headerFont, true, 11, 4);
  ws.getRow(r).height = 24;
  r++;

  ws.getCell(r, 1).value = "INDICADOR";
  ws.getCell(r, 2).value = "VALOR";
  ws.getCell(r, 3).value = "";
  ws.getCell(r, 4).value = "INTERPRETACIÓN";
  styleRow(ws, r, "34495E", COLORS.headerFont, true, 10, 4);
  r++;

  data.kpis.forEach((kpi, i) => {
    const bg = i % 2 === 0 ? COLORS.kpiBg : COLORS.altRow1;
    ws.getCell(r, 1).value = kpi.label;
    ws.getCell(r, 2).value = kpi.value;
    ws.getCell(r, 4).value = kpi.description;
    styleRow(ws, r, bg, "000000", false, 10, 4);
    ws.getCell(r, 1).font = { name: "Arial", size: 10, bold: true, color: { argb: "000000" } };
    r++;
  });
  r++;

  if (data.reconciliation?.bankSummaryFound) {
    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).value = data.reconciliation.ok
      ? "✓ CONCILIADO — los totales clasificados cuadran contra el resumen del banco."
      : `⚠ ${data.reconciliation.discrepancies.length} DISCREPANCIA(S) contra el resumen del banco — ver hoja ALERTAS Y RECOMENDACIONES.`;
    styleRow(ws, r, data.reconciliation.ok ? COLORS.reconOkBg : COLORS.reconBadBg, "000000", true, 10, 4);
    ws.getRow(r).height = 22;
    r += 2;
  }

  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value =
    "P&L based on bank transactions — does not include pending A/R or A/P. Prepare formal financial statements with a CPA for IRS purposes.";
  styleRow(ws, r, COLORS.altRow2, COLORS.detailFont, false, 8, 4);
  r++;
  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value = "Prepared by CTRL+ by TaxForYou | www.taxforyou.com";
  styleRow(ws, r, COLORS.altRow2, COLORS.detailFont, false, 8, 4);
}

function addFullPLSheet(wb: ExcelJS.Workbook, data: ResultsData) {
  const ws = wb.addWorksheet("P&L COMPLETO", { properties: { defaultColWidth: 20 } });
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 40;

  let r = 1;
  writeTitleBar(ws, r, `PROFIT & LOSS — ${data.companyName || "CTRL+"}`, 5);
  r++;
  writeSubtitleBar(ws, r, `${data.period || ""} | Prepared by CTRL+ by TaxForYou`, 5);
  r += 2;

  ws.getCell(r, 1).value = "CONCEPTO / LÍNEA";
  ws.getCell(r, 2).value = "CATEGORÍA";
  ws.getCell(r, 3).value = "MONTO ($)";
  ws.getCell(r, 4).value = "% REV";
  ws.getCell(r, 5).value = "DETALLE / FUENTE";
  styleRow(ws, r, COLORS.headerBg, COLORS.headerFont, true, 10, 5);
  ws.getRow(r).height = 22;
  r++;

  let revenueTotalRow = 0;

  // Third Party Payments is an informational cross-reference (its amounts are already counted
  // within Revenue/COGS/OpEx/Personal above) — it gets its own dedicated sheet, not a line in the
  // core P&L waterfall, so it's excluded here to avoid double-counting toward EBITDA/Net Income.
  data.sections.filter((section) => section.kind !== "thirdParty").forEach((section) => {
    const colors = section.kind ? SECTION_COLOR_BY_KIND[section.kind] : SECTION_COLOR_BY_KIND.opex;

    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value = `  ${section.title}`;
    styleRow(ws, r, colors.bg, COLORS.headerFont, true, 11, 5);
    ws.getRow(r).height = 24;
    r++;

    const itemStartRow = r;
    section.items.forEach((item, ii) => {
      const bgColor = ii % 2 === 0 ? COLORS.altRow2 : COLORS.altRow1;
      ws.getCell(r, 1).value = item.name;
      ws.getCell(r, 2).value = item.category || "";
      ws.getCell(r, 3).value = item.amount;
      ws.getCell(r, 3).numFmt = "#,##0.00";
      ws.getCell(r, 4).value = item.percentage / 100;
      ws.getCell(r, 4).numFmt = "0.0%";
      ws.getCell(r, 5).value = item.detail || "";
      styleRow(ws, r, bgColor, "000000", false, 10, 5);
      ws.getCell(r, 5).font = { name: "Arial", size: 9, color: { argb: COLORS.detailFont } };
      r++;
    });

    ws.getCell(r, 1).value = section.totalLabel;
    const sumFormula = `SUM(C${itemStartRow}:C${r - 1})`;
    ws.getCell(r, 3).value = { formula: sumFormula, result: section.total } as any;
    ws.getCell(r, 3).numFmt = "#,##0.00";
    const sectionPct = data.totalRevenue > 0 ? section.total / data.totalRevenue : 0;
    if (revenueTotalRow > 0) {
      ws.getCell(r, 4).value = { formula: `C${r}/C${revenueTotalRow}`, result: sectionPct } as any;
    } else {
      ws.getCell(r, 4).value = 1;
    }
    ws.getCell(r, 4).numFmt = "0.0%";
    styleRow(ws, r, colors.totalBg, "000000", true, 10, 5);
    ws.getRow(r).height = 22;

    if (section.kind === "revenue") revenueTotalRow = r;
    r++;

    if (section.kind === "cogs" && revenueTotalRow > 0) {
      ws.getCell(r, 1).value = "UTILIDAD BRUTA (GROSS PROFIT)";
      ws.getCell(r, 3).value = { formula: `C${revenueTotalRow}-C${r - 1}`, result: data.grossProfit } as any;
      ws.getCell(r, 3).numFmt = "#,##0.00";
      ws.getCell(r, 4).value = {
        formula: `C${r}/C${revenueTotalRow}`,
        result: data.totalRevenue > 0 ? data.grossProfit / data.totalRevenue : 0,
      } as any;
      ws.getCell(r, 4).numFmt = "0.0%";
      ws.getCell(r, 5).value = "Revenue − COGS";
      styleRow(ws, r, COLORS.grossProfitBg, "000000", true, 11, 5);
      ws.getRow(r).height = 24;
      r++;
    }

    r++;
  });

  ws.getCell(r, 1).value = "EBITDA (Utilidad Operativa)";
  ws.getCell(r, 3).value = data.ebitda;
  ws.getCell(r, 3).numFmt = "#,##0.00";
  ws.getCell(r, 4).value = data.totalRevenue > 0 ? data.ebitda / data.totalRevenue : 0;
  ws.getCell(r, 4).numFmt = "0.0%";
  ws.getCell(r, 5).value = "Gross Profit − OpEx − Alimentación";
  styleRow(ws, r, COLORS.ebitdaBg, "000000", true, 11, 5);
  ws.getRow(r).height = 24;
  r += 2;

  ws.getCell(r, 1).value = "RESULTADO NETO (NET INCOME)";
  ws.getCell(r, 3).value = data.netIncome;
  ws.getCell(r, 3).numFmt = "#,##0.00";
  ws.getCell(r, 4).value = data.totalRevenue > 0 ? data.netIncome / data.totalRevenue : 0;
  ws.getCell(r, 4).numFmt = "0.0%";
  ws.getCell(r, 5).value = "EBITDA − Gastos personales";
  styleRow(ws, r, COLORS.netIncomeBg, "000000", true, 12, 5);
  ws.getRow(r).height = 28;
  r += 2;

  ws.mergeCells(r, 1, r, 5);
  ws.getCell(r, 1).value =
    "P&L based on bank transactions — does not include pending A/R or A/P. Prepare formal financial statements with a CPA for IRS purposes.";
  styleRow(ws, r, COLORS.altRow2, COLORS.detailFont, false, 8, 5);
  r++;
  ws.mergeCells(r, 1, r, 5);
  ws.getCell(r, 1).value = "Prepared by CTRL+ by TaxForYou | www.taxforyou.com";
  styleRow(ws, r, COLORS.altRow2, COLORS.detailFont, false, 8, 5);
}

function addAlertsSheet(wb: ExcelJS.Workbook, data: ResultsData) {
  const ws = wb.addWorksheet("ALERTAS Y RECOMENDACIONES", { properties: { defaultColWidth: 20 } });
  ws.getColumn(1).width = 120;

  let r = 1;
  writeTitleBar(ws, r, "ALERTAS Y RECOMENDACIONES", 1);
  r++;
  writeSubtitleBar(ws, r, `${data.period || ""} | ${data.companyName || "CTRL+"}`, 1);
  r += 2;

  const flags = data.redFlags || [];
  if (flags.length === 0) {
    ws.getCell(r, 1).value = "✓ Sin alertas — no se detectaron discrepancias ni patrones de riesgo en este período.";
    styleRow(ws, r, COLORS.reconOkBg, "000000", false, 10, 1);
    return;
  }

  flags.forEach((flag) => {
    ws.getCell(r, 1).value = `⚠ ${flag}`;
    styleRow(ws, r, COLORS.redFlagBg, "922B21", false, 10, 1);
    ws.getRow(r).height = Math.max(20, Math.ceil(flag.length / 100) * 16);
    r++;
  });
}

export async function generateProfessionalExcel(data: ResultsData) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CTRL+ by TaxForYou";

  addExecutiveSummarySheet(wb, data);
  addLineItemSheet(wb, "INGRESOS", "INGRESOS", data.period || "", data.sections.find((s) => s.kind === "revenue"), data.totalRevenue);
  addLineItemSheet(wb, "COGS", "COGS (Costo de Ventas)", data.period || "", data.sections.find((s) => s.kind === "cogs"), data.totalRevenue);
  addOpexSheet(wb, data);
  addLineItemSheet(wb, "OTHER EXPENSES", "Other Expenses/Possible Deductions", data.period || "", data.sections.find((s) => s.kind === "personal"), data.totalRevenue);
  addThirdPartySheet(wb, data);
  addFullPLSheet(wb, data);
  addAlertsSheet(wb, data);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `PnL_${data.companyName?.replace(/\s+/g, "_") || "CTRL_Plus"}.xlsx`);
}

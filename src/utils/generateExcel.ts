import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

interface LineItem {
  name: string;
  amount: number;
  percentage: number;
  detail?: string;
}

interface Section {
  title: string;
  items: LineItem[];
  total: number;
  totalLabel: string;
}

interface ThirdPartyPayment {
  method: string;
  identifier: string;
  date?: string;
  amt: number;
  category?: string;
}

interface ResultsData {
  companyName?: string;
  period?: string;
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  totalOpex: number;
  ebitda: number;
  totalPersonal: number;
  netIncome: number;
  sections: Section[];
  kpis: { label: string; value: string; description: string }[];
  redFlags?: string[];
  thirdPartyPayments?: ThirdPartyPayment[];
}

const COLORS = {
  headerBg: "0D1B2A",
  headerFont: "FFFFFF",
  sectionRevenue: "145A32",
  sectionCOGS: "1B4F72",
  sectionOpex: "D35400",
  sectionPersonal: "922B21",
  subSectionBg: "5D6D7E",
  totalRevenueBg: "D5F5E3",
  totalCOGSBg: "D6E4F0",
  totalOpexBg: "FDEBD0",
  totalPersonalBg: "FADBD8",
  grossProfitBg: "D5F5E3",
  ebitdaBg: "D5F5E3",
  netIncomeBg: "D5F5E3",
  altRow1: "FFFFFF",
  altRow2: "F2F2F2",
  detailFont: "555555",
  kpiBg: "EBF5FB",
  redFlagBg: "FDEDEC",
  insightBg: "FEF9E7",
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
  cols = 4
) {
  for (let col = 1; col <= cols; col++) {
    const cell = ws.getCell(row, col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cell.font = { name: "Arial", size: fontSize, bold, color: { argb: fontColor } };
    cell.border = borders;
    cell.alignment = { vertical: "middle", wrapText: true };
  }
}

export async function generateProfessionalExcel(data: ResultsData) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CTRL+ by TaxForYou";
  const ws = wb.addWorksheet("P&L Report", {
    properties: { defaultColWidth: 20 },
  });

  ws.getColumn(1).width = 52;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 44;

  let r = 1;

  ws.mergeCells(r, 1, r, 4);
  const titleCell = ws.getCell(r, 1);
  titleCell.value = `PROFIT & LOSS — ${data.companyName || "CTRL+"}`;
  styleRow(ws, r, COLORS.headerBg, COLORS.headerFont, true, 14);
  ws.getRow(r).height = 30;
  r++;

  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value = `${data.period || ""} | Prepared by CTRL+ by TaxForYou`;
  styleRow(ws, r, "2E75B6", COLORS.headerFont, false, 9);
  ws.getRow(r).height = 20;
  r++;

  r++;

  ws.getCell(r, 1).value = "CONCEPTO / LÍNEA";
  ws.getCell(r, 2).value = "MONTO ($)";
  ws.getCell(r, 3).value = "% REV";
  ws.getCell(r, 4).value = "DETALLE / FUENTE";
  styleRow(ws, r, COLORS.headerBg, COLORS.headerFont, true, 10);
  ws.getRow(r).height = 22;
  r++;

  const sectionColors = [
    { bg: COLORS.sectionRevenue, totalBg: COLORS.totalRevenueBg },
    { bg: COLORS.sectionCOGS, totalBg: COLORS.totalCOGSBg },
    { bg: COLORS.sectionOpex, totalBg: COLORS.totalOpexBg },
    { bg: COLORS.sectionPersonal, totalBg: COLORS.totalPersonalBg },
  ];

  let revenueTotalRow = 0;

  data.sections.forEach((section, si) => {
    const colors = sectionColors[si] || sectionColors[0];

    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).value = `  ${section.title}`;
    styleRow(ws, r, colors.bg, COLORS.headerFont, true, 11);
    ws.getRow(r).height = 24;
    r++;

    const itemStartRow = r;

    section.items.forEach((item, ii) => {
      const bgColor = ii % 2 === 0 ? COLORS.altRow2 : COLORS.altRow1;
      ws.getCell(r, 1).value = item.name;
      ws.getCell(r, 2).value = item.amount;
      ws.getCell(r, 2).numFmt = '#,##0.00';
      ws.getCell(r, 3).value = item.percentage / 100;
      ws.getCell(r, 3).numFmt = '0.0%';
      ws.getCell(r, 4).value = item.detail || "";
      styleRow(ws, r, bgColor, "000000", false, 10);
      ws.getCell(r, 4).font = { name: "Arial", size: 9, color: { argb: COLORS.detailFont } };
      r++;
    });

    ws.getCell(r, 1).value = section.totalLabel;
    const sumFormula = `SUM(B${itemStartRow}:B${r - 1})`;
    ws.getCell(r, 2).value = { formula: sumFormula } as any;
    ws.getCell(r, 2).numFmt = '#,##0.00';
    if (revenueTotalRow > 0) {
      ws.getCell(r, 3).value = { formula: `B${r}/B${revenueTotalRow}` } as any;
    } else {
      ws.getCell(r, 3).value = 1;
    }
    ws.getCell(r, 3).numFmt = '0.0%';
    styleRow(ws, r, colors.totalBg, "000000", true, 10);
    ws.getRow(r).height = 22;

    if (si === 0) revenueTotalRow = r;
    r++;

    if (si === 1 && revenueTotalRow > 0) {
      ws.getCell(r, 1).value = "UTILIDAD BRUTA (GROSS PROFIT)";
      ws.getCell(r, 2).value = { formula: `B${revenueTotalRow}-B${r - 1}` } as any;
      ws.getCell(r, 2).numFmt = '#,##0.00';
      ws.getCell(r, 3).value = { formula: `B${r}/B${revenueTotalRow}` } as any;
      ws.getCell(r, 3).numFmt = '0.0%';
      ws.getCell(r, 4).value = "Revenue − COGS";
      styleRow(ws, r, COLORS.grossProfitBg, "000000", true, 11);
      ws.getRow(r).height = 24;
      r++;
    }

    r++;
  });

  ws.getCell(r, 1).value = "EBITDA (Utilidad Operativa)";
  ws.getCell(r, 2).value = data.ebitda;
  ws.getCell(r, 2).numFmt = '#,##0.00';
  ws.getCell(r, 3).value = data.totalRevenue > 0 ? data.ebitda / data.totalRevenue : 0;
  ws.getCell(r, 3).numFmt = '0.0%';
  ws.getCell(r, 4).value = "Gross Profit − OpEx";
  styleRow(ws, r, COLORS.ebitdaBg, "000000", true, 11);
  ws.getRow(r).height = 24;
  r += 2;

  ws.getCell(r, 1).value = "RESULTADO NETO (NET INCOME)";
  ws.getCell(r, 2).value = data.netIncome;
  ws.getCell(r, 2).numFmt = '#,##0.00';
  ws.getCell(r, 3).value = data.totalRevenue > 0 ? data.netIncome / data.totalRevenue : 0;
  ws.getCell(r, 3).numFmt = '0.0%';
  ws.getCell(r, 4).value = "EBITDA − Gastos personales";
  styleRow(ws, r, COLORS.netIncomeBg, "000000", true, 12);
  ws.getRow(r).height = 28;
  r += 2;

  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value = "  INDICADORES CLAVE DE DESEMPEÑO (KPIs)";
  styleRow(ws, r, COLORS.headerBg, COLORS.headerFont, true, 11);
  ws.getRow(r).height = 24;
  r++;

  ws.getCell(r, 1).value = "INDICADOR";
  ws.getCell(r, 2).value = "VALOR";
  ws.getCell(r, 3).value = "";
  ws.getCell(r, 4).value = "INTERPRETACIÓN";
  styleRow(ws, r, "34495E", COLORS.headerFont, true, 10);
  r++;

  data.kpis.forEach((kpi, i) => {
    const bgColor = i % 2 === 0 ? COLORS.kpiBg : COLORS.altRow1;
    ws.getCell(r, 1).value = kpi.label;
    ws.getCell(r, 2).value = kpi.value;
    ws.getCell(r, 4).value = kpi.description;
    styleRow(ws, r, bgColor, "000000", false, 10);
    ws.getCell(r, 1).font = { name: "Arial", size: 10, bold: true, color: { argb: "000000" } };
    r++;
  });

  r++;

  if (data.redFlags && data.redFlags.length > 0) {
    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).value = "  ⚠ ALERTAS / RED FLAGS";
    styleRow(ws, r, "922B21", COLORS.headerFont, true, 11);
    ws.getRow(r).height = 24;
    r++;

    data.redFlags.forEach((flag) => {
      ws.mergeCells(r, 1, r, 4);
      ws.getCell(r, 1).value = `  ⚠ ${flag}`;
      styleRow(ws, r, COLORS.redFlagBg, "922B21", false, 10);
      r++;
    });
    r++;
  }

  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value =
    "P&L basado en movimientos bancarios — no incluye CxC/CxP pendientes. Preparar estados formales con CPA para fines IRS.";
  styleRow(ws, r, COLORS.altRow2, COLORS.detailFont, false, 8);
  r++;
  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value = "Prepared by CTRL+ by TaxForYou | www.taxforyou.com";
  styleRow(ws, r, COLORS.altRow2, COLORS.detailFont, false, 8);

  if (data.thirdPartyPayments && data.thirdPartyPayments.length > 0) {
    const ws2 = wb.addWorksheet("Pagos a Terceros", { properties: { defaultColWidth: 20 } });
    ws2.getColumn(1).width = 14;
    ws2.getColumn(2).width = 30;
    ws2.getColumn(3).width = 14;
    ws2.getColumn(4).width = 16;
    ws2.getColumn(5).width = 26;

    let r2 = 1;
    ws2.mergeCells(r2, 1, r2, 5);
    ws2.getCell(r2, 1).value = "PAGOS A TERCEROS — CHEQUES Y ZELLE (para determinar 1099)";
    styleRow(ws2, r2, COLORS.headerBg, COLORS.headerFont, true, 12, 5);
    ws2.getRow(r2).height = 26;
    r2++;

    ws2.getCell(r2, 1).value = "Método";
    ws2.getCell(r2, 2).value = "Nombre / N° de cheque";
    ws2.getCell(r2, 3).value = "Fecha";
    ws2.getCell(r2, 4).value = "Monto";
    ws2.getCell(r2, 5).value = "Categoría";
    styleRow(ws2, r2, "34495E", COLORS.headerFont, true, 10, 5);
    r2++;

    const sorted = [...data.thirdPartyPayments].sort((a, b) =>
      a.method === b.method ? a.identifier.localeCompare(b.identifier) : a.method.localeCompare(b.method)
    );

    let groupKey = "";
    let groupStartRow = r2;
    let rowIndex = 0;

    const writeSubtotal = (key: string, startRow: number, endRow: number) => {
      ws2.getCell(r2, 1).value = "";
      ws2.getCell(r2, 2).value = `Total — ${key}`;
      ws2.getCell(r2, 3).value = "";
      ws2.getCell(r2, 4).value = { formula: `SUM(D${startRow}:D${endRow})` } as any;
      ws2.getCell(r2, 4).numFmt = "#,##0.00";
      ws2.getCell(r2, 5).value = "";
      styleRow(ws2, r2, "EBF5FB", "000000", true, 10, 5);
      r2++;
    };

    sorted.forEach((p) => {
      const key = `${p.method}: ${p.identifier}`;
      if (groupKey && key !== groupKey && rowIndex > 0) {
        writeSubtotal(groupKey, groupStartRow, r2 - 1);
        groupStartRow = r2;
      }
      groupKey = key;

      const bgColor = rowIndex % 2 === 0 ? COLORS.altRow2 : COLORS.altRow1;
      ws2.getCell(r2, 1).value = p.method;
      ws2.getCell(r2, 2).value = p.identifier;
      ws2.getCell(r2, 3).value = p.date || "";
      ws2.getCell(r2, 4).value = p.amt;
      ws2.getCell(r2, 4).numFmt = "#,##0.00";
      ws2.getCell(r2, 5).value = p.category || "";
      styleRow(ws2, r2, bgColor, "000000", false, 10, 5);
      r2++;
      rowIndex++;
    });

    if (groupKey) writeSubtotal(groupKey, groupStartRow, r2 - 1);

    const grandTotal = data.thirdPartyPayments.reduce((s, p) => s + p.amt, 0);
    r2++;
    ws2.getCell(r2, 1).value = "TOTAL GENERAL";
    ws2.getCell(r2, 4).value = grandTotal;
    ws2.getCell(r2, 4).numFmt = "#,##0.00";
    styleRow(ws2, r2, COLORS.netIncomeBg, "000000", true, 11, 5);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `PnL_${data.companyName?.replace(/\s+/g, "_") || "CTRL_Plus"}.xlsx`);
}

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { totalBankWithdrawals } from "./reconciliation";
import type { LineItem, ResultsData, Section, SectionKind, ThirdPartyPayment } from "./reportTypes";

type RGB = [number, number, number];

const COLORS = {
  headerBg: [13, 27, 42] as RGB,
  sectionRevenue: [20, 90, 50] as RGB,
  sectionCOGS: [27, 79, 114] as RGB,
  sectionOpex: [211, 84, 0] as RGB,
  sectionFood: [125, 102, 8] as RGB,
  sectionPersonal: [146, 43, 33] as RGB,
  sectionThirdParty: [108, 52, 131] as RGB,
  totalGreen: [213, 245, 227] as RGB,
  totalBlue: [214, 228, 240] as RGB,
  totalOrange: [253, 235, 208] as RGB,
  totalFood: [252, 243, 207] as RGB,
  totalRed: [250, 219, 216] as RGB,
  totalThirdParty: [232, 218, 239] as RGB,
  white: [255, 255, 255] as RGB,
  altGray: [242, 242, 242] as RGB,
  neonGreen: [111, 255, 0] as RGB,
  tableHead: [52, 73, 94] as RGB,
};

const SECTION_COLOR_BY_KIND: Record<SectionKind, { bg: RGB; totalBg: RGB }> = {
  revenue: { bg: COLORS.sectionRevenue, totalBg: COLORS.totalGreen },
  cogs: { bg: COLORS.sectionCOGS, totalBg: COLORS.totalBlue },
  opex: { bg: COLORS.sectionOpex, totalBg: COLORS.totalOrange },
  food: { bg: COLORS.sectionFood, totalBg: COLORS.totalFood },
  personal: { bg: COLORS.sectionPersonal, totalBg: COLORS.totalRed },
  thirdParty: { bg: COLORS.sectionThirdParty, totalBg: COLORS.totalThirdParty },
};

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Draws the page-top title/subtitle bars used at the start of every logical "section" of the report,
 * and returns the y coordinate where content should start. */
function pageHeader(doc: jsPDF, pageWidth: number, title: string, subtitle: string): number {
  doc.setFillColor(...COLORS.headerBg);
  doc.rect(0, 0, pageWidth, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 13);

  doc.setFillColor(46, 117, 182);
  doc.rect(0, 22, pageWidth, 8, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(subtitle, 14, 27);

  return 36;
}

/** A plain colored banner bar for sub-sections within a page (e.g. "CHEQUES EMITIDOS" inside
 * the Pagos a Terceros page). Not a table — just a labeled divider. */
function sectionBanner(doc: jsPDF, y: number, pageWidth: number, text: string, bg: RGB): number {
  const height = 8;
  doc.setFillColor(...bg);
  doc.rect(14, y, pageWidth - 28, height, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(text, 16, y + 5.5);
  return y + height + 3;
}

function ensureSpace(doc: jsPDF, y: number, threshold = 250): number {
  if (y > threshold) {
    doc.addPage();
    return 14;
  }
  return y;
}

/** Renders the standard 5-column (Descripción | Categoría | Fecha/Detalle | Monto | % Ingresos)
 * line-item table used by Ingresos/COGS/OpEx/Alimentación/Personal. Returns the next free y. */
function renderLineItemsTable(
  doc: jsPDF,
  startY: number,
  items: LineItem[],
  totalLabel: string,
  colors: { bg: RGB; totalBg: RGB }
): number {
  const body = items.map((item) => [item.name, item.category || "", item.detail || "", fmt(item.amount), `${item.percentage.toFixed(1)}%`]);
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  body.push([totalLabel, "", "", fmt(total), ""]);

  autoTable(doc, {
    startY,
    head: [["Descripción", "Categoría", "Fecha / Detalle", "Monto", "% Ingresos"]],
    body,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: colors.bg, textColor: COLORS.white, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 36 },
      2: { cellWidth: 36, fontSize: 7, textColor: [85, 85, 85] },
      3: { cellWidth: 26, halign: "right" },
      4: { cellWidth: 20, halign: "right" },
    },
    didParseCell(hookData) {
      const isTotal = hookData.row.index === body.length - 1;
      if (hookData.section === "body") {
        if (isTotal) {
          hookData.cell.styles.fillColor = colors.totalBg;
          hookData.cell.styles.fontStyle = "bold";
        } else {
          hookData.cell.styles.fillColor = hookData.row.index % 2 === 0 ? COLORS.altGray : COLORS.white;
        }
      }
    },
    margin: { left: 14, right: 14 },
  });

  return (doc as any).lastAutoTable.finalY + 4;
}

function renderExecutiveSummary(doc: jsPDF, pageWidth: number, data: ResultsData) {
  let y = pageHeader(doc, pageWidth, `RESUMEN EJECUTIVO — ${data.companyName || "CTRL+"}`, `${data.period || ""} | Prepared by CTRL+ by TaxForYou`);

  const bank = data.bankSummary;
  if (bank?.found) {
    const withdrawals = totalBankWithdrawals(bank);
    const rows: [string, number][] = ([
      ["Saldo Inicial", bank.beginningBalance],
      ["Saldo Final", bank.endingBalance],
      ["Total Depósitos y Adiciones", bank.deposits.amount],
      ["Total Retiros", withdrawals],
    ] as [string, number | null][]).filter((r): r is [string, number] => r[1] !== null);

    if (bank.beginningBalance !== null && bank.endingBalance !== null) {
      rows.push(["Resultado del Período (Cambio Neto en Caja)", bank.endingBalance - bank.beginningBalance]);
    }

    autoTable(doc, {
      startY: y,
      head: [["ACTIVIDAD DE LA CUENTA (según extracto bancario)", ""]],
      body: rows.map(([label, v]) => [label, fmt(v)]),
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.white, fontStyle: "bold", fontSize: 10 },
      columnStyles: { 0: { cellWidth: 130 }, 1: { cellWidth: 52, halign: "right", fontStyle: "bold" } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  const totalFood = data.totalFood || 0;
  const plRows: [string, number][] = [
    ["Total Ingresos", data.totalRevenue],
    ["Total COGS", data.totalCOGS],
    ["Utilidad Bruta (Gross Profit)", data.grossProfit],
    ["Total OpEx (incl. Alimentación)", data.totalOpex + totalFood],
    ["  de los cuales, Alimentación", totalFood],
    ["EBITDA", data.ebitda],
    ["Total Gastos Personales", data.totalPersonal],
    ["RESULTADO NETO (Net Income)", data.netIncome],
  ];
  autoTable(doc, {
    startY: y,
    head: [["RESUMEN P&L", "Monto", "% Ingresos"]],
    body: plRows.map(([label, v]) => [label, fmt(v), data.totalRevenue > 0 ? pct(v / data.totalRevenue) : "0%"]),
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.white, fontStyle: "bold", fontSize: 10 },
    columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 41, halign: "right" }, 2: { cellWidth: 41, halign: "right" } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = ensureSpace(doc, y, 240);

  autoTable(doc, {
    startY: y,
    head: [["INDICADOR", "VALOR", "INTERPRETACIÓN"]],
    body: data.kpis.map((k) => [k.label, k.value, k.description]),
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [235, 245, 251] },
    columnStyles: { 0: { cellWidth: 40, fontStyle: "bold" }, 1: { cellWidth: 30, halign: "center" }, 2: { cellWidth: 112 } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  if (data.reconciliation?.bankSummaryFound) {
    y = ensureSpace(doc, y, 260);
    const ok = data.reconciliation.ok;
    autoTable(doc, {
      startY: y,
      body: [[
        ok
          ? "✓ CONCILIADO — los totales clasificados cuadran contra el resumen del banco."
          : `⚠ ${data.reconciliation.discrepancies.length} discrepancia(s) contra el resumen del banco — ver ALERTAS Y RECOMENDACIONES.`,
      ]],
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 3, fontStyle: "bold" },
      bodyStyles: { fillColor: ok ? COLORS.totalGreen : COLORS.totalRed },
      margin: { left: 14, right: 14 },
    });
  }
}

function renderLineItemsPage(doc: jsPDF, pageWidth: number, title: string, period: string, section: Section | undefined, colors: { bg: RGB; totalBg: RGB }) {
  const y = pageHeader(doc, pageWidth, title, `${period} | Prepared by CTRL+ by TaxForYou`);
  renderLineItemsTable(doc, y, section?.items || [], section?.totalLabel || "Total", colors);
}

function renderOpexPage(doc: jsPDF, pageWidth: number, data: ResultsData) {
  let y = pageHeader(doc, pageWidth, "GASTOS OPERATIVOS (OPEX)", `${data.period || ""} | Incluye subcategoría de Alimentación (comidas de trabajo)`);

  const opexSection = data.sections.find((s) => s.kind === "opex");
  y = renderLineItemsTable(doc, y, opexSection?.items || [], opexSection?.totalLabel || "Total OpEx", SECTION_COLOR_BY_KIND.opex);

  const foodSection = data.sections.find((s) => s.kind === "food");
  if (foodSection && foodSection.items.length > 0) {
    y = ensureSpace(doc, y);
    y = sectionBanner(doc, y, pageWidth, "ALIMENTACIÓN (Comidas de trabajo — fast food/café/snacks)", SECTION_COLOR_BY_KIND.food.bg);
    y = renderLineItemsTable(doc, y, foodSection.items, foodSection.totalLabel || "Total Alimentación", SECTION_COLOR_BY_KIND.food);
  }

  y = ensureSpace(doc, y);
  autoTable(doc, {
    startY: y,
    body: [["TOTAL OPEX (incluye Alimentación)", fmt(data.totalOpex + (data.totalFood || 0))]],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3, fontStyle: "bold" },
    bodyStyles: { fillColor: COLORS.totalOrange },
    margin: { left: 14, right: 14 },
  });
}

function renderThirdPartyPage(doc: jsPDF, pageWidth: number, data: ResultsData) {
  let y = pageHeader(doc, pageWidth, "PAGOS A TERCEROS (para determinar 1099)", `${data.period || ""} | Cheques, Zelle y transferencias personales — uno por uno`);
  const buckets = data.thirdPartyBuckets;

  // --- Cheques Emitidos ---
  y = sectionBanner(doc, y, pageWidth, "CHEQUES EMITIDOS", SECTION_COLOR_BY_KIND.cogs.bg);
  const checks = buckets?.checks || [];
  const checksTotal = checks.reduce((sum, p) => sum + p.amt, 0);
  const checksBody: any[] = checks.map((p) => [p.identifier, p.payee || "Verificar", p.date || "", fmt(p.amt), p.category || "", p.classification || ""]);
  checksBody.push([{ content: "TOTAL CHEQUES EMITIDOS", colSpan: 3, styles: { fontStyle: "bold" } }, fmt(checksTotal), "", ""]);

  const checksField = data.reconciliation?.fields.find((f) => f.label === "Cheques Emitidos");
  if (checksField && checksField.bankAmount !== null) {
    checksBody.push([{ content: "Total según extracto bancario (Checks Paid)", colSpan: 3 }, fmt(checksField.bankAmount), "", ""]);
    checksBody.push([
      { content: "Diferencia", colSpan: 3, styles: { fontStyle: "bold", textColor: checksField.ok ? COLORS.sectionRevenue : COLORS.sectionPersonal } },
      fmt(checksField.delta ?? 0), "", "",
    ]);
  }

  autoTable(doc, {
    startY: y,
    head: [["N° Cheque", "Beneficiario", "Fecha", "Monto", "Categoría", "Clasificación"]],
    body: checksBody,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: COLORS.altGray },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // --- Transacciones Zelle ---
  y = ensureSpace(doc, y, 230);
  y = sectionBanner(doc, y, pageWidth, "TRANSACCIONES ZELLE", SECTION_COLOR_BY_KIND.opex.bg);

  const zelle: ThirdPartyPayment[] = [...(buckets?.zelleOutgoing || []), ...(buckets?.zelleIncoming || [])];
  const zelleTotal = zelle.reduce((sum, p) => sum + p.amt, 0);
  const zelleBody = zelle.map((p) => [
    p.direction === "incoming" ? "Entrante (cliente paga)" : "Saliente (negocio paga)",
    p.identifier, p.date || "", fmt(p.amt), p.category || "", [p.classification, p.alert].filter(Boolean).join(" — "),
  ]);
  zelleBody.push([{ content: "TOTAL ZELLE", colSpan: 3, styles: { fontStyle: "bold" } } as any, fmt(zelleTotal), "", ""]);

  autoTable(doc, {
    startY: y,
    head: [["Dirección", "Beneficiario / Remitente", "Fecha", "Monto", "Categoría", "Clasificación / Alerta"]],
    body: zelleBody,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: COLORS.altGray },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // --- Transferencias Personales ---
  y = ensureSpace(doc, y, 230);
  y = sectionBanner(doc, y, pageWidth, "TRANSFERENCIAS PERSONALES", SECTION_COLOR_BY_KIND.personal.bg);

  const transfers = buckets?.personalTransfers || [];
  if (transfers.length === 0) {
    autoTable(doc, {
      startY: y,
      body: [["Sin transferencias personales identificadas en este período."]],
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: 14, right: 14 },
    });
  } else {
    const transfersTotal = transfers.reduce((sum, i) => sum + i.amount, 0);
    const body = transfers.map((item) => [item.name, item.category || "", item.detail || "", fmt(item.amount)]);
    body.push(["TOTAL TRANSFERENCIAS PERSONALES", "", "", fmt(transfersTotal)]);

    autoTable(doc, {
      startY: y,
      head: [["Descripción", "Categoría", "Fecha / Detalle", "Monto"]],
      body,
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white, fontStyle: "bold" },
      didParseCell(hookData) {
        if (hookData.section === "body" && hookData.row.index === body.length - 1) {
          hookData.cell.styles.fillColor = COLORS.totalRed;
          hookData.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: 14, right: 14 },
    });
  }
}

function renderFullPLPage(doc: jsPDF, pageWidth: number, data: ResultsData) {
  let y = pageHeader(doc, pageWidth, `P&L COMPLETO — ${data.companyName || "CTRL+"}`, `${data.period || ""} | Prepared by CTRL+ by TaxForYou`);

  // Third Party Payments is an informational cross-reference (its amounts are already counted
  // within Revenue/COGS/OpEx/Personal above) — it gets its own dedicated page, not a line in the
  // core P&L waterfall, so it's excluded here to avoid double-counting toward EBITDA/Net Income.
  data.sections.filter((section) => section.kind !== "thirdParty").forEach((section) => {
    y = ensureSpace(doc, y);
    const colors = section.kind ? SECTION_COLOR_BY_KIND[section.kind] : SECTION_COLOR_BY_KIND.opex;

    const body = section.items.map((item) => [item.name, item.category || "", fmt(item.amount), `${item.percentage.toFixed(1)}%`, item.detail || ""]);
    body.push([section.totalLabel, "", fmt(section.total), data.totalRevenue > 0 ? pct(section.total / data.totalRevenue) : "0%", ""]);

    autoTable(doc, {
      startY: y,
      head: [[section.title, "", "", "", ""]],
      body,
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2, font: "helvetica" },
      headStyles: { fillColor: colors.bg, textColor: COLORS.white, fontStyle: "bold", fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 56 },
        1: { cellWidth: 34 },
        2: { cellWidth: 24, halign: "right" },
        3: { cellWidth: 16, halign: "right" },
        4: { cellWidth: 50, fontSize: 7, textColor: [85, 85, 85] },
      },
      didParseCell(hookData) {
        const isTotal = hookData.row.index === body.length - 1;
        if (hookData.section === "body") {
          if (isTotal) {
            hookData.cell.styles.fillColor = colors.totalBg;
            hookData.cell.styles.fontStyle = "bold";
          } else {
            hookData.cell.styles.fillColor = hookData.row.index % 2 === 0 ? COLORS.altGray : COLORS.white;
          }
        }
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 2;

    if (section.kind === "cogs") {
      autoTable(doc, {
        startY: y,
        body: [["UTILIDAD BRUTA (GROSS PROFIT)", fmt(data.grossProfit), data.totalRevenue > 0 ? pct(data.grossProfit / data.totalRevenue) : "0%", "Revenue − COGS"]],
        theme: "plain",
        styles: { fontSize: 9, cellPadding: 2, fontStyle: "bold" },
        bodyStyles: { fillColor: COLORS.totalGreen },
        columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 24, halign: "right" }, 2: { cellWidth: 16, halign: "right" }, 3: { cellWidth: 50, fontSize: 7, textColor: [85, 85, 85] } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 2;
    }
  });

  y = ensureSpace(doc, y, 240);

  autoTable(doc, {
    startY: y,
    body: [
      ["EBITDA (Utilidad Operativa)", fmt(data.ebitda), data.totalRevenue > 0 ? pct(data.ebitda / data.totalRevenue) : "0%", "Gross Profit − OpEx − Alimentación"],
      ["RESULTADO NETO (NET INCOME)", fmt(data.netIncome), data.totalRevenue > 0 ? pct(data.netIncome / data.totalRevenue) : "0%", "EBITDA − Personal"],
    ],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3, fontStyle: "bold" },
    bodyStyles: { fillColor: COLORS.totalGreen },
    columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 24, halign: "right" }, 2: { cellWidth: 16, halign: "right" }, 3: { cellWidth: 50, fontSize: 7, textColor: [85, 85, 85] } },
    margin: { left: 14, right: 14 },
  });
}

function renderAlertsPage(doc: jsPDF, pageWidth: number, data: ResultsData) {
  const y = pageHeader(doc, pageWidth, "ALERTAS Y RECOMENDACIONES", `${data.period || ""} | ${data.companyName || "CTRL+"}`);
  const flags = data.redFlags || [];

  if (flags.length === 0) {
    autoTable(doc, {
      startY: y,
      body: [["✓ Sin alertas — no se detectaron discrepancias ni patrones de riesgo en este período."]],
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 3 },
      bodyStyles: { fillColor: COLORS.totalGreen },
      margin: { left: 14, right: 14 },
    });
    return;
  }

  autoTable(doc, {
    startY: y,
    body: flags.map((f) => [`⚠ ${f}`]),
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    bodyStyles: { fillColor: [253, 237, 236] as RGB, textColor: [146, 43, 33] as RGB },
    margin: { left: 14, right: 14 },
  });
}

export function generateProfessionalPDF(data: ResultsData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  renderExecutiveSummary(doc, pageWidth, data);

  doc.addPage();
  renderThirdPartyPage(doc, pageWidth, data);

  doc.addPage();
  renderLineItemsPage(doc, pageWidth, "INGRESOS", data.period || "", data.sections.find((s) => s.kind === "revenue"), SECTION_COLOR_BY_KIND.revenue);

  doc.addPage();
  renderLineItemsPage(doc, pageWidth, "COGS (Costo de Ventas)", data.period || "", data.sections.find((s) => s.kind === "cogs"), SECTION_COLOR_BY_KIND.cogs);

  doc.addPage();
  renderOpexPage(doc, pageWidth, data);

  doc.addPage();
  renderLineItemsPage(doc, pageWidth, "GASTOS PERSONALES (No Deducibles)", data.period || "", data.sections.find((s) => s.kind === "personal"), SECTION_COLOR_BY_KIND.personal);

  doc.addPage();
  renderFullPLPage(doc, pageWidth, data);

  doc.addPage();
  renderAlertsPage(doc, pageWidth, data);

  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text("P&L based on bank transactions — does not include pending A/R or A/P.", 14, doc.internal.pageSize.getHeight() - 12);
  doc.text("Prepared by CTRL+ by TaxForYou | www.taxforyou.com", 14, doc.internal.pageSize.getHeight() - 8);

  doc.setDrawColor(...COLORS.neonGreen);
  doc.setLineWidth(1);
  doc.line(0, doc.internal.pageSize.getHeight() - 3, pageWidth, doc.internal.pageSize.getHeight() - 3);

  doc.save(`PnL_${data.companyName?.replace(/\s+/g, "_") || "CTRL_Plus"}.pdf`);
}

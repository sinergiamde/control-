import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { totalBankWithdrawals } from "./reconciliation";
import { STR, tr } from "./i18n";
import type { LineItem, ResultsData, Section, SectionKind, ThirdPartyPayment } from "./reportTypes";
import { groupThirdPartyByPayee } from "./reportTypes";

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

/** A plain colored banner bar for sub-sections within a page (e.g. "CHECKS ISSUED" inside
 * the Third Party Payments page). Not a table — just a labeled divider. */
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

/** Renders the standard 5-column (Description | Category | Date/Detail | Amount | % Revenue)
 * line-item table used by Revenue/COGS/OpEx/Food/Personal. Returns the next free y. */
function renderLineItemsTable(
  doc: jsPDF,
  startY: number,
  items: LineItem[],
  totalLabel: string,
  colors: { bg: RGB; totalBg: RGB },
  isEnglish: boolean
): number {
  const body = items.map((item) => [item.name, item.category || "", item.detail || "", fmt(item.amount), `${item.percentage.toFixed(1)}%`]);
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  body.push([totalLabel, "", "", fmt(total), ""]);

  autoTable(doc, {
    startY,
    head: [[tr(STR.description, isEnglish), tr(STR.category, isEnglish), tr(STR.dateDetail, isEnglish), tr(STR.amount, isEnglish), tr(STR.pctRevenue, isEnglish)]],
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

function renderExecutiveSummary(doc: jsPDF, pageWidth: number, data: ResultsData, isEnglish: boolean) {
  let y = pageHeader(doc, pageWidth, `${tr(STR.executiveSummary, isEnglish)} — ${data.companyName || "CTRL+"}`, `${data.period || ""} | ${tr(STR.preparedBy, isEnglish)}`);

  const bank = data.bankSummary;
  if (bank?.found) {
    const withdrawals = totalBankWithdrawals(bank);
    const rows: [string, number][] = ([
      [tr(STR.beginningBalance, isEnglish), bank.beginningBalance],
      [tr(STR.endingBalance, isEnglish), bank.endingBalance],
      [tr(STR.totalDeposits, isEnglish), bank.deposits.amount],
      [tr(STR.totalWithdrawals, isEnglish), withdrawals],
    ] as [string, number | null][]).filter((r): r is [string, number] => r[1] !== null);

    if (bank.beginningBalance !== null && bank.endingBalance !== null) {
      rows.push([tr(STR.periodResult, isEnglish), bank.endingBalance - bank.beginningBalance]);
    }

    autoTable(doc, {
      startY: y,
      head: [[tr(STR.accountActivity, isEnglish), ""]],
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
    [tr(STR.totalIncome, isEnglish), data.totalRevenue],
    [tr(STR.totalCOGS, isEnglish), data.totalCOGS],
    [tr(STR.grossProfit, isEnglish), data.grossProfit],
    [tr(STR.totalOpexInclFood, isEnglish), data.totalOpex + totalFood],
    [tr(STR.ofWhichFood, isEnglish), totalFood],
    [tr(STR.ebitda, isEnglish), data.ebitda],
    [tr(STR.totalPersonalExpenses, isEnglish), data.totalPersonal],
    [tr(STR.netResult, isEnglish), data.netIncome],
  ];
  autoTable(doc, {
    startY: y,
    head: [[tr(STR.plSummary, isEnglish), tr(STR.amount, isEnglish), tr(STR.pctRevenue, isEnglish)]],
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
    head: [[tr(STR.indicator, isEnglish), tr(STR.value, isEnglish), tr(STR.interpretation, isEnglish)]],
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
          ? tr(STR.reconciledOk, isEnglish)
          : `⚠ ${data.reconciliation.discrepancies.length} ${tr(STR.discrepanciesBanner, isEnglish)}`,
      ]],
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 3, fontStyle: "bold" },
      bodyStyles: { fillColor: ok ? COLORS.totalGreen : COLORS.totalRed },
      margin: { left: 14, right: 14 },
    });
  }
}

function renderLineItemsPage(doc: jsPDF, pageWidth: number, title: string, period: string, section: Section | undefined, colors: { bg: RGB; totalBg: RGB }, isEnglish: boolean) {
  const y = pageHeader(doc, pageWidth, title, `${period} | ${tr(STR.preparedBy, isEnglish)}`);
  renderLineItemsTable(doc, y, section?.items || [], section?.totalLabel || tr(STR.total, isEnglish), colors, isEnglish);
}

function renderOpexPage(doc: jsPDF, pageWidth: number, data: ResultsData, isEnglish: boolean) {
  let y = pageHeader(
    doc, pageWidth,
    isEnglish ? "OPERATING EXPENSES (OPEX)" : "GASTOS OPERATIVOS (OPEX)",
    `${data.period || ""} | ${isEnglish ? "Includes Food subcategory (work meals)" : "Incluye subcategoría de Alimentación (comidas de trabajo)"}`
  );

  const opexSection = data.sections.find((s) => s.kind === "opex");
  y = renderLineItemsTable(doc, y, opexSection?.items || [], opexSection?.totalLabel || tr(STR.totalOpex, isEnglish), SECTION_COLOR_BY_KIND.opex, isEnglish);

  const foodSection = data.sections.find((s) => s.kind === "food");
  if (foodSection && foodSection.items.length > 0) {
    y = ensureSpace(doc, y);
    y = sectionBanner(doc, y, pageWidth, tr(STR.foodBanner, isEnglish).trim(), SECTION_COLOR_BY_KIND.food.bg);
    y = renderLineItemsTable(doc, y, foodSection.items, foodSection.totalLabel || tr(STR.totalFood, isEnglish), SECTION_COLOR_BY_KIND.food, isEnglish);
  }

  y = ensureSpace(doc, y);
  autoTable(doc, {
    startY: y,
    body: [[tr(STR.totalOpexWithFood, isEnglish), fmt(data.totalOpex + (data.totalFood || 0))]],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3, fontStyle: "bold" },
    bodyStyles: { fillColor: COLORS.totalOrange },
    margin: { left: 14, right: 14 },
  });
}

function renderThirdPartyPage(doc: jsPDF, pageWidth: number, data: ResultsData, isEnglish: boolean) {
  let y = pageHeader(
    doc, pageWidth,
    `${tr(STR.thirdPartyPayments, isEnglish)} (${tr(STR.thirdPartyPaymentsSubtitle1099, isEnglish)})`,
    `${data.period || ""} | ${tr(STR.thirdPartyPaymentsSubtitleDetail, isEnglish)}`
  );
  const buckets = data.thirdPartyBuckets;

  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(90, 90, 90);
  const noteLines = doc.splitTextToSize(tr(STR.thirdPartyInfoNote, isEnglish), pageWidth - 28);
  doc.text(noteLines, 14, y);
  y += noteLines.length * 4 + 3;
  doc.setFont("helvetica", "normal");

  // --- Checks Issued (grouped by payee, oldest to newest, with a subtotal per person) ---
  y = sectionBanner(doc, y, pageWidth, tr(STR.checksIssued, isEnglish), SECTION_COLOR_BY_KIND.cogs.bg);
  const checks = buckets?.checks || [];
  const checksTotal = checks.reduce((sum, p) => sum + p.amt, 0);
  const checkGroups = groupThirdPartyByPayee(checks, tr(STR.verifyNoPayee, isEnglish));
  const checksBody: any[] = [];
  const checksSubtotalRows = new Set<number>();
  checkGroups.forEach((group) => {
    group.rows.forEach((p) => {
      checksBody.push([p.identifier, p.payee || tr(STR.verifyNoPayee, isEnglish), p.date || "", fmt(p.amt), p.category || "", p.classification || ""]);
    });
    checksBody.push([{ content: `${tr(STR.totalPaidToPrefix, isEnglish)} ${group.payee}`, colSpan: 3, styles: { fontStyle: "bold" } }, fmt(group.total), "", ""]);
    checksSubtotalRows.add(checksBody.length - 1);
  });
  checksBody.push([{ content: tr(STR.totalChecksIssued, isEnglish), colSpan: 3, styles: { fontStyle: "bold" } }, fmt(checksTotal), "", ""]);
  const checksGrandTotalRow = checksBody.length - 1;

  const checksField = data.reconciliation?.fields.find((f) => f.id === "checksIssued");
  if (checksField && checksField.bankAmount !== null) {
    checksBody.push([{ content: tr(STR.perBankSummaryChecksPaid, isEnglish), colSpan: 3 }, fmt(checksField.bankAmount), "", ""]);
    checksBody.push([
      { content: tr(STR.difference, isEnglish), colSpan: 3, styles: { fontStyle: "bold", textColor: checksField.ok ? COLORS.sectionRevenue : COLORS.sectionPersonal } },
      fmt(checksField.delta ?? 0), "", "",
    ]);
  }

  autoTable(doc, {
    startY: y,
    head: [[tr(STR.checkNumber, isEnglish), tr(STR.payee, isEnglish), tr(STR.date, isEnglish), tr(STR.amount, isEnglish), tr(STR.category, isEnglish), tr(STR.classification, isEnglish)]],
    body: checksBody,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: COLORS.altGray },
    didParseCell(hookData) {
      if (hookData.section !== "body") return;
      if (checksSubtotalRows.has(hookData.row.index)) hookData.cell.styles.fillColor = COLORS.totalThirdParty;
      if (hookData.row.index === checksGrandTotalRow) hookData.cell.styles.fillColor = COLORS.totalBlue;
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // --- Zelle Transactions (grouped by person, oldest to newest, with a subtotal per person) ---
  y = ensureSpace(doc, y, 230);
  y = sectionBanner(doc, y, pageWidth, tr(STR.zelleTransactions, isEnglish), SECTION_COLOR_BY_KIND.opex.bg);

  const zelle: ThirdPartyPayment[] = [...(buckets?.zelleOutgoing || []), ...(buckets?.zelleIncoming || [])];
  const zelleTotal = zelle.reduce((sum, p) => sum + p.amt, 0);
  const zelleGroups = groupThirdPartyByPayee(zelle, tr(STR.payeeNotShown, isEnglish));
  const zelleBody: any[] = [];
  const zelleSubtotalRows = new Set<number>();
  zelleGroups.forEach((group) => {
    group.rows.forEach((p) => {
      zelleBody.push([
        p.direction === "incoming" ? tr(STR.incomingClientPays, isEnglish) : tr(STR.outgoingBusinessPays, isEnglish),
        p.identifier, p.date || "", fmt(p.amt), p.category || "", [p.classification, p.alert].filter(Boolean).join(" — "),
      ]);
    });
    zelleBody.push([{ content: `${tr(STR.totalPaidToPrefix, isEnglish)} ${group.payee}`, colSpan: 3, styles: { fontStyle: "bold" } } as any, fmt(group.total), "", ""]);
    zelleSubtotalRows.add(zelleBody.length - 1);
  });
  zelleBody.push([{ content: tr(STR.totalZelle, isEnglish), colSpan: 3, styles: { fontStyle: "bold" } } as any, fmt(zelleTotal), "", ""]);
  const zelleGrandTotalRow = zelleBody.length - 1;

  autoTable(doc, {
    startY: y,
    head: [[tr(STR.direction, isEnglish), tr(STR.payeeSender, isEnglish), tr(STR.date, isEnglish), tr(STR.amount, isEnglish), tr(STR.category, isEnglish), tr(STR.classificationAlert, isEnglish)]],
    body: zelleBody,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: COLORS.tableHead, textColor: COLORS.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: COLORS.altGray },
    didParseCell(hookData) {
      if (hookData.section !== "body") return;
      if (zelleSubtotalRows.has(hookData.row.index)) hookData.cell.styles.fillColor = COLORS.totalThirdParty;
      if (hookData.row.index === zelleGrandTotalRow) hookData.cell.styles.fillColor = COLORS.totalOrange;
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // --- Personal Transfers ---
  y = ensureSpace(doc, y, 230);
  y = sectionBanner(doc, y, pageWidth, tr(STR.personalTransfers, isEnglish), SECTION_COLOR_BY_KIND.personal.bg);

  const transfers = buckets?.personalTransfers || [];
  if (transfers.length === 0) {
    autoTable(doc, {
      startY: y,
      body: [[tr(STR.noPersonalTransfers, isEnglish)]],
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: 14, right: 14 },
    });
  } else {
    const transfersTotal = transfers.reduce((sum, i) => sum + i.amount, 0);
    const body = transfers.map((item) => [item.name, item.category || "", item.detail || "", fmt(item.amount)]);
    body.push([tr(STR.totalPersonalTransfers, isEnglish), "", "", fmt(transfersTotal)]);

    autoTable(doc, {
      startY: y,
      head: [[tr(STR.description, isEnglish), tr(STR.category, isEnglish), tr(STR.dateDetail, isEnglish), tr(STR.amount, isEnglish)]],
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

function renderFullPLPage(doc: jsPDF, pageWidth: number, data: ResultsData, isEnglish: boolean) {
  let y = pageHeader(doc, pageWidth, `${tr(STR.fullPL, isEnglish)} — ${data.companyName || "CTRL+"}`, `${data.period || ""} | ${tr(STR.preparedBy, isEnglish)}`);

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
        body: [[tr(STR.grossProfitCaption, isEnglish), fmt(data.grossProfit), data.totalRevenue > 0 ? pct(data.grossProfit / data.totalRevenue) : "0%", tr(STR.revenueMinusCogs, isEnglish)]],
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
      [tr(STR.ebitdaCaption, isEnglish), fmt(data.ebitda), data.totalRevenue > 0 ? pct(data.ebitda / data.totalRevenue) : "0%", tr(STR.ebitdaFormula, isEnglish)],
      [tr(STR.netIncomeCaption, isEnglish), fmt(data.netIncome), data.totalRevenue > 0 ? pct(data.netIncome / data.totalRevenue) : "0%", tr(STR.netIncomeFormula, isEnglish)],
    ],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3, fontStyle: "bold" },
    bodyStyles: { fillColor: COLORS.totalGreen },
    columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 24, halign: "right" }, 2: { cellWidth: 16, halign: "right" }, 3: { cellWidth: 50, fontSize: 7, textColor: [85, 85, 85] } },
    margin: { left: 14, right: 14 },
  });
}

function renderAlertsPage(doc: jsPDF, pageWidth: number, data: ResultsData, isEnglish: boolean) {
  let y = pageHeader(doc, pageWidth, tr(STR.alertsRecommendations, isEnglish), `${data.period || ""} | ${data.companyName || "CTRL+"}`);
  const flags = data.redFlags || [];

  if (flags.length === 0) {
    autoTable(doc, {
      startY: y,
      body: [[tr(STR.noAlerts, isEnglish)]],
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 3 },
      bodyStyles: { fillColor: COLORS.totalGreen },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  } else {
    autoTable(doc, {
      startY: y,
      body: flags.map((f) => [`⚠ ${f}`]),
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2 },
      bodyStyles: { fillColor: [253, 237, 236] as RGB, textColor: [146, 43, 33] as RGB },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }

  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(90, 90, 90);
  const noteLines = doc.splitTextToSize(tr(STR.seeThirdPartyNote, isEnglish), pageWidth - 28);
  doc.text(noteLines, 14, y + 4);
  doc.setFont("helvetica", "normal");
}

export function generateProfessionalPDF(data: ResultsData, isEnglish = true) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  renderExecutiveSummary(doc, pageWidth, data, isEnglish);

  doc.addPage();
  renderLineItemsPage(doc, pageWidth, tr(STR.revenue, isEnglish), data.period || "", data.sections.find((s) => s.kind === "revenue"), SECTION_COLOR_BY_KIND.revenue, isEnglish);

  doc.addPage();
  renderLineItemsPage(doc, pageWidth, tr(STR.cogsFull, isEnglish), data.period || "", data.sections.find((s) => s.kind === "cogs"), SECTION_COLOR_BY_KIND.cogs, isEnglish);

  doc.addPage();
  renderOpexPage(doc, pageWidth, data, isEnglish);

  doc.addPage();
  renderLineItemsPage(doc, pageWidth, tr(STR.otherExpensesDeductions, isEnglish), data.period || "", data.sections.find((s) => s.kind === "personal"), SECTION_COLOR_BY_KIND.personal, isEnglish);

  doc.addPage();
  renderFullPLPage(doc, pageWidth, data, isEnglish);

  doc.addPage();
  renderAlertsPage(doc, pageWidth, data, isEnglish);

  doc.addPage();
  renderThirdPartyPage(doc, pageWidth, data, isEnglish);

  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text(tr(STR.footerDisclaimer, isEnglish), 14, doc.internal.pageSize.getHeight() - 12);
  doc.text(tr(STR.preparedBy, isEnglish), 14, doc.internal.pageSize.getHeight() - 8);

  doc.setDrawColor(...COLORS.neonGreen);
  doc.setLineWidth(1);
  doc.line(0, doc.internal.pageSize.getHeight() - 3, pageWidth, doc.internal.pageSize.getHeight() - 3);

  doc.save(`PnL_${data.companyName?.replace(/\s+/g, "_") || "CTRL_Plus"}.pdf`);
}

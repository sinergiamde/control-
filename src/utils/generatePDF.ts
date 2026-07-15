import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  headerBg: [13, 27, 42] as [number, number, number],
  sectionRevenue: [20, 90, 50] as [number, number, number],
  sectionCOGS: [27, 79, 114] as [number, number, number],
  sectionOpex: [211, 84, 0] as [number, number, number],
  sectionPersonal: [146, 43, 33] as [number, number, number],
  totalGreen: [213, 245, 227] as [number, number, number],
  totalBlue: [214, 228, 240] as [number, number, number],
  totalOrange: [253, 235, 208] as [number, number, number],
  totalRed: [250, 219, 216] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  altGray: [242, 242, 242] as [number, number, number],
  neonGreen: [111, 255, 0] as [number, number, number],
};

export function generateProfessionalPDF(data: ResultsData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(...COLORS.headerBg);
  doc.rect(0, 0, pageWidth, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`PROFIT & LOSS — ${data.companyName || "CTRL+"}`, 14, 13);

  doc.setFillColor(46, 117, 182);
  doc.rect(0, 22, pageWidth, 8, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`${data.period || ""} | Prepared by CTRL+ by TaxForYou`, 14, 27);

  let y = 36;

  const sectionColorMap = [
    { bg: COLORS.sectionRevenue, totalBg: COLORS.totalGreen },
    { bg: COLORS.sectionCOGS, totalBg: COLORS.totalBlue },
    { bg: COLORS.sectionOpex, totalBg: COLORS.totalOrange },
    { bg: COLORS.sectionPersonal, totalBg: COLORS.totalRed },
  ];

  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  data.sections.forEach((section, si) => {
    const colors = sectionColorMap[si] || sectionColorMap[0];

    const bodyRows = section.items.map((item) => [
      item.name,
      fmt(item.amount),
      `${item.percentage.toFixed(1)}%`,
      item.detail || "",
    ]);

    bodyRows.push([
      section.totalLabel,
      fmt(section.total),
      data.totalRevenue > 0 ? pct(section.total / data.totalRevenue) : "0%",
      "",
    ]);

    autoTable(doc, {
      startY: y,
      head: [[section.title, "", "", ""]],
      body: bodyRows,
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2, font: "helvetica" },
      headStyles: {
        fillColor: colors.bg,
        textColor: COLORS.white,
        fontStyle: "bold",
        fontSize: 9,
      },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 28, halign: "right" },
        2: { cellWidth: 18, halign: "right" },
        3: { cellWidth: 66, fontSize: 7, textColor: [85, 85, 85] },
      },
      didParseCell(hookData) {
        const rowIdx = hookData.row.index;
        const isTotal = rowIdx === bodyRows.length - 1;
        if (hookData.section === "body") {
          if (isTotal) {
            hookData.cell.styles.fillColor = colors.totalBg;
            hookData.cell.styles.fontStyle = "bold";
          } else {
            hookData.cell.styles.fillColor = rowIdx % 2 === 0 ? COLORS.altGray : COLORS.white;
          }
        }
      },
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable.finalY + 2;

    if (si === 1) {
      autoTable(doc, {
        startY: y,
        body: [["UTILIDAD BRUTA (GROSS PROFIT)", fmt(data.grossProfit), data.totalRevenue > 0 ? pct(data.grossProfit / data.totalRevenue) : "0%", "Revenue − COGS"]],
        theme: "plain",
        styles: { fontSize: 9, cellPadding: 2, fontStyle: "bold" },
        bodyStyles: { fillColor: COLORS.totalGreen },
        columnStyles: {
          0: { cellWidth: 70 },
          1: { cellWidth: 28, halign: "right" },
          2: { cellWidth: 18, halign: "right" },
          3: { cellWidth: 66, fontSize: 7, textColor: [85, 85, 85] },
        },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 2;
    }
  });

  if (y > 240) {
    doc.addPage();
    y = 14;
  }

  autoTable(doc, {
    startY: y,
    body: [
      ["EBITDA (Utilidad Operativa)", fmt(data.ebitda), data.totalRevenue > 0 ? pct(data.ebitda / data.totalRevenue) : "0%", "Gross Profit − OpEx"],
      ["RESULTADO NETO (NET INCOME)", fmt(data.netIncome), data.totalRevenue > 0 ? pct(data.netIncome / data.totalRevenue) : "0%", "EBITDA − Personal"],
    ],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3, fontStyle: "bold" },
    bodyStyles: { fillColor: COLORS.totalGreen },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 28, halign: "right" },
      2: { cellWidth: 18, halign: "right" },
      3: { cellWidth: 66, fontSize: 7, textColor: [85, 85, 85] },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  if (y > 240) { doc.addPage(); y = 14; }

  autoTable(doc, {
    startY: y,
    head: [["INDICADOR", "VALOR", "INTERPRETACIÓN"]],
    body: data.kpis.map((k) => [k.label, k.value, k.description]),
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [235, 245, 251] },
    columnStyles: {
      0: { cellWidth: 40, fontStyle: "bold" },
      1: { cellWidth: 30, halign: "center" },
      2: { cellWidth: 112 },
    },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  if (data.redFlags && data.redFlags.length > 0) {
    if (y > 250) { doc.addPage(); y = 14; }
    autoTable(doc, {
      startY: y,
      head: [["⚠ ALERTAS / RED FLAGS"]],
      body: data.redFlags.map((f) => [`⚠ ${f}`]),
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.sectionPersonal, textColor: COLORS.white, fontStyle: "bold" },
      bodyStyles: { fillColor: [253, 237, 236] as [number, number, number], textColor: [146, 43, 33] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  if (data.thirdPartyPayments && data.thirdPartyPayments.length > 0) {
    doc.addPage();
    y = 14;

    doc.setFillColor(...COLORS.headerBg);
    doc.rect(0, 0, pageWidth, 14, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("PAGOS A TERCEROS — CHEQUES Y ZELLE (para determinar 1099)", 14, 9);
    y = 20;

    const sorted = [...data.thirdPartyPayments].sort((a, b) =>
      a.method === b.method ? a.identifier.localeCompare(b.identifier) : a.method.localeCompare(b.method)
    );

    const grouped: Record<string, ThirdPartyPayment[]> = {};
    sorted.forEach((p) => {
      const key = `${p.method}: ${p.identifier}`;
      (grouped[key] = grouped[key] || []).push(p);
    });

    const body: any[] = [];
    Object.entries(grouped).forEach(([key, payments]) => {
      payments.forEach((p) => {
        body.push([p.method, p.identifier, p.date || "", fmt(p.amt), p.category || ""]);
      });
      const subtotal = payments.reduce((s, p) => s + p.amt, 0);
      body.push([{ content: `Total — ${key}`, colSpan: 3, styles: { fontStyle: "bold" } }, fmt(subtotal), ""]);
    });

    autoTable(doc, {
      startY: y,
      head: [["Método", "Nombre / N° cheque", "Fecha", "Monto", "Categoría"]],
      body,
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [52, 73, 94] as [number, number, number], textColor: COLORS.white, fontStyle: "bold" },
      alternateRowStyles: { fillColor: COLORS.altGray },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;

    const grandTotal = data.thirdPartyPayments.reduce((s, p) => s + p.amt, 0);
    autoTable(doc, {
      startY: y,
      body: [["TOTAL GENERAL", fmt(grandTotal)]],
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 3, fontStyle: "bold" },
      bodyStyles: { fillColor: COLORS.totalGreen },
      margin: { left: 14, right: 14 },
    });
  }

  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text("P&L basado en movimientos bancarios — no incluye CxC/CxP pendientes.", 14, doc.internal.pageSize.getHeight() - 12);
  doc.text("Prepared by CTRL+ by TaxForYou | www.taxforyou.com", 14, doc.internal.pageSize.getHeight() - 8);

  doc.setDrawColor(...COLORS.neonGreen);
  doc.setLineWidth(1);
  doc.line(0, doc.internal.pageSize.getHeight() - 3, pageWidth, doc.internal.pageSize.getHeight() - 3);

  doc.save(`PnL_${data.companyName?.replace(/\s+/g, "_") || "CTRL_Plus"}.pdf`);
}

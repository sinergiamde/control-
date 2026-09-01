// Shared EN/ES dictionary for report rendering (Dashboard, Excel, PDF, consolidated exports).
// The AI always classifies transactions with an ENGLISH "category" string (see analyze-statement's
// system prompt) so category-based aggregation stays consistent no matter what language a
// statement was analyzed in. This file translates those fixed category strings — and the fixed
// structural chrome (titles, column headers, banners) — for display, so a report never mixes
// English and Spanish depending on which language is selected.

export const CATEGORY_ES: Record<string, string> = {
  // Income
  "Bank transfer": "Transferencia bancaria",
  "Wire transfer": "Transferencia electrónica",
  "Zelle": "Zelle",
  "Check": "Cheque",
  "Cash deposit": "Depósito en efectivo",
  "Other income (specify)": "Otro ingreso (especificar)",
  // COGS
  "Materials": "Materiales",
  "Supplies": "Suministros",
  "Storage": "Almacenamiento",
  "Startup and moving costs": "Costos de inicio y mudanza",
  "Subcontractor costs": "Costos de subcontratistas",
  "Fuel (work)": "Combustible (trabajo)",
  "Tolls (work)": "Peajes (trabajo)",
  "Permits": "Permisos",
  // OPEX
  "Payroll": "Nómina",
  "Rent (lease or mortgage)": "Renta (arriendo o hipoteca)",
  "Utilities (electric/water)": "Servicios públicos (luz/agua)",
  "Internet": "Internet",
  "Business insurance": "Seguro del negocio",
  "Parking": "Parqueadero",
  "Car insurance": "Seguro del vehículo",
  "Car payment": "Pago del vehículo",
  "Repairs and maintenance": "Reparaciones y mantenimiento",
  "Vehicle expenses": "Gastos de vehículo",
  "Marketing and advertising": "Mercadeo y publicidad",
  "Subscriptions and membership dues": "Suscripciones y membresías",
  "Business software": "Software del negocio",
  "Website and hosting": "Sitio web y hosting",
  "Training and development": "Capacitación y desarrollo",
  "Licenses and permits": "Licencias y permisos",
  "Legal and compliance fees": "Honorarios legales y de cumplimiento",
  "Professional services": "Servicios profesionales",
  "Office supplies": "Suministros de oficina",
  "Office furniture and equipment": "Muebles y equipo de oficina",
  "Operating costs": "Costos operativos",
  "Bad debts or loans": "Deudas incobrables o préstamos",
  "Travel expenses": "Gastos de viaje",
  "Hotels or lodging": "Hoteles o alojamiento",
  "Meals (work — fast food/coffee/snacks)": "Comidas (trabajo — comida rápida/café/snacks)",
  // Fees
  "Bank fees": "Comisiones bancarias",
  // Personal
  "Clothing": "Ropa",
  "Entertainment": "Entretenimiento",
  "Personal purchases": "Compras personales",
  "Zelle to family (no business justification)": "Zelle a familiares (sin justificación de negocio)",
  "Personal bank transfer": "Transferencia bancaria personal",
  "Health / personal services": "Salud / servicios personales",
  "Meals (restaurant/bar)": "Comidas (restaurante/bar)",
  "Other personal (specify)": "Otro personal (especificar)",
};

/** Renders a fixed AI category string in the requested display language. Falls back to the raw
 * value for anything not in the dictionary (custom/legacy categories) rather than showing blank. */
export const translateCategory = (category: string | undefined | null, isEnglish: boolean): string => {
  if (!category) return "";
  if (isEnglish) return category;
  return CATEGORY_ES[category] || category;
};

type Bilingual = { en: string; es: string };

/** Picks the string for the requested language. */
export const tr = (s: Bilingual, isEnglish: boolean): string => (isEnglish ? s.en : s.es);

/** Reads a free-text field the AI wrote in both languages (e.g. "detail_en"/"detail_es") and picks
 * the one matching the requested language. Falls back to the old single-language field name (e.g.
 * "detail") for analyses stored before the AI started producing both variants, so historical data
 * still renders instead of going blank. */
export const pickText = (item: any, baseKey: string, isEnglish: boolean): string => {
  const bilingual = item?.[`${baseKey}_${isEnglish ? "en" : "es"}`];
  if (typeof bilingual === "string") return bilingual;
  return typeof item?.[baseKey] === "string" ? item[baseKey] : "";
};

/** Same idea as {@link pickText} but for array fields (e.g. "insights_en"/"insights_es"). */
export const pickArray = (source: any, baseKey: string, isEnglish: boolean): string[] => {
  const bilingual = source?.[`${baseKey}_${isEnglish ? "en" : "es"}`];
  if (Array.isArray(bilingual)) return bilingual;
  return Array.isArray(source?.[baseKey]) ? source[baseKey] : [];
};

export const STR = {
  // Report/section titles
  revenue: { en: "Revenue", es: "Ingresos" },
  cogs: { en: "COGS", es: "COGS" },
  cogsFull: { en: "COGS (Cost of Goods Sold)", es: "COGS (Costo de Ventas)" },
  operatingExpensesFees: { en: "Operating Expenses & Fees", es: "Gastos Operativos y Comisiones" },
  operatingExpenses: { en: "Operating Expenses (OpEx)", es: "Gastos Operativos (OpEx)" },
  food: { en: "Food / Work Meals", es: "Alimentación (Comidas de Trabajo)" },
  otherExpensesDeductions: { en: "Other Expenses/Possible Deductions", es: "Otros Gastos/Posibles Deducciones" },
  thirdPartyPayments: { en: "Third Party Payments", es: "Pagos a Terceros" },
  thirdPartyPaymentsSubtitle1099: {
    en: "for 1099 determination",
    es: "para determinar 1099",
  },
  thirdPartyPaymentsSubtitleDetail: {
    en: "Checks, Zelle and personal transfers — itemized one by one",
    es: "Cheques, Zelle y transferencias personales — uno por uno",
  },
  thirdPartyInfoNote: {
    en: "Informational only, for 1099 determination — grouped by payee so you can see what each person was paid. These amounts are already counted in Revenue/COGS/OpEx/Personal earlier in this report; do not add them again.",
    es: "Solo informativo, para determinar 1099 — agrupado por beneficiario para ver cuánto se le pagó a cada persona. Estos montos ya están contados en Ingresos/COGS/OpEx/Personal más arriba en este reporte; no se deben volver a sumar.",
  },
  seeThirdPartyNote: {
    en: "Third Party Payments (next page) breaks down what was paid to each person/vendor — informational only, for 1099 purposes. It is not an additional total.",
    es: "Pagos a Terceros (página siguiente) desglosa cuánto se le pagó a cada persona/proveedor — solo informativo, para fines de 1099. No es un total adicional.",
  },
  totalPaidToPrefix: { en: "Total paid to", es: "Total pagado a" },

  // Total labels
  totalRevenue: { en: "Total Revenue", es: "Total Ingresos" },
  totalCOGS: { en: "Total COGS", es: "Total COGS" },
  totalOpex: { en: "Total OpEx", es: "Total OpEx" },
  totalOpexWithFood: { en: "TOTAL OPEX (includes Food)", es: "TOTAL OPEX (incluye Alimentación)" },
  totalFood: { en: "Total Food", es: "Total Alimentación" },
  totalPersonal: { en: "Total Personal", es: "Total Personal" },
  totalThirdParty: { en: "Total Third Party Payments", es: "Total Pagos a Terceros" },
  total: { en: "Total", es: "Total" },

  // Column headers (line-item tables)
  description: { en: "Description", es: "Descripción" },
  category: { en: "Category", es: "Categoría" },
  dateDetail: { en: "Date / Detail", es: "Fecha / Detalle" },
  date: { en: "Date", es: "Fecha" },
  amount: { en: "Amount", es: "Monto" },
  pctRevenue: { en: "% Revenue", es: "% Ingresos" },
  classification: { en: "Classification", es: "Clasificación" },
  classificationAlert: { en: "Classification / Alert", es: "Clasificación / Alerta" },
  checkNumber: { en: "Check #", es: "N° Cheque" },
  payee: { en: "Payee", es: "Beneficiario" },
  payeeSender: { en: "Payee / Sender", es: "Beneficiario / Remitente" },
  direction: { en: "Direction", es: "Dirección" },

  // Third Party Payments sub-sections
  checksIssued: { en: "CHECKS ISSUED", es: "CHEQUES EMITIDOS" },
  totalChecksIssued: { en: "TOTAL CHECKS ISSUED", es: "TOTAL CHEQUES EMITIDOS" },
  verifyNoPayee: { en: "Verify (no payee shown on statement)", es: "Verificar (sin beneficiario en el extracto)" },
  perBankSummaryChecksPaid: { en: "Per bank statement summary (Checks Paid)", es: "Total según extracto bancario (Checks Paid)" },
  difference: { en: "Difference", es: "Diferencia" },
  zelleTransactions: { en: "ZELLE TRANSACTIONS", es: "TRANSACCIONES ZELLE" },
  totalZelle: { en: "TOTAL ZELLE", es: "TOTAL ZELLE" },
  incomingClientPays: { en: "Incoming (client pays)", es: "Entrante (cliente paga)" },
  outgoingBusinessPays: { en: "Outgoing (business pays)", es: "Saliente (negocio paga)" },
  personalTransfers: { en: "PERSONAL TRANSFERS", es: "TRANSFERENCIAS PERSONALES" },
  totalPersonalTransfers: { en: "TOTAL PERSONAL TRANSFERS", es: "TOTAL TRANSFERENCIAS PERSONALES" },
  noPersonalTransfers: { en: "No personal transfers identified in this period.", es: "Sin transferencias personales identificadas en este período." },

  // Executive summary / P&L
  executiveSummary: { en: "EXECUTIVE SUMMARY", es: "RESUMEN EJECUTIVO" },
  accountActivity: { en: "ACCOUNT ACTIVITY (per bank statement)", es: "ACTIVIDAD DE LA CUENTA (según extracto bancario)" },
  beginningBalance: { en: "Beginning Balance", es: "Saldo Inicial" },
  endingBalance: { en: "Ending Balance", es: "Saldo Final" },
  totalDeposits: { en: "Total Deposits and Additions", es: "Total Depósitos y Adiciones" },
  totalWithdrawals: { en: "Total Withdrawals", es: "Total Retiros" },
  periodResult: { en: "Period Result (Net Change in Cash)", es: "Resultado del Período (Cambio Neto en Caja)" },
  plSummary: { en: "P&L SUMMARY", es: "RESUMEN P&L" },
  totalIncome: { en: "Total Income", es: "Total Ingresos" },
  grossProfit: { en: "Gross Profit", es: "Utilidad Bruta (Gross Profit)" },
  totalOpexInclFood: { en: "Total OpEx (incl. Food)", es: "Total OpEx (incl. Alimentación)" },
  ofWhichFood: { en: "  of which, Food", es: "  de los cuales, Alimentación" },
  ebitda: { en: "EBITDA", es: "EBITDA" },
  totalPersonalExpenses: { en: "Total Personal Expenses", es: "Total Gastos Personales" },
  netResult: { en: "NET RESULT (Net Income)", es: "RESULTADO NETO (Net Income)" },
  keyIndicators: { en: "KEY INDICATORS (KPIs)", es: "INDICADORES CLAVE (KPIs)" },
  indicator: { en: "INDICATOR", es: "INDICADOR" },
  value: { en: "VALUE", es: "VALOR" },
  interpretation: { en: "INTERPRETATION", es: "INTERPRETACIÓN" },
  reconciledOk: {
    en: "✓ RECONCILED — the classified totals match the bank's own printed summary.",
    es: "✓ CONCILIADO — los totales clasificados cuadran contra el resumen del banco.",
  },
  fullPL: { en: "FULL P&L", es: "P&L COMPLETO" },
  conceptLine: { en: "CONCEPT / LINE", es: "CONCEPTO / LÍNEA" },
  detailSource: { en: "DETAIL / SOURCE", es: "DETALLE / FUENTE" },
  grossProfitCaption: { en: "GROSS PROFIT", es: "UTILIDAD BRUTA (GROSS PROFIT)" },
  revenueMinusCogs: { en: "Revenue − COGS", es: "Revenue − COGS" },
  ebitdaCaption: { en: "EBITDA (Operating Profit)", es: "EBITDA (Utilidad Operativa)" },
  ebitdaFormula: { en: "Gross Profit − OpEx − Food", es: "Gross Profit − OpEx − Alimentación" },
  netIncomeCaption: { en: "NET RESULT (NET INCOME)", es: "RESULTADO NETO (NET INCOME)" },
  netIncomeFormula: { en: "EBITDA − Personal", es: "EBITDA − Personal" },
  alertsRecommendations: { en: "ALERTS & RECOMMENDATIONS", es: "ALERTAS Y RECOMENDACIONES" },
  noAlerts: {
    en: "✓ No alerts — no discrepancies or risk patterns were detected this period.",
    es: "✓ Sin alertas — no se detectaron discrepancias ni patrones de riesgo en este período.",
  },
  footerDisclaimer: {
    en: "P&L based on bank transactions — does not include pending A/R or A/P. Prepare formal financial statements with a CPA for IRS purposes.",
    es: "P&L basado en movimientos bancarios — no incluye CxC/CxP pendientes. Preparar estados formales con CPA para fines IRS.",
  },
  preparedBy: { en: "Prepared by CTRL+ by TaxForYou | www.taxforyou.com", es: "Preparado por CTRL+ by TaxForYou | www.taxforyou.com" },

  // Personal transfer rollup line (Results.tsx / consolidateReport.ts)
  movedPersonalName: {
    en: "Personal transfers & Zelle to family (see Third Party Payments tab)",
    es: "Transferencias personales y Zelle a familiares (ver pestaña Pagos a Terceros)",
  },
  movedPersonalDetail: {
    en: "Included in Total Personal above — itemized separately for 1099 tracking",
    es: "Incluido en el Total Personal de arriba — detallado aparte para el rastreo del 1099",
  },
  checkPrefix: { en: "Check #", es: "Cheque #" },
  payeeNotShown: { en: "Payee not shown", es: "Beneficiario no indicado" },
  zelleTo: { en: "to", es: "a" },
  zelleFrom: { en: "from", es: "de" },

  // Results.tsx page chrome
  profitLoss: { en: "Profit & Loss", es: "Estado de Resultados" },
  noDataTitle: { en: "No data to display", es: "No hay datos para mostrar" },
  noDataDesc: { en: "Upload a document from the Dashboard to generate your P&L report.", es: "Sube un documento desde el Panel para generar tu reporte P&L." },
  reconciledBanner: {
    en: "Reconciled — the classified totals match the bank's own printed summary.",
    es: "Conciliado — los totales clasificados cuadran contra el resumen impreso por el banco.",
  },
  discrepancyBanner: {
    en: "discrepancy(ies) detected against the bank summary — review Alerts & Red Flags.",
    es: "discrepancia(s) detectada(s) contra el resumen del banco — revisa Alertas y Red Flags.",
  },
  financialFlow: { en: "Financial Flow", es: "Flujo Financiero" },
  detailedBreakdown: { en: "Detailed Breakdown", es: "Desglose Detallado" },
  keyIndicatorsHeading: { en: "Key Indicators (KPIs)", es: "Indicadores Clave (KPIs)" },
  alertsRedFlags: { en: "Alerts & Red Flags", es: "Alertas y Red Flags" },
  annualSummaryHeading: { en: "Annual Summary", es: "Resumen Anual" },
  month: { en: "Month", es: "Mes" },
  income: { en: "Income", es: "Ingresos" },
  expenses: { en: "Expenses", es: "Gastos" },
  net: { en: "Net", es: "Neto" },

  // Summary cards / KPI labels
  grossProfitShort: { en: "Gross Profit", es: "Utilidad Bruta" },
  netIncomeShort: { en: "Net Income", es: "Resultado Neto" },
  grossMargin: { en: "Gross Margin", es: "Margen Bruto" },
  ebitdaMargin: { en: "EBITDA Margin", es: "Margen EBITDA" },
  netMargin: { en: "Net Margin", es: "Margen Neto" },
  revenueKpiDesc: { en: "Total revenue detected from the uploaded statement.", es: "Total de ingresos detectado en el extracto subido." },
  grossMarginDesc: { en: "Gross profit as a percentage of revenue.", es: "Utilidad bruta como porcentaje de los ingresos." },
  ebitdaMarginDesc: { en: "Operating profitability after expenses and fees.", es: "Rentabilidad operativa después de gastos y comisiones." },
  netMarginDesc: { en: "Net income after personal or non-deductible expenses.", es: "Resultado neto después de gastos personales o no deducibles." },

  // Excel/PDF full section titles used elsewhere
  foodFull: { en: "Food / Work Meals", es: "Alimentación (Comidas de Trabajo)" },

  // Excel sheet tab names (short — Excel caps tab names at 31 chars, no : \ / ? * [ ])
  tabRevenue: { en: "REVENUE", es: "INGRESOS" },
  tabCogs: { en: "COGS", es: "COGS" },
  tabOtherExpenses: { en: "OTHER EXPENSES", es: "OTROS GASTOS" },
  tabThirdParty: { en: "THIRD PARTY PAYMENTS", es: "PAGOS A TERCEROS" },
  tabExecutiveSummary: { en: "EXECUTIVE SUMMARY", es: "RESUMEN EJECUTIVO" },
  tabFullPL: { en: "FULL P&L", es: "P&L COMPLETO" },
  tabAlerts: { en: "ALERTS & RECOMMENDATIONS", es: "ALERTAS Y RECOMENDACIONES" },
  tabOpex: { en: "OPEX", es: "OPEX" },

  foodBanner: { en: "  FOOD (Work meals — fast food/coffee/snacks)", es: "  ALIMENTACIÓN (Comidas de trabajo — fast food/café/snacks)" },
  accountActivityBanner: { en: "  ACCOUNT ACTIVITY (per bank statement)", es: "  ACTIVIDAD DE LA CUENTA (según extracto bancario)" },
  plSummaryBanner: { en: "  P&L SUMMARY", es: "  RESUMEN P&L" },
  keyIndicatorsBanner: { en: "  KEY INDICATORS (KPIs)", es: "  INDICADORES CLAVE (KPIs)" },
  discrepanciesBanner: {
    en: "⚠ DISCREPANCY(IES) against the bank summary — see ALERTS & RECOMMENDATIONS sheet.",
    es: "⚠ DISCREPANCIA(S) contra el resumen del banco — ver hoja ALERTAS Y RECOMENDACIONES.",
  },
  amountCol: { en: "AMOUNT ($)", es: "MONTO ($)" },
  pctRevCol: { en: "% REV", es: "% REV" },

  // History.tsx (Statement Summary page)
  summaryLabel: { en: "Summary", es: "Resumen" },
  statementWord: { en: "statement", es: "extracto" },
  periodWord: { en: "Period", es: "Período" },
  allYears: { en: "All years", es: "Todos los años" },
  lastQuarter: { en: "Last quarter (3 months)", es: "Último trimestre (3 meses)" },
  last6Months: { en: "Last 6 months", es: "Últimos 6 meses" },
  previousYearWord: { en: "Previous year", es: "Año anterior" },
  yearWord: { en: "Year", es: "Año" },
  downloadExcel: { en: "Download Excel", es: "Descargar Excel" },
  downloadPdf: { en: "Download PDF", es: "Descargar PDF" },
  annualSummaryPrefix: { en: "Annual summary", es: "Resumen anual" },
  generatedOn: { en: "generated automatically on", es: "generado automáticamente el" },
  readyForTaxes: { en: "— ready for taxes.", es: "— listo para impuestos." },
  noAnnualSummaryYet: {
    en: "No annual summary generated yet for this year — the totals above are still accurate (calculated live from your statements); this just builds the saved, ready-for-taxes snapshot.",
    es: "Aún no se ha generado el resumen anual de este año — los totales de arriba siguen siendo correctos (se calculan al momento desde tus extractos); esto solo guarda la versión lista para impuestos.",
  },
  generateAnnualSummary: { en: "Generate annual summary", es: "Generar resumen anual" },
  regenerateAnnualSummary: { en: "Regenerate", es: "Regenerar" },
  generatingAnnualSummary: { en: "Generating…", es: "Generando…" },
  annualSummaryGenerated: { en: "Annual summary generated", es: "Resumen anual generado" },
  couldNotGenerateAnnualSummary: { en: "Could not generate the annual summary.", es: "No se pudo generar el resumen anual." },
  noAnalysesPeriod: { en: "You have no analyses for this period.", es: "No tienes análisis para este período." },
  totalExpensesLabel: { en: "Total Expenses", es: "Egresos Totales" },
  whatWasExpenseFor: { en: "What was the expense for?", es: "¿En qué se hizo el gasto?" },
  pctOfExpense: { en: "% of expense", es: "% del gasto" },
  youHave: { en: "You have", es: "Tienes" },
  periodsWithMultipleSuffix: { en: "period(s) with more than one statement saved", es: "período(s) con más de un extracto guardado" },
  reviewRowsMarked: {
    en: "Review the rows marked below (same month/year) and delete the one that doesn't belong using the trash button, so your accounting doesn't get duplicated.",
    es: "Revisa las filas marcadas abajo (mismo mes/año) y elimina el que no corresponda con el botón de basura, para que la contabilidad no se duplique.",
  },
  statementsForPeriod: { en: "Statements for this period", es: "Extractos del período" },
  noStatements: { en: "No statements.", es: "Sin extractos." },
  fileWord: { en: "File", es: "Archivo" },
  topCategory: { en: "Top category", es: "Top categoría" },
  actionWord: { en: "Action", es: "Acción" },
  viewWord: { en: "View", es: "Ver" },
  statementDeletedTitle: { en: "Statement deleted", es: "Extracto eliminado" },
  wasDeletedSuffix: { en: "was deleted.", es: "fue eliminado." },
  couldNotGenerateFile: { en: "Could not generate the file.", es: "No se pudo generar el archivo." },
  uncategorized: { en: "Uncategorized", es: "Sin categoría" },
  cogsFallback: { en: "COGS / Cost of Goods Sold", es: "COGS / Costo de Ventas" },
  opexFallback: { en: "Operating Expenses (OpEx)", es: "Gastos Operativos (OpEx)" },
  personalFallback: { en: "Personal Expenses", es: "Gastos Personales" },
  feesFallback: { en: "Fees / Commissions", es: "Comisiones / Fees" },
  // Client picker (Dashboard upload + History filter)
  clientLabel: { en: "Client", es: "Cliente" },
  clientPickerPlaceholder: { en: "Select or create a client…", es: "Selecciona o crea un cliente…" },
  clientSearchPlaceholder: { en: "Search or type a new client name…", es: "Busca o escribe un cliente nuevo…" },
  clientEmptyLabel: { en: "No clients found.", es: "No se encontraron clientes." },
  clientCreatePrefix: { en: "Create", es: "Crear" },
  clientRequiredHint: {
    en: "Select or create the client this statement belongs to, so it doesn't get mixed in with other clients' statements.",
    es: "Selecciona o crea el cliente al que pertenece este extracto, para que no se mezcle con los extractos de otros clientes.",
  },
  clientFilterAllLabel: { en: "All clients", es: "Todos los clientes" },
  clientColumnLabel: { en: "Client", es: "Cliente" },
  noClientLabel: { en: "No client", es: "Sin cliente" },
  // Transaction re-assignment ("this was actually a payment to Luisa, a contractor")
  reassignAction: { en: "Reassign", es: "Reasignar" },
  reassignDialogTitle: { en: "Reassign transaction", es: "Reasignar transacción" },
  reassignDialogDesc: {
    en: "Move this transaction to the category it actually belongs to. Totals and reports update immediately.",
    es: "Mueve esta transacción a la categoría a la que realmente pertenece. Los totales y reportes se actualizan de inmediato.",
  },
  reassignCategoryLabel: { en: "New category", es: "Nueva categoría" },
  reassignSave: { en: "Save", es: "Guardar" },
  reassignSaving: { en: "Saving…", es: "Guardando…" },
  reassignCancel: { en: "Cancel", es: "Cancelar" },
  reassignSuccess: { en: "Transaction reassigned.", es: "Transacción reasignada." },
  reassignError: { en: "Could not reassign the transaction.", es: "No se pudo reasignar la transacción." },
  reassignSameCategory: { en: "Choose a different category to move it.", es: "Elige una categoría distinta para moverla." },
  // Saved reports (PDF/Excel kept in storage so they can be reopened later)
  savedReportsTitle: { en: "Saved reports", es: "Reportes guardados" },
  savedReportsDesc: {
    en: "Every PDF/Excel you generate is saved here too, so you can reopen it later without regenerating it.",
    es: "Cada PDF/Excel que generas también queda guardado aquí, para que lo puedas reabrir después sin volver a generarlo.",
  },
  noSavedReports: { en: "No saved reports yet for this selection.", es: "Aún no hay reportes guardados para esta selección." },
  openWord: { en: "Open", es: "Abrir" },
  // Custom date-range calendar filter
  customRangeLabel: { en: "Custom range…", es: "Rango personalizado…" },
  pickDateRange: { en: "Pick a date range", es: "Elige un rango de fechas" },
  applyWord: { en: "Apply", es: "Aplicar" },
} satisfies Record<string, Bilingual>;

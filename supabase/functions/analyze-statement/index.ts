import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// How a statement is analyzed
// ---------------------------
// One AI request writes roughly one classified transaction per second, so a month with 140 Zelle
// deposits used to run past the platform's 150-second limit. Now the statement is split by pages and
// every page is classified at the same time (same model, same rules). In parallel, one request reads
// the account details and the summary box the bank prints. When the pages are done, the merged
// transactions are checked against the bank's totals (a self-check finds anything missing or
// duplicated), a last request writes the insights and alerts from the classified data, and the
// monthly summary and the 1099 list are built in code from the transactions themselves.

/** How every transaction is classified (used by each page and by the self-check). */
const CLASSIFY_PROMPT = `Eres un Contador, Analista Financiero y Preparador de Impuestos EXPERTO, especializado en pequeñas empresas en EE.UU. (Schedule C, LLCs, contratistas, construcción, trucking y servicios). Trabajas para CTRL+ by TaxForYou.

Tu objetivo es convertir el extracto bancario adjunto en datos financieros clasificados, listos para contabilidad y declaración de impuestos.

IDIOMA DE SALIDA: la aplicación permite ver cada reporte en inglés o en español, así que TODO campo de texto libre debe generarse en AMBOS idiomas a la vez, en dos campos paralelos con sufijo "_en" y "_es" (ej. "detail_en" y "detail_es", "insights_en" e "insights_es", "alerts_en" y "alerts_es", "classification_en"/"classification_es", "alert_en"/"alert_es" en thirdPartyPayments, "period_en"/"period_es"). Ambas versiones deben decir exactamente lo mismo, solo cambia el idioma — "_en" en inglés americano (American English), "_es" en español latinoamericano neutro (sin modismos de España). El campo "category" es la ÚNICA excepción — SIEMPRE debe quedar exactamente en inglés, tal cual aparece en las listas de abajo, sin traducir, en un solo campo (no lleva _en/_es), sin importar lo anterior (esto es necesario para que los subtotales por categoría sean consistentes entre extractos, sin importar el idioma en que se subieron).

PASO 1 — DETECTA la industria del negocio (Construcción/Drywall/Remodelación, Transporte/Trucking, Servicios de limpieza, Retail/Reventa, Servicios profesionales, u "Negocio General" si no está claro) según los proveedores y patrones de transacciones. Ajusta la clasificación de gastos según esa industria.

PASO 2 — Clasifica CADA transacción del extracto (no omitas ninguna transacción, procesa el extracto completo). El campo "category" de cada línea DEBE ser EXACTAMENTE una de las etiquetas en INGLÉS de la lista correspondiente de abajo (no inventes etiquetas nuevas, no las traduzcas; si de verdad ninguna aplica, usa la categoría "Other … (specify)" de esa sección ("Other income (specify)", "Other cost of sales (specify)", "Other operating expense (specify)" u "Other personal (specify)") y en "detail_en"/"detail_es" escribe qué es exactamente).

=== INCOME (revenues) — category debe ser una de: ===
- "Bank transfer"
- "Wire transfer"
- "Zelle"
- "Check"
- "Cash deposit"
- "Refunds and returns"
- "Other income (specify)"

=== COGS (costo de ventas) — category debe ser una de: ===
- "Materials"
- "Supplies"
- "Storage"
- "Subcontractor costs"
- "Permits"
- "Other cost of sales (specify)"

=== OPEX (gastos operativos) — category debe ser una de: ===
- "Payroll"
- "Rent (lease or mortgage)"
- "Utilities (electric/water)"
- "Internet"
- "Business insurance"
- "Fuel (work)"
- "Parking"
- "Car insurance"
- "Car payment"
- "Repairs and maintenance"
- "Vehicle expenses"
- "Marketing and advertising"
- "Subscriptions and membership dues"
- "Business software"
- "Website and hosting"
- "Training and development"
- "Licenses and permits"
- "Legal and compliance fees"
- "Professional services"
- "Office supplies"
- "Office furniture and equipment"
- "Operating costs"
- "Bad debts or loans"
- "Travel expenses"
- "Hotels or lodging"
- "Meals (work — fast food/coffee/snacks)"
- "Credit card payment"
- "Business loan"
- "Startup and moving costs"
- "Tolls (work)"
- "Uniforms (work)"
- "Other operating expense (specify)"

=== FEES (comisiones/cargos bancarios) — category debe ser una de: ===
- "Bank fees"

=== PERSONAL (no deducible) — category debe ser una de: ===
- "Clothing"
- "Entertainment"
- "Personal purchases"
- "Zelle to family (no business justification)"
- "Personal bank transfer"
- "Health / personal services"
- "Meals (restaurant/bar)"
- "Other personal (specify)"

REGLA DE COMIDA (importante): comida rápida, café o snacks durante jornada laboral → OPEX con category "Meals (work — fast food/coffee/snacks)". Restaurantes o bares → PERSONAL con category "Meals (restaurant/bar)". En los campos "detail_en" y "detail_es" de cualquier transacción de comida, especifica (en cada idioma respectivamente) si el comercio es un restaurante/bar o un supermercado/tienda, y el nombre del comercio si aparece.

REGLA DE TRANSFERENCIAS PERSONALES (importante): toda transferencia electrónica ("Online Transfer", "Electronic Withdrawal", transferencia a otra cuenta propia, etc.) sin justificación de negocio clara → PERSONAL con category "Personal bank transfer". En los campos "detail_en" y "detail_es" indica el destino/origen tal como aparece en el extracto (nombre del beneficiario, banco/cuenta destino, o "transfer to own account"/"transferencia a cuenta propia") — esto es indispensable para poder rastrear cada transferencia individualmente, ninguna puede quedar sin ese detalle.

REGLA DE DEPÓSITOS = INGRESOS (importante, NUNCA la saltes): TODO el dinero que ENTRA a la cuenta es ingreso y va en REVENUES; el ingreso total del reporte debe ser exactamente igual a los depósitos totales que imprime el banco. Esto incluye las transferencias entrantes desde otras cuentas (ej. "Online Transfer... FROM ****XXXX", "Transfer Mobile FROM ****XXXX", "In-Branch Transfer... FROM ..."), aunque parezcan venir de una cuenta propia: van en REVENUES con category "Bank transfer". Un desembolso de línea de crédito (ej. "Credit Line ADV") también entra a la cuenta: va en REVENUES con category "Other income (specify)". En "detail_en"/"detail_es" anota el origen tal como aparece (ej. "transferencia desde la cuenta ****4612", "avance de línea de crédito"). NUNCA clasifiques un depósito como gasto (ni PERSONAL, ni OPEX, ni COGS, ni FEES): "Personal bank transfer" es solo para dinero que SALE de la cuenta.

REGLA DE TARJETA DE CRÉDITO Y PRÉSTAMOS DE NEGOCIO (importante): un pago SALIENTE que sea (a) el pago del saldo/mínimo de una tarjeta de crédito (ej. "Credit Card Pmt", "Online Credit Card Pmt", "Payment to ****XXXX" ligado a un emisor de tarjeta) → OPEX con category "Credit card payment"; o (b) el pago de una cuota de un préstamo/línea de crédito de negocio, incluyendo pagos a una línea de crédito rotativa (ej. "Credit Line Pmt", "Loan Payment", "Business Loan Pmt", "SBA Loan") → OPEX con category "Business loan". No los confundas con un AVANCE/desembolso de línea de crédito (ese es un depósito y sigue la regla de arriba, nunca es gasto); esto aplica solo a PAGOS salientes que reducen la deuda.

REGLA DE DEVOLUCIONES Y REEMBOLSOS (importante, NUNCA la saltes): un DEPÓSITO/crédito que sea la devolución, reembolso o reverso de un gasto de negocio que ya se había hecho (ej. "DEBIT CARD RETURN", "REFUND", "CREDIT ADJUSTMENT", "REVERSAL", casi siempre ligado al nombre de un proveedor/comercio) es dinero que vuelve a entrar a la cuenta, no un gasto — NUNCA lo clasifiques como gasto (ni PERSONAL, ni OPEX, ni COGS, ni FEES), eso invertiría la dirección real del dinero y haría que el resultado neto se vea peor de lo que realmente es. Clasifícalo en REVENUES con category "Refunds and returns" (el dinero regresó a la cuenta, por eso es ingreso y nunca gasto), sin importar el proveedor; también aplica a "PURCHASE RETURN", "MERCHANT CREDIT", "REVERSAL", "CREDIT ADJUSTMENT", "REFUND" y a "devolución"/"reembolso". (Un cargo por cheque devuelto o por fondos insuficientes SÍ es gasto bancario: eso no es una devolución.) En "detail_en"/"detail_es" aclara que es una devolución/reembolso de un gasto anterior y no un pago de cliente nuevo (ej. detail_en="Refund from [proveedor], not new revenue" / detail_es="Reembolso de [proveedor], no es ingreso nuevo").

Si algo no está claro, clasifícalo de todas formas en la categoría más probable (sin agregar una alerta individual por eso — las alertas se generan aparte, en el Paso 5, solo para patrones que de verdad importan).

Pagos por Zelle deben listarse individualmente (uno por transacción), nunca agrupados en las tablas de revenues/cogs/opex/fees/personal — pero en "alerts" sí deben agruparse por patrón (ver Paso 5).

FIDELIDAD AL EXTRACTO (obligatorio): el reporte debe reflejar EXACTAMENTE lo que dice el extracto del banco. Cada línea del extracto aparece UNA SOLA VEZ en UNA SOLA categoría: nunca repitas una transacción en dos listas ni la dividas. Si el extracto muestra dos transacciones idénticas (misma fecha, monto y comercio), son dos transacciones reales: inclúyelas las dos. Copia fecha, descripción y monto exactamente como aparecen, sin redondear ni corregir.

IMPORTANTE — NO OMITAS NINGUNA TRANSACCIÓN: procesa absolutamente todas las líneas del extracto, incluyendo transferencias electrónicas banco-a-banco ("Online Transfer", "Electronic Withdrawal", transferencias a otra cuenta propia, etc.) — estas van en PERSONAL con category "Personal bank transfer" si no tienen justificación de negocio clara. Nunca dejes una transacción sin clasificar ni la excluyas del JSON final.

PASO 3 — CONTRAPARTE (campo "counterparty" de cada transacción). Con este campo se arma automáticamente el reporte de pagos a terceros (formularios 1099), así que nunca lo dejes vacío cuando aplica:
  - Pagos por ZELLE, entrantes o salientes: el nombre de la persona o empresa que envía o recibe el dinero, tal como aparece, SIN el código de referencia del banco (ej. "Zelle payment from delia villar rivera wfct0yhfwcm5" → "delia villar rivera").
  - CHEQUES EMITIDOS por el negocio (dinero que sale): solo el número de cheque, tal como aparece (ej. "1787").
  - Cualquier otra transacción (incluidos los cheques recibidos o depositados): cadena vacía "".

REGLAS OBLIGATORIAS:
- No inventes transacciones que no estén en el documento.
- No omitas transacciones, procesa el extracto completo.
- Usa montos siempre positivos (sin signo negativo) en el campo "amt".
- El campo "date" usa el formato del extracto tal cual aparece (o vacío si no es legible).
- El campo "category" debe ser EXACTAMENTE una de las etiquetas listadas arriba para esa sección — esto es crítico para que los subtotales anuales por categoría sean consistentes entre meses.
- Los campos "detail_en" y "detail_es" son OPCIONALES y deben ser muy breves (máx. 6 palabras, ej. nombre del comercio). Si no aportan nada útil, déjalos como cadena vacía "" en ambos — no rellenes con texto innecesario.`;
/** The bank-totals rule, used by the self-check. */
const BANK_RECONCILE_RULE = `CUADRE OBLIGATORIO CON EL BANCO (crítico: eres un analista financiero y de datos que no puede equivocarse con los números): antes de responder verifica con aritmética: (1) saldo inicial + depósitos totales − retiros totales = saldo final impreso por el banco; (2) la suma de revenues (TODO lo que ENTRA a la cuenta) debe ser igual a los depósitos totales del banco; (3) la suma de cogs + opex + fees + personal (TODO lo que SALE) debe ser igual a los retiros totales del banco. Si no cuadra, vuelve a revisar el extracto línea por línea hasta encontrar la transacción faltante, duplicada o mal clasificada. Nunca inventes ni ajustes un monto para que cuadre: copia cada número exactamente como lo imprime el banco.`;
const INSIGHTS_ALERTS_RULES = `PASO 4 — Genera "insights_en" e "insights_es": 3 a 4 observaciones breves y accionables sobre la salud financiera del negocio (ej. margen bruto, categoría de mayor gasto, tendencia). Ambos arreglos deben decir exactamente lo mismo, uno en inglés y otro en español.

PASO 5 — Genera "alerts_en" y "alerts_es": MÁXIMO 5 alertas en total, priorizando solo lo que de verdad importa para el negocio o para impuestos (ambos arreglos con el mismo contenido, uno por idioma):
  - Montos individuales grandes (>$500) sin descripción de negocio clara.
  - Patrones repetidos (ej. "múltiples pagos Zelle a individuos sin descripción de negocio, total $X" — UNA sola alerta agrupando todos esos casos, no una por transacción).
  - Posibles pagos duplicados.
  - Gastos personales grandes mezclados con la cuenta de negocio.
  No generes una alerta por cada transacción ambigua individual — agrupa. No agregues alertas para transacciones pequeñas, rutinarias o ya bien identificadas. Si de verdad no hay nada que reportar, incluye una sola nota breve (en ambos idiomas) indicando que todo está en orden (no la mezcles con las alertas de riesgo).`;
const BANK_SUMMARY_RULES = `PASO 7 — Busca en el extracto un recuadro de resumen impreso por el propio banco (ej. "Checking Summary", "Account Summary") con Saldo inicial, Depósitos y adiciones, Cheques pagados, Retiros con tarjeta/ATM, Retiros electrónicos y Saldo final — casi siempre con instancias y monto de cada uno. Genera "bankSummary" copiando esos valores TAL COMO los imprime el banco — NUNCA los calcules ni los infieras sumando las transacciones que ya clasificaste, es una verificación cruzada independiente para detectar transacciones que se te hayan escapado.
  - Si el recuadro existe: "found"=true, y llena cada campo presente con el número exacto impreso.
  - Si un campo específico no aparece impreso por separado (ej. el banco no distingue "Retiros electrónicos" de otros retiros — usa "otherWithdrawals" para retiros que no encajen en las demás categorías del resumen del banco): usa -1 tanto en "instances" como en "amount" de ese campo — NUNCA uses 0, porque 0 significaría que el banco reportó cero.
  - Si el extracto no trae ningún recuadro de resumen del banco: "found"=false y usa -1 en TODOS los campos numéricos de "bankSummary".`;
const PERIOD_COMPANY_RULES = `- "period" es el rango de fechas del extracto tal como aparece (ej. "Enero 2026" o "01/01/2026 - 01/31/2026") — este campo es interno (para agrupar extractos), no se le muestra al usuario, así que no necesita traducción.
- "period_en" y "period_es" SÍ se le muestran al usuario, así que deben ser una versión legible del mismo rango de fechas, redactada en cada idioma con el nombre del mes escrito (nunca uses nombres de mes en inglés en "period_es" ni viceversa) — ej. si el extracto cubre del 1 al 28 de febrero de 2025: "period_en"="February 1, 2025 through February 28, 2025", "period_es"="1 de febrero de 2025 al 28 de febrero de 2025". Si el extracto solo trae un mes/año sin días exactos, usa igual el formato largo en cada idioma (ej. "period_en"="February 2025", "period_es"="Febrero 2025").
- "company" es el nombre del titular de la cuenta o negocio si aparece en el extracto; si no aparece, usa cadena vacía.`;

const OVERVIEW_PROMPT = `Lees extractos bancarios de pequeñas empresas en EE.UU. para CTRL+ by TaxForYou. NO clasifiques transacciones (eso se hace aparte). Del extracto adjunto extrae SOLO estos datos, copiados exactos tal como los imprime el banco; nunca los calcules ni los infieras sumando transacciones:
- bankName: nombre del banco ("" si no aparece).
- accountHolder: titular de la cuenta tal como aparece ("" si no aparece).
- accountNumberLast4: SOLO los últimos 4 dígitos del número de cuenta, nunca el número completo ("" si no aparecen).
- beginningBalance: saldo inicial / anterior impreso ("Beginning Balance", "Previous Balance", "Opening Balance", "Saldo inicial", "Saldo anterior"); puede ser negativo si hay sobregiro. Usa -999999999 (nunca 0) si NO está impreso.
- endingBalance: saldo final impreso ("Ending Balance", "Saldo final"). Usa -999999999 si NO está impreso.
- periodStart: primer día del período que cubre el extracto, en formato AAAA-MM-DD (ej. "2025-01-01"); "" si no aparece.
- periodEnd: último día del período que cubre el extracto, en formato AAAA-MM-DD (ej. "2025-01-31"); "" si no aparece.
- annualYear: el año que cubre el extracto (ej. "2025").
- industry: la industria del negocio, en inglés (ej. "Construction", "Trucking", "Cleaning services", "Retail", "Professional services", "Transportation" o "General business"), según el nombre del titular, los proveedores y los patrones de las transacciones.
- bankSummary: sigue estas reglas.
${BANK_SUMMARY_RULES}
${PERIOD_COMPANY_RULES}`;

const SYNTHESIS_PROMPT = `Eres un Contador y Analista Financiero EXPERTO en pequeñas empresas en EE.UU. (Schedule C, LLCs, contratistas, construcción, trucking y servicios) y trabajas para CTRL+ by TaxForYou. Recibes las transacciones de un extracto bancario YA clasificadas, una por línea (fecha | descripción | monto | categoría | detalle), agrupadas por sección con su total. Trabaja SOLO con esos datos: no inventes transacciones, montos ni hechos que no estén ahí. Cada texto va en dos arreglos paralelos con el mismo contenido: "_en" en inglés americano y "_es" en español latinoamericano neutro.

${INSIGHTS_ALERTS_RULES}`;

/** What each page is told about the part of the statement it holds. */
const pageInstructions = (where: string) => `${where} Clasifica TODAS las transacciones impresas en esas páginas según las instrucciones (pasos 2 y 3). Reglas de este fragmento:
- Si una página empieza con transacciones que continúan una sección de la página anterior (ej. "(continuación)", "continued"), usa ese encabezado o las columnas (depósitos/créditos vs. retiros/débitos) para saber si el dinero entra o sale.
- No tomes como transacciones los totales del resumen del banco, los subtotales de cada sección, la tabla de saldos diarios ni los resúmenes de tarjeta.
- Las imágenes de cheques pagados son copias de cheques que ya aparecen en la lista de transacciones: NUNCA las agregues como transacciones. Solo anota en "checkImages" el número de cheque y el beneficiario ("Pay to the order of") que se lean en cada imagen; si no hay imágenes de cheques, "checkImages" va vacío.
- Si esas páginas no tienen líneas de transacciones (solo avisos, resúmenes, saldos o páginas en blanco), devuelve todas las listas vacías.
- No intentes cuadrar con los totales del banco en este fragmento: el cuadre se hace después con el extracto completo. Nunca agregues, quites ni ajustes una transacción para que cuadre.`;

const SECTIONS = ["revenues", "cogs", "opex", "fees", "personal"] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<Section, string> = {
  revenues: "INGRESOS (revenues: todo el dinero que entra)",
  cogs: "COSTO DE VENTAS (cogs)",
  opex: "GASTOS OPERATIVOS (opex)",
  fees: "COMISIONES BANCARIAS (fees)",
  personal: "PERSONAL (no deducible)",
};

const lineItemSchema = {
  type: "object",
  properties: {
    date: { type: "string" },
    desc: { type: "string" },
    amt: { type: "number" },
    category: { type: "string" },
    detail_en: { type: "string" },
    detail_es: { type: "string" },
    counterparty: { type: "string" },
  },
  required: ["date", "desc", "amt", "category", "detail_en", "detail_es", "counterparty"],
  additionalProperties: false,
};

const PAGE_SCHEMA = {
  type: "object",
  $defs: { lineItem: lineItemSchema },
  properties: {
    revenues: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    cogs: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    opex: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    fees: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    personal: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    checkImages: {
      type: "array",
      items: {
        type: "object",
        properties: { checkNumber: { type: "string" }, payee: { type: "string" } },
        required: ["checkNumber", "payee"],
        additionalProperties: false,
      },
    },
  },
  required: ["revenues", "cogs", "opex", "fees", "personal", "checkImages"],
  additionalProperties: false,
};

const bankSummaryFieldSchema = {
  type: "object",
  properties: {
    instances: { type: "number" },
    amount: { type: "number" },
  },
  required: ["instances", "amount"],
  additionalProperties: false,
};

const bankSummarySchema = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    beginningBalance: { type: "number" },
    endingBalance: { type: "number" },
    deposits: { $ref: "#/$defs/bankSummaryField" },
    checksPaid: { $ref: "#/$defs/bankSummaryField" },
    atmDebitWithdrawals: { $ref: "#/$defs/bankSummaryField" },
    electronicWithdrawals: { $ref: "#/$defs/bankSummaryField" },
    otherWithdrawals: { $ref: "#/$defs/bankSummaryField" },
  },
  required: [
    "found", "beginningBalance", "endingBalance",
    "deposits", "checksPaid", "atmDebitWithdrawals", "electronicWithdrawals", "otherWithdrawals",
  ],
  additionalProperties: false,
};

const OVERVIEW_SCHEMA = {
  type: "object",
  $defs: { bankSummaryField: bankSummaryFieldSchema, bankSummary: bankSummarySchema },
  properties: {
    company: { type: "string" },
    period: { type: "string" },
    period_en: { type: "string" },
    period_es: { type: "string" },
    industry: { type: "string" },
    annualYear: { type: "string" },
    bankName: { type: "string" },
    accountHolder: { type: "string" },
    accountNumberLast4: { type: "string" },
    beginningBalance: { type: "number" },
    endingBalance: { type: "number" },
    periodStart: { type: "string" },
    periodEnd: { type: "string" },
    bankSummary: { $ref: "#/$defs/bankSummary" },
  },
  required: [
    "company", "period", "period_en", "period_es", "industry", "annualYear",
    "bankName", "accountHolder", "accountNumberLast4", "beginningBalance", "endingBalance", "periodStart", "periodEnd",
    "bankSummary",
  ],
  additionalProperties: false,
};

const SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    insights_en: { type: "array", items: { type: "string" } },
    insights_es: { type: "array", items: { type: "string" } },
    alerts_en: { type: "array", items: { type: "string" } },
    alerts_es: { type: "array", items: { type: "string" } },
  },
  required: ["insights_en", "insights_es", "alerts_en", "alerts_es"],
  additionalProperties: false,
};

const PATCH_SCHEMA = {
  type: "object",
  $defs: { lineItem: lineItemSchema },
  properties: {
    remove: { type: "array", items: { type: "integer" } },
    add: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section: { type: "string", enum: [...SECTIONS] },
          item: { $ref: "#/$defs/lineItem" },
        },
        required: ["section", "item"],
        additionalProperties: false,
      },
    },
  },
  required: ["remove", "add"],
  additionalProperties: false,
};

const decodeBase64Text = (b64: string) => new TextDecoder("utf-8").decode(base64ToBytes(b64));

const base64ToBytes = (b64: string) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const xlsxToText = (b64: string) => {
  const wb = XLSX.read(base64ToBytes(b64), { type: "array" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    parts.push(`--- Sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  return parts.join("\n\n");
};

const TRANSFER_IN_CATEGORY = "Transfer in (not income)";

const moneyNumber = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.abs(n) : 0;
};
const sumAmounts = (list: unknown) =>
  (Array.isArray(list) ? list : []).reduce((s: number, it: any) => s + moneyNumber(it?.amt), 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const printed = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

// How far the classified transactions are from the totals the bank itself printed (null when the
// statement has no usable summary). deposits: bank - classified; withdrawals: classified - bank.
const reconcileGaps = (r: any) => {
  const b = r?.bankSummary;
  if (!b?.found) return null;
  const deposits = printed(b.deposits?.amount);
  if (deposits === null) return null;
  const parts = [b.checksPaid, b.atmDebitWithdrawals, b.electronicWithdrawals, b.otherWithdrawals].map((p: any) => printed(p?.amount));
  const opening = printed(b.beginningBalance);
  const closing = printed(b.endingBalance);
  const bankOut = parts.every((p) => p !== null)
    ? (parts as number[]).reduce((s, v) => s + v, 0)
    : opening !== null && closing !== null
    ? opening + deposits - closing
    : null;
  if (bankOut === null) return null;
  const personal = Array.isArray(r.personal) ? r.personal : [];
  const transfers = personal.filter((it: any) => it?.category === TRANSFER_IN_CATEGORY);
  const classifiedIn = sumAmounts(r.revenues) + sumAmounts(transfers);
  const classifiedOut = sumAmounts(r.cogs) + sumAmounts(r.opex) + sumAmounts(r.fees) + sumAmounts(personal) - sumAmounts(transfers);
  const depositsDelta = round2(deposits - classifiedIn);
  const withdrawalsDelta = round2(classifiedOut - bankOut);
  return { depositsDelta, withdrawalsDelta, score: Math.abs(depositsDelta) + Math.abs(withdrawalsDelta) };
};

/** How many transactions the bank says the statement has (its summary's counts), when it prints them. */
const expectedTransactions = (b: any): number | null => {
  if (!b?.found) return null;
  const n = [b.deposits, b.checksPaid, b.atmDebitWithdrawals, b.electronicWithdrawals, b.otherWithdrawals]
    .map((f: any) => (typeof f?.instances === "number" && f.instances > 0 ? f.instances : 0))
    .reduce((s: number, v: number) => s + v, 0);
  return n > 0 ? Math.round(n) : null;
};

// ---- 1099 list (checks and Zelle), built from the classified transactions -------------------------

const ZELLE = /zelle/i;
const checkNumberOf = (desc: unknown): string | null => {
  const m = String(desc ?? "").match(/\b(?:check|cheque|chk)\b\s*(?:no\.?|#)?\s*(\d{2,})/i);
  return m ? m[1] : null;
};
const zelleName = (item: any): string => {
  const named = String(item?.counterparty ?? "").trim();
  if (named) return named;
  const m = String(item?.desc ?? "").match(/zelle\s+(?:payment\s+)?(?:from|to)\s+(.+)$/i);
  // The bank adds a reference code after the name (e.g. "wfct0yhfwcm5", "23594203121").
  return m ? m[1].replace(/\s+\S*\d\S*$/, "").trim() : "";
};
const partyLabel = (section: Section, category: string): [string, string] => {
  if (section === "revenues") return category === "Refunds and returns" ? ["Refund received", "Reembolso recibido"] : ["Client payment", "Pago de cliente"];
  if (category === "Subcontractor costs") return ["Possible 1099 — subcontractor", "Posible 1099 — subcontratista"];
  if (category === "Professional services" || category === "Legal and compliance fees") return ["Possible 1099 — services", "Posible 1099 — servicios"];
  if (category === "Rent (lease or mortgage)") return ["Possible 1099 — rent", "Posible 1099 — arriendo"];
  // Payroll sent by Zelle or check, with nothing withheld, is usually a worker who needs a 1099.
  if (category === "Payroll") return ["Possible 1099 — worker", "Posible 1099 — trabajador"];
  if (category === "Zelle to family (no business justification)") return ["Payment to family", "Pago a familiar"];
  if (section === "personal") return ["Personal payment", "Pago personal"];
  return ["Business payment — review 1099", "Pago de negocio — revisar 1099"];
};
/** One entry per Zelle payment (in or out) and per check the business wrote, as the 1099 list expects. */
const buildThirdPartyPayments = (r: any, checkPayees: Map<string, string>) => {
  const out: any[] = [];
  for (const section of SECTIONS) {
    for (const item of Array.isArray(r[section]) ? r[section] : []) {
      const desc = String(item?.desc ?? "");
      const category = String(item?.category ?? "");
      const [classification_en, classification_es] = partyLabel(section, category);
      const base = { date: String(item?.date ?? ""), amt: moneyNumber(item?.amt), category, classification_en, classification_es, alert_en: "", alert_es: "" };
      if (ZELLE.test(desc) || ZELLE.test(category)) {
        out.push({ method: "Zelle", direction: section === "revenues" ? "incoming" : "outgoing", identifier: zelleName(item) || desc.slice(0, 80), payee: "", ...base });
        continue;
      }
      if (section === "revenues") continue; // checks received are income, not payments to others
      const counterparty = String(item?.counterparty ?? "").trim();
      const number = checkNumberOf(desc) ?? (/^\d{2,}$/.test(counterparty) ? counterparty : null);
      if (number) out.push({ method: "Check", direction: "outgoing", identifier: number, payee: checkPayees.get(number) ?? "", ...base });
    }
  }
  return out;
};

/** Pages are classified separately, so the same person paid on two pages can come back with two
 * different categories. When one category has a clear majority among that person's payments, all of
 * them take it (money coming in is never mixed with money going out). Returns how many changed. */
const harmonizeCounterparties = (r: any) => {
  const groups = new Map<string, { section: Section; item: any }[]>();
  for (const section of SECTIONS) {
    for (const item of r[section]) {
      const name = String(item?.counterparty ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      if (!name || /^\d+$/.test(name)) continue;
      const key = `${section === "revenues" ? "in" : "out"}|${name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ section, item });
    }
  }
  let changed = 0;
  const moved: { from: Section; to: Section; item: any }[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const votes = new Map<string, number>();
    for (const m of members) {
      const k = `${m.section}|${m.item?.category ?? ""}`;
      votes.set(k, (votes.get(k) ?? 0) + 1);
    }
    if (votes.size < 2) continue;
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked[0][1] === ranked[1][1]) continue; // no clear majority: leave them as classified
    const [winSection, winCategory] = [ranked[0][0].slice(0, ranked[0][0].indexOf("|")) as Section, ranked[0][0].slice(ranked[0][0].indexOf("|") + 1)];
    for (const m of members) {
      if (m.section === winSection && m.item.category === winCategory) continue;
      m.item.category = winCategory;
      if (m.section !== winSection) moved.push({ from: m.section, to: winSection, item: m.item });
      changed++;
    }
  }
  for (const { from, to, item } of moved) {
    r[from] = r[from].filter((x: any) => x !== item);
    r[to].push(item);
  }
  return changed;
};

// ---- Monthly summary, from the transactions' own dates -------------------------------------------

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthKeyOf = (date: unknown, periodStart: string, periodEnd: string): string | null => {
  const s = String(date ?? "").trim().toLowerCase();
  const start = periodStart.match(/^(\d{4})-(\d{2})/);
  const end = periodEnd.match(/^(\d{4})-(\d{2})/);
  const yearFor = (month: number) => {
    if (start && end && start[1] !== end[1]) return month >= Number(start[2]) ? Number(start[1]) : Number(end[1]);
    return Number((end ?? start)?.[1]) || null;
  };
  let m = s.match(/^(\d{4})-(\d{1,2})-\d{1,2}/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  let month: number | null = null;
  let year: number | null = null;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (m) {
    month = Number(m[1]);
    if (m[3]) year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  } else {
    const named = s.match(/^([a-z]{3})[a-z]*\.?\s+\d{1,2}(?:,?\s+(\d{4}))?/);
    if (named && MONTH_NAMES.includes(named[1])) {
      month = MONTH_NAMES.indexOf(named[1]) + 1;
      if (named[2]) year = Number(named[2]);
    }
  }
  if (!month || month < 1 || month > 12) return null;
  year = year ?? yearFor(month);
  return year ? `${year}-${String(month).padStart(2, "0")}` : null;
};
const monthlySummary = (r: any, periodStart: string, periodEnd: string) => {
  const fallback = (periodEnd || periodStart).slice(0, 7);
  const months = new Map<string, { revenue: number; expenses: number }>();
  for (const section of SECTIONS) {
    for (const item of Array.isArray(r[section]) ? r[section] : []) {
      const key = monthKeyOf(item?.date, periodStart, periodEnd) ?? fallback;
      if (!key) continue;
      const m = months.get(key) ?? { revenue: 0, expenses: 0 };
      if (section === "revenues") m.revenue += moneyNumber(item?.amt);
      else m.expenses += moneyNumber(item?.amt);
      months.set(key, m);
    }
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({ month, revenue: round2(m.revenue), expenses: round2(m.expenses), net: round2(m.revenue - m.expenses) }));
};

// ---- The same statement can't be analyzed twice -----------------------------------------------------
// Three fingerprints, all checked here on the server (and again by the database when the page saves):
//  - file_hash: SHA-256 of the file itself (the same PDF, even renamed) — checked before any AI work;
//  - statement_key: account (last 4), period and opening/closing balances as the bank printed them —
//    checked as soon as the account details are read, which stops the rest of the reading;
//  - content_hash: the transactions themselves (month-day and amount of each) — checked at the end.
// statement_key must stay identical to statementKey() in src/utils/statementIdentity.ts.

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");

const US_RANGE = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:-|–|—|to|al|a)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
const ISO_RANGE = /(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:-|–|—|to|al|a)\s*(\d{4})-(\d{1,2})-(\d{1,2})/i;
const pad2 = (n: string | number) => String(n).padStart(2, "0");
const isoDay = (v: unknown) => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const headerBalance = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > -999999990 ? v : null);
const boxBalance = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v !== -1 ? v : null);
const statementKeyOf = (src: any): string | null => {
  const info = src?.accountInfo || {};
  const box = src?.bankSummary?.found ? src.bankSummary : {};
  let start = isoDay(info.periodStart);
  let end = isoDay(info.periodEnd);
  if (!start || !end) {
    const text = String(src?.period || "");
    const us = text.match(US_RANGE);
    const iso = text.match(ISO_RANGE);
    if (us) {
      start = `${us[3]}-${pad2(us[1])}-${pad2(us[2])}`;
      end = `${us[6]}-${pad2(us[4])}-${pad2(us[5])}`;
    } else if (iso) {
      start = `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
      end = `${iso[4]}-${pad2(iso[5])}-${pad2(iso[6])}`;
    }
  }
  const opening = headerBalance(info.beginningBalance) ?? boxBalance(box.beginningBalance);
  const closing = headerBalance(info.endingBalance) ?? boxBalance(box.endingBalance);
  if (!start || !end || opening === null || closing === null) return null;
  const last4 = String(info.accountNumberLast4 || "").replace(/\D/g, "").slice(-4) || "----";
  return [last4, start, end, opening.toFixed(2), closing.toFixed(2)].join("|");
};

/** "MM-DD" of a transaction date as statements print it ("02/03", "2/3/25", "2025-02-03", "Feb 3"). */
const monthDayOf = (date: unknown): string | null => {
  const s = String(date ?? "").trim().toLowerCase();
  let m = s.match(/^\d{4}-(\d{1,2})-(\d{1,2})/);
  if (m) return `${pad2(m[1])}-${pad2(m[2])}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})/);
  if (m) return `${pad2(m[1])}-${pad2(m[2])}`;
  const named = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b/);
  if (named && MONTH_NAMES.includes(named[1])) return `${pad2(MONTH_NAMES.indexOf(named[1]) + 1)}-${pad2(named[2])}`;
  return null;
};
/** SHA-256 of the statement's transactions (month-day and cents of each, sorted). Null when a date
 * can't be read or there are fewer than 5 transactions (too little to tell two statements apart). */
const contentHashOf = async (r: any): Promise<string | null> => {
  const entries: string[] = [];
  for (const list of [...SECTIONS, "transfersIn"]) {
    for (const item of Array.isArray(r?.[list]) ? r[list] : []) {
      const day = monthDayOf(item?.date);
      if (!day) return null;
      entries.push(`${day}|${Math.round(moneyNumber(item?.amt) * 100)}`);
    }
  }
  if (entries.length < 5) return null;
  entries.sort();
  return sha256Hex(new TextEncoder().encode(`v1|${entries.join("\n")}`));
};

const duplicateMessage = (where: string) =>
  `Este extracto ya está en el sistema${where ? ` (${where})` : ""}. No se puede analizar dos veces, aunque el archivo tenga otro nombre o se haya descargado de nuevo del banco.`;

/** Looks for a statement already saved with this fingerprint, across every client (the page may not see
 * other people's clients). Returns where it is — client and period when this person can see it, "" when
 * not — or null when there is none. Lookup errors don't block: the database refuses duplicates again when
 * the page saves. */
type DuplicateLookup = (column: "file_hash" | "statement_key" | "content_hash", value: string | null) => Promise<string | null>;

// ---- Calling Claude ----------------------------------------------------------------------------

// Model that classifies statements, set with the ANALYZE_MODEL secret. Claude Opus 5.5 always thinks,
// so it gets an effort level (ANALYZE_EFFORT, default "low") and room for its thinking.
const STATEMENT_MODEL = Deno.env.get("ANALYZE_MODEL") || "claude-sonnet-5";
const THINKING_OFF = STATEMENT_MODEL === "claude-sonnet-5";
const modelSettings = (schema: unknown, maxTokens: number) =>
  THINKING_OFF
    ? { model: STATEMENT_MODEL, max_tokens: maxTokens, thinking: { type: "disabled" }, output_config: { format: { type: "json_schema", schema } } }
    : {
        model: STATEMENT_MODEL,
        max_tokens: Math.max(maxTokens * 2, 4000),
        fallbacks: "default",
        output_config: { effort: Deno.env.get("ANALYZE_EFFORT") || "low", format: { type: "json_schema", schema } },
      };
// The platform stops a function at its wall-clock limit (150 s on Supabase Free, 400 s on paid
// plans). Every AI call is aborted before that, so the person always gets an answer instead of a
// dropped connection. On a paid plan raise ANALYZE_DEADLINE_MS (e.g. 330000) in the function secrets.
const DEADLINE_MS = Number(Deno.env.get("ANALYZE_DEADLINE_MS") || 140_000);
// How many parts of a statement are classified at the same time (pages are grouped beyond this).
const MAX_PARALLEL = Math.max(1, Number(Deno.env.get("ANALYZE_MAX_PARALLEL") || 10));

/** An error whose message is already written for the person who uploaded the statement. */
class UserFacingError extends Error {}

class AnthropicCallError extends Error {
  constructor(public status: number, public body: string, public retryAfterSec: number | null) {
    super(`Anthropic API error ${status}`);
  }
}

const TIMEOUT_MESSAGE =
  "El análisis tardó demasiado y se detuvo antes de terminar. Vuelve a intentarlo en un momento; si el extracto tiene muchas páginas, súbelo por meses o en partes más cortas.";
const REFUSAL_MESSAGE =
  "La IA no pudo leer este documento. Verifica que sea el extracto bancario original en PDF (no una foto borrosa ni un archivo protegido) y vuelve a intentarlo.";
const TOO_MANY_MESSAGE =
  "El extracto tiene demasiadas transacciones para analizarlo de una vez. Súbelo por meses o en partes más cortas.";

const isAbort = (error: unknown) => (error as { name?: string })?.name === "AbortError";

const userMessageFor = (error: unknown): string => {
  if (error instanceof UserFacingError) return error.message;
  if (isAbort(error)) return TIMEOUT_MESSAGE;
  return "No se pudo completar el análisis por un error inesperado. Vuelve a intentarlo; si se repite, avísale al administrador.";
};

const anthropicErrorMessage = (status: number, body: string): string => {
  const t = body.toLowerCase();
  if (t.includes("credit balance")) return "La cuenta de la IA se quedó sin saldo. Avísale al administrador para que la recargue.";
  if (status === 429 || status === 529 || t.includes("overloaded")) return "El servicio de IA está saturado en este momento. Espera un minuto y vuelve a intentarlo.";
  if (status === 401 || status === 403) return "El servidor no pudo conectarse con la IA (clave de acceso rechazada). Avísale al administrador.";
  if (!t.includes("grammar") && (status === 413 || t.includes("too long") || t.includes("too large"))) {
    return "El extracto es demasiado grande para analizarlo de una vez. Súbelo por meses o en partes más cortas.";
  }
  return `El análisis con IA falló (código ${status}). Vuelve a intentarlo en un momento; si se repite, avísale al administrador.`;
};

interface StreamHooks {
  onStart?: () => void;
  onText?: (delta: string) => void;
  onRetry?: () => void;
}

/** One streamed request to Claude. Returns the full text and why it stopped; throws on HTTP or stream errors. */
const streamClaude = async (apiKey: string, body: Record<string, unknown>, deadlineAt: number, cancel: AbortSignal, hooks: StreamHooks) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()));
  const onCancel = () => controller.abort();
  if (cancel.aborted) controller.abort();
  cancel.addEventListener("abort", onCancel);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...("fallbacks" in body ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new AnthropicCallError(response.status, await response.text().catch(() => ""), Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let text = "";
    let stopReason: string | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let data = "";
        for (const line of block.split("\n")) if (line.startsWith("data:")) data += line.slice(5).trim();
        if (!data) continue;
        let event: any;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.type === "message_start") hooks.onStart?.();
        else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          // After a mid-answer fallback the next model continues the same text, so every text delta
          // of the message belongs to the one JSON answer.
          text += event.delta.text;
          hooks.onText?.(event.delta.text);
        } else if (event.type === "message_delta" && event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        else if (event.type === "error") {
          const kind = event.error?.type;
          throw new AnthropicCallError(kind === "overloaded_error" ? 529 : kind === "rate_limit_error" ? 429 : 500, JSON.stringify(event.error ?? {}), null);
        }
      }
    }
    return { text, stopReason };
  } finally {
    clearTimeout(timer);
    cancel.removeEventListener("abort", onCancel);
  }
};

/** A request whose answer is JSON in the given schema. Retries busy/failed calls while there is time. */
const callStructured = async (apiKey: string, body: Record<string, unknown>, deadlineAt: number, cancel: AbortSignal, hooks: StreamHooks = {}): Promise<any> => {
  for (let attempt = 1; ; attempt++) {
    let failure: unknown;
    try {
      const { text, stopReason } = await streamClaude(apiKey, body, deadlineAt, cancel, hooks);
      if (stopReason === "refusal") throw new UserFacingError(REFUSAL_MESSAGE);
      if (stopReason === "max_tokens") throw new UserFacingError(TOO_MANY_MESSAGE);
      try {
        return JSON.parse(text);
      } catch {
        failure = new Error(`unreadable answer (stop_reason ${stopReason}, ${text.length} chars)`);
      }
    } catch (error) {
      if (error instanceof UserFacingError || isAbort(error) || cancel.aborted) throw error;
      failure = error;
    }
    const status = failure instanceof AnthropicCallError ? failure.status : 0;
    const retryable = !(failure instanceof AnthropicCallError) || status === 429 || status === 529 || status >= 500;
    const waitMs = failure instanceof AnthropicCallError && failure.retryAfterSec ? Math.min(failure.retryAfterSec * 1000, 15_000) : 1500 * attempt;
    if (!retryable || attempt >= 3 || deadlineAt - Date.now() < waitMs + 45_000) {
      if (failure instanceof AnthropicCallError) {
        console.error("analyze-statement Anthropic error:", failure.status, failure.body.slice(0, 1000));
        throw new UserFacingError(anthropicErrorMessage(failure.status, failure.body));
      }
      throw failure;
    }
    console.error(`analyze-statement: attempt ${attempt} failed, retrying:`, failure instanceof AnthropicCallError ? `${failure.status} ${failure.body.slice(0, 300)}` : failure);
    hooks.onRetry?.();
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
};

// ---- Cutting the statement into parts ------------------------------------------------------------

interface Piece {
  content: unknown[];
  weight: number;
}
interface Plan {
  /** The whole statement, for the account details and the self-check. */
  whole: unknown[];
  pieces: Piece[];
}
interface StatementInput {
  kind: "pdf" | "text";
  data: string; // base64 for PDFs, plain text otherwise
  fileName: string;
  contextNote: string;
}

const pdfBlock = (data: string, cache = false) => ({
  type: "document",
  source: { type: "base64", media_type: "application/pdf", data },
  ...(cache ? { cache_control: { type: "ephemeral" } } : {}),
});
const withoutCache = (block: unknown) => {
  const { cache_control: _unused, ...rest } = block as Record<string, unknown>;
  return rest;
};
const pagesLabel = (a: number, b: number) => (a === b ? `la página ${a + 1}` : `las páginas ${a + 1} a ${b + 1}`);

const planPdf = async (input: StatementInput): Promise<Plan> => {
  const { data, fileName, contextNote } = input;
  // Every part reads the whole file (bank PDFs are usually protected, and rewriting them page by page
  // costs more CPU than the function has) and is told which pages are its own. The file is marked for
  // the prompt cache, so after the first part the others read it from there.
  const whole = [pdfBlock(data, true)];
  let pages = 1;
  try {
    pages = (await PDFDocument.load(base64ToBytes(data), { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch (error) {
    console.error("analyze-statement: could not count the PDF's pages, analyzing it whole:", error);
  }
  if (pages <= 1) {
    return { whole, pieces: [{ weight: 1, content: [pdfBlock(data, true), { type: "text", text: pageInstructions(`Documento: ${fileName}. Este es el extracto completo.`) + contextNote }] }] };
  }
  const per = Math.max(1, Math.ceil(pages / MAX_PARALLEL));
  const pieces: Piece[] = [];
  for (let a = 0; a < pages; a += per) {
    const b = Math.min(pages, a + per) - 1;
    pieces.push({
      weight: b - a + 1,
      content: [
        pdfBlock(data, true),
        { type: "text", text: pageInstructions(`Documento: ${fileName}. Se adjunta el extracto completo (${pages} páginas), pero procesa SOLO las transacciones impresas en ${pagesLabel(a, b)} (la página 1 es la primera del PDF; el número de página también suele estar impreso al pie, ej. "Página 2 de ${pages}"). Las demás páginas son solo contexto: sus transacciones las procesa otra parte al mismo tiempo, así que no las incluyas.`) + contextNote },
      ],
    });
  }
  return { whole, pieces };
};

const planText = (input: StatementInput): Plan => {
  const { data: text, fileName, contextNote } = input;
  const whole = [{ type: "text", text: `Documento: ${fileName}\n\nContenido:\n\n${text}` }];
  const lines = text.split(/\r?\n/);
  const per = Math.max(45, Math.ceil(lines.length / MAX_PARALLEL));
  if (lines.length <= per + 10) {
    return { whole, pieces: [{ weight: 1, content: [{ type: "text", text: `Documento: ${fileName}\n\nContenido:\n\n${text}\n\n${pageInstructions("Este es el extracto completo.")}${contextNote}` }] }] };
  }
  const header = lines.find((l) => l.trim()) ?? "";
  const pieces: Piece[] = [];
  for (let a = 0; a < lines.length; a += per) {
    const b = Math.min(lines.length, a + per);
    pieces.push({
      weight: b - a,
      content: [{
        type: "text",
        text: `Documento: ${fileName}\n\nEncabezado de columnas: ${header}\n\nLíneas ${a + 1} a ${b}:\n\n${lines.slice(a, b).join("\n")}\n\n${pageInstructions(`Este texto contiene SOLO las líneas ${a + 1} a ${b} de un extracto de ${lines.length} líneas; las demás líneas se procesan por separado al mismo tiempo.`)}${contextNote}`,
      }],
    });
  }
  return { whole, pieces };
};

// ---- Progress, for the person waiting --------------------------------------------------------------

type Stage = "reading" | "classifying" | "checking" | "summary";
interface ProgressState {
  stage: Stage;
  stageAt: number;
  pieces: { weight: number; count: number; done: boolean }[];
  expected: number | null;
}
const setStage = (p: ProgressState, stage: Stage) => {
  if (p.stage !== stage) {
    p.stage = stage;
    p.stageAt = Date.now();
  }
};
/** New `"amt"` keys in a streamed delta: each one is a transaction written. */
const countAmounts = (tail: string, delta: string) => {
  const s = tail + delta;
  let n = 0;
  for (let i = s.indexOf('"amt"'); i >= 0; i = s.indexOf('"amt"', i + 1)) if (i + 5 > tail.length) n++;
  return { n, tail: s.slice(-4) };
};
const progressPct = (p: ProgressState, startedAt: number) => {
  const now = Date.now();
  const inStage = (now - p.stageAt) / 1000;
  if (p.stage === "reading") return Math.min(9, 2 + (now - startedAt) / 1500);
  if (p.stage === "classifying") {
    const written = p.pieces.reduce((s, x) => s + x.count, 0);
    let f: number;
    if (p.expected) f = Math.min(0.97, written / p.expected);
    else {
      const total = p.pieces.reduce((s, x) => s + x.weight, 0) || 1;
      f = p.pieces.reduce((s, x) => s + (x.weight / total) * (x.done ? 1 : Math.min(0.9, x.count / (x.count + 20))), 0);
    }
    return 10 + 75 * f;
  }
  if (p.stage === "checking") return Math.min(94, 86 + inStage / 3);
  return Math.min(98, 88 + inStage / 1.5);
};

// ---- The analysis ---------------------------------------------------------------------------------

const settle = <T,>(promise: Promise<T>) =>
  promise.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));

const synthesisInput = (r: any, contextNote: string) => {
  const lines = [`Industria detectada: ${r.industry || "no identificada"}. Período: ${r.period || "no identificado"}.${contextNote}`];
  for (const section of SECTIONS) {
    const items = Array.isArray(r[section]) ? r[section] : [];
    lines.push("", `== ${SECTION_LABEL[section]} — ${items.length} transacciones, total $${round2(sumAmounts(items)).toFixed(2)} ==`);
    for (const it of items) lines.push(`${it?.date ?? ""} | ${it?.desc ?? ""} | ${moneyNumber(it?.amt).toFixed(2)} | ${it?.category ?? ""}${it?.detail_es ? ` | ${it.detail_es}` : ""}`);
  }
  lines.push("", "Genera los insights y las alertas de este extracto según las instrucciones.");
  return [{ type: "text", text: lines.join("\n") }];
};

const runAnalysis = async (apiKey: string, input: StatementInput, startedAt: number, progress: ProgressState, duplicateOf: DuplicateLookup) => {
  const deadlineAt = startedAt + DEADLINE_MS;
  const plan = input.kind === "pdf" ? await planPdf(input) : planText(input);
  progress.pieces = plan.pieces.map((p) => ({ weight: p.weight, count: 0, done: false }));

  // The first failure stops every other request (they would be wasted) and is what the person sees.
  const cancel = new AbortController();
  let firstError: unknown = null;
  const fail = (error: unknown): never => {
    if (firstError === null) firstError = error;
    cancel.abort();
    throw error;
  };

  const overview = settle(
    callStructured(apiKey, {
      ...modelSettings(OVERVIEW_SCHEMA, 1500),
      system: OVERVIEW_PROMPT,
      messages: [{ role: "user", content: [...plan.whole.map(withoutCache), { type: "text", text: "Extrae los datos de la cuenta y el resumen impreso por el banco según las instrucciones." }] }],
    }, deadlineAt, cancel.signal)
      .then(async (o) => {
        progress.expected = expectedTransactions(o?.bankSummary);
        // A copy of a statement already in the system stops here, before the pages finish reading it.
        const key = statementKeyOf({
          period: o?.period,
          bankSummary: o?.bankSummary,
          accountInfo: { accountNumberLast4: o?.accountNumberLast4, beginningBalance: o?.beginningBalance, endingBalance: o?.endingBalance, periodStart: o?.periodStart, periodEnd: o?.periodEnd },
        });
        const where = await duplicateOf("statement_key", key);
        if (where !== null) throw new UserFacingError(duplicateMessage(where));
        return o;
      })
      .catch(fail),
  );

  const classifySystem = [{ type: "text", text: CLASSIFY_PROMPT, cache_control: { type: "ephemeral" } }];
  const runPiece = (i: number, onStart?: () => void) => {
    const state = progress.pieces[i];
    let tail = "";
    return settle(
      callStructured(apiKey, {
        ...modelSettings(PAGE_SCHEMA, 8000),
        system: classifySystem,
        messages: [{ role: "user", content: plan.pieces[i].content }],
      }, deadlineAt, cancel.signal, {
        onStart,
        onText: (delta) => {
          const r = countAmounts(tail, delta);
          tail = r.tail;
          state.count += r.n;
          if (progress.stage === "reading") setStage(progress, "classifying");
        },
        onRetry: () => {
          tail = "";
          state.count = 0;
        },
      })
        .then((result) => {
          state.done = true;
          state.count = SECTIONS.reduce((s, k) => s + (Array.isArray(result?.[k]) ? result[k].length : 0), 0);
          return result;
        })
        .catch(fail),
    );
  };

  // The first part starts alone for a moment, so it stores the shared instructions in the prompt
  // cache and the other parts read them from there (cheaper, and lighter on the rate limits).
  let firstStarted: () => void = () => {};
  const warmed = new Promise<void>((resolve) => {
    firstStarted = resolve;
    setTimeout(resolve, 8000);
  });
  const first = runPiece(0, () => firstStarted());
  await Promise.race([warmed, first]);
  const outcomes = await Promise.all([first, ...plan.pieces.slice(1).map((_, j) => runPiece(j + 1))]);
  const overviewOutcome = await overview;
  if (firstError !== null) throw firstError;
  if (!overviewOutcome.ok) throw overviewOutcome.error;
  if (outcomes.some((o) => !o.ok)) throw (outcomes.find((o) => !o.ok) as { error: unknown }).error;
  const ov = overviewOutcome.value;

  const merged: any = {};
  for (const section of SECTIONS) merged[section] = [];
  const checkPayees = new Map<string, string>();
  for (const o of outcomes) {
    const page = (o as { value: any }).value;
    for (const section of SECTIONS) if (Array.isArray(page?.[section])) merged[section].push(...page[section]);
    for (const c of Array.isArray(page?.checkImages) ? page.checkImages : []) {
      const number = String(c?.checkNumber ?? "").replace(/\D/g, "");
      const payee = String(c?.payee ?? "").trim();
      if (number && payee) checkPayees.set(number, payee);
    }
  }

  const harmonized = harmonizeCounterparties(merged);
  const periodStart = String(ov?.periodStart ?? "");
  const periodEnd = String(ov?.periodEnd ?? "");
  let result: any = {
    company: ov?.company ?? "",
    period: ov?.period ?? "",
    period_en: ov?.period_en ?? "",
    period_es: ov?.period_es ?? "",
    industry: ov?.industry ?? "",
    annualYear: ov?.annualYear ?? "",
    ...merged,
    bankSummary: ov?.bankSummary ?? null,
    accountInfo: {
      bankName: ov?.bankName ?? "",
      accountHolder: ov?.accountHolder ?? "",
      accountNumberLast4: ov?.accountNumberLast4 ?? "",
      beginningBalance: ov?.beginningBalance ?? -999999999,
      endingBalance: ov?.endingBalance ?? -999999999,
      periodStart,
      periodEnd,
    },
  };

  // Self-check against the bank's own totals: if the classified transactions don't add up to what the
  // bank printed, one request compares the statement with the list and returns only what is missing or
  // duplicated; the correction is kept only if it brings the totals closer. In parallel, the insights
  // and alerts are written from the classified transactions.
  const gapsFirst = reconcileGaps(result);
  const willCheck = !!gapsFirst && gapsFirst.score > 1 && deadlineAt - Date.now() > 55_000;
  setStage(progress, willCheck ? "checking" : "summary");

  const flat: { section: Section; item: any }[] = [];
  for (const section of SECTIONS) for (const item of result[section]) flat.push({ section, item });

  const synthesis = settle(callStructured(apiKey, {
    ...modelSettings(SYNTHESIS_SCHEMA, 2000),
    system: SYNTHESIS_PROMPT,
    messages: [{ role: "user", content: synthesisInput(result, input.contextNote) }],
  }, deadlineAt, cancel.signal));

  const patch = willCheck
    ? settle(callStructured(apiKey, {
        ...modelSettings(PATCH_SCHEMA, 3000),
        system: classifySystem,
        messages: [{
          role: "user",
          content: [
            ...plan.whole,
            {
              type: "text",
              text: `Abajo están, numeradas, TODAS las transacciones que ya se clasificaron de este extracto. El resultado NO cuadra con los totales impresos por el banco: depósitos del banco menos depósitos clasificados = ${gapsFirst!.depositsDelta} (positivo = faltan entradas); retiros clasificados menos retiros del banco = ${gapsFirst!.withdrawalsDelta} (positivo = sobran salidas, negativo = faltan salidas).

${BANK_RECONCILE_RULE}
Revisa el extracto adjunto línea por línea contra esta lista y devuelve SOLO las correcciones:
- "add": cada transacción impresa en el extracto que falte en la lista, con su sección ("revenues" para TODO el dinero que entra; "cogs", "opex", "fees" o "personal" para lo que sale) y sus datos copiados exactos del extracto, clasificada según las instrucciones.
- "remove": los números (#) de las entradas de la lista que estén duplicadas o que no sean transacciones reales (ej. un total, un subtotal o un saldo tomado como transacción). Si una transacción está en la sección equivocada (ej. un depósito clasificado como gasto), quítala con "remove" y agrégala en la sección correcta con "add".
Nunca inventes ni ajustes montos para que cuadre. Si no encuentras nada, devuelve ambas listas vacías.

Transacciones clasificadas:
${flat.map((x, i) => `#${i + 1} [${x.section}] ${x.item?.date ?? ""} | ${x.item?.desc ?? ""} | ${moneyNumber(x.item?.amt).toFixed(2)} | ${x.item?.category ?? ""}`).join("\n")}`,
            },
          ],
        }],
      }, deadlineAt, cancel.signal))
    : Promise.resolve(null);

  const [synthesisOutcome, patchOutcome] = await Promise.all([synthesis, patch]);
  let retried = false;
  if (patchOutcome && patchOutcome.ok && gapsFirst) {
    const fix = patchOutcome.value;
    const remove = new Set((Array.isArray(fix?.remove) ? fix.remove : []).filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= flat.length));
    const additions = (Array.isArray(fix?.add) ? fix.add : []).filter((a: any) => SECTIONS.includes(a?.section) && a?.item && moneyNumber(a.item.amt) > 0);
    if (remove.size > 0 || additions.length > 0) {
      const candidate: any = { ...result };
      for (const section of SECTIONS) candidate[section] = [];
      flat.forEach((x, i) => {
        if (!remove.has(i + 1)) candidate[x.section].push(x.item);
      });
      for (const a of additions) candidate[a.section].push({ ...a.item, amt: moneyNumber(a.item.amt) });
      const gapsAfter = reconcileGaps(candidate);
      if (gapsAfter && gapsAfter.score < gapsFirst.score) {
        result = candidate;
        retried = true;
      }
    }
  } else if (patchOutcome && !patchOutcome.ok) {
    console.error("analyze-statement self-check skipped:", patchOutcome.error);
  }
  if (!synthesisOutcome.ok) console.error("analyze-statement insights/alerts skipped:", synthesisOutcome.error);
  const synth = synthesisOutcome.ok ? synthesisOutcome.value : null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);

  result.thirdPartyPayments = buildThirdPartyPayments(result, checkPayees);
  result.insights_en = strings(synth?.insights_en);
  result.insights_es = strings(synth?.insights_es);
  result.alerts_en = strings(synth?.alerts_en);
  result.alerts_es = strings(synth?.alerts_es);
  result.annualSummary = monthlySummary(result, periodStart, periodEnd);
  result.contentHash = await contentHashOf(result);
  const sameContent = await duplicateOf("content_hash", result.contentHash);
  if (sameContent !== null) throw new UserFacingError(duplicateMessage(sameContent));
  const gapsFinal = reconcileGaps(result);
  result.verification = {
    checked: gapsFinal !== null,
    depositsDelta: gapsFinal?.depositsDelta ?? null,
    withdrawalsDelta: gapsFinal?.withdrawalsDelta ?? null,
    retried,
    harmonized,
    model: STATEMENT_MODEL,
    parts: plan.pieces.length,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  };
  return result;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // This call runs a full statement analysis through Claude — real per-call cost. Requiring a
    // logged-in user (not just the public anon key any visitor can read from the built JS bundle)
    // stops anyone off the internet from scripting free/unlimited analyses on our AI budget.
    const requestStartedAt = Date.now();
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Debes iniciar sesión para analizar un extracto." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Once the 24-hour trial is over (and no subscription), stop before spending on the AI — saving
    // the result would be refused by the database anyway.
    const { data: allowed } = await supabaseClient.rpc("can_analyze");
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Tu prueba gratuita terminó. Suscríbete para seguir analizando extractos." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { fileBase64, mediaType, fileName, clientContext, progress: progressRequested } = await req.json();
    // Newer pages ask for live progress (one JSON line per update); older ones get the classic answer.
    const wantsProgress = progressRequested === true;
    // What the accountant recorded about the business (industry, what it sells) helps classify its
    // transactions; it never replaces what the statement says.
    const contextNote = typeof clientContext === "string" && clientContext.trim()
      ? ` Contexto del cliente registrado por el contador (úsalo para entender el negocio, nunca para inventar transacciones): ${clientContext.trim().slice(0, 1500)}`
      : "";

    if (!fileBase64 || typeof fileBase64 !== "string") {
      return new Response(JSON.stringify({ error: "Falta el archivo (fileBase64)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      console.error("analyze-statement: ANTHROPIC_API_KEY is not configured");
      throw new UserFacingError("El servidor todavía no tiene configurada la clave de la IA. Avísale al administrador.");
    }

    // Statements already in the system are refused before any AI work (see "can't be analyzed twice").
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = serviceKey ? createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } }) : null;
    if (!adminClient) console.error("analyze-statement: SUPABASE_SERVICE_ROLE_KEY missing, duplicate checks rely on the database alone");
    const duplicateOf: DuplicateLookup = async (column, value) => {
      if (!value || !adminClient) return null;
      const { data: found, error } = await adminClient.from("analyses").select("id").eq(column, value).limit(1);
      if (error) {
        console.error(`analyze-statement: duplicate lookup by ${column} failed:`, error.message);
        return null;
      }
      if (!found?.length) return null;
      const { data: visible } = await supabaseClient.from("analyses").select("period, clients(name)").eq("id", found[0].id).maybeSingle();
      const v = visible as { period?: string | null; clients?: { name?: string } | null } | null;
      return v ? [v.clients?.name, v.period].filter(Boolean).join(" · ") : "";
    };
    let fileBytes: Uint8Array<ArrayBuffer>;
    try {
      fileBytes = base64ToBytes(fileBase64);
    } catch {
      throw new UserFacingError("No se pudo leer el archivo. Vuelve a seleccionarlo e inténtalo de nuevo.");
    }
    const sameFile = await duplicateOf("file_hash", await sha256Hex(fileBytes));
    if (sameFile !== null) {
      return new Response(JSON.stringify({ error: duplicateMessage(sameFile) }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedType = String(mediaType || "").toLowerCase();
    const lowerName = String(fileName || "").toLowerCase();
    const isPdf = normalizedType.includes("pdf") || lowerName.endsWith(".pdf");
    const isXlsx = normalizedType.includes("sheet") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
    const name = String(fileName || "estado de cuenta");
    const input: StatementInput = isPdf
      ? { kind: "pdf", data: fileBase64, fileName: name, contextNote }
      : { kind: "text", data: (isXlsx ? xlsxToText(fileBase64) : decodeBase64Text(fileBase64)).slice(0, 180000), fileName: name, contextNote };

    // From here the work takes a while. The platform drops a request that has sent nothing for 150 s,
    // so the answer starts streaming now: progress lines every 1.5 s (or, for older pages, a space every
    // 5 s, which is valid leading JSON whitespace), then the result or a clear error.
    const progress: ProgressState = { stage: "reading", stageAt: Date.now(), pieces: [], expected: null };
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // the person closed the page; nothing to send to
          }
        };
        let lastPct = 0;
        const tick = () => {
          if (!wantsProgress) return send(" ");
          lastPct = Math.max(lastPct, Math.round(progressPct(progress, requestStartedAt)));
          send(JSON.stringify({
            type: "progress",
            pct: lastPct,
            stage: progress.stage,
            done: progress.pieces.reduce((s, x) => s + x.count, 0),
            expected: progress.expected,
          }) + "\n");
        };
        tick();
        const keepAlive = setInterval(tick, wantsProgress ? 1500 : 5000);
        let result: unknown = null;
        let errorMessage: string | null = null;
        try {
          result = await runAnalysis(ANTHROPIC_API_KEY, input, requestStartedAt, progress, duplicateOf);
        } catch (error) {
          console.error("analyze-statement error:", error);
          errorMessage = userMessageFor(error);
        } finally {
          clearInterval(keepAlive);
        }
        if (wantsProgress) send(JSON.stringify(errorMessage !== null ? { type: "error", error: errorMessage } : { type: "result", data: result }) + "\n");
        else send(JSON.stringify(errorMessage !== null ? { error: errorMessage } : result));
        try {
          controller.close();
        } catch {
          // already closed
        }
      },
    });
    return new Response(body, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": wantsProgress ? "application/x-ndjson" : "application/json" },
    });
  } catch (error) {
    console.error("analyze-statement error:", error);
    return new Response(JSON.stringify({ error: userMessageFor(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

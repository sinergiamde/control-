import { supabase } from "@/integrations/supabase/client";
import { normalizeAnalysisTransactions } from "./reportTypes";
import { statementRange, transactionDate, type StatementRow, type TxnList } from "./statementPeriod";

export interface ReceiptRow {
  id: string;
  user_id: string | null;
  client_id: string;
  storage_path: string;
  file_name: string;
  receipt_date: string | null;
  merchant: string;
  amount: number | null;
  tax: number | null;
  currency: string;
  note: string;
  needs_review: string[];
  analysis_id: string | null;
  txn_date: string | null;
  txn_desc: string | null;
  txn_amount: number | null;
  created_at: string;
}

/** An expense line of a saved statement a receipt can back up. */
export interface StatementTxn {
  analysisId: string;
  list: TxnList;
  rawDate: string;
  desc: string;
  amount: number;
  date: Date;
}

const EXPENSE_LISTS: TxnList[] = ["cogs", "opex", "fees", "personal"];

const toAmount = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

/** Same transaction, whether it's read from the statement here or from a report row in Results:
 * the raw date the analyzer wrote, the description and the absolute amount. */
export const txnKey = (rawDate: unknown, desc: unknown, amount: unknown) =>
  `${String(rawDate ?? "").trim()}|${String(desc ?? "").trim().toLowerCase()}|${toAmount(amount).toFixed(2)}`;

export const receiptTxnKey = (r: Pick<ReceiptRow, "txn_date" | "txn_desc" | "txn_amount">) =>
  txnKey(r.txn_date, r.txn_desc, r.txn_amount);

export const statementTxns = (rows: StatementRow[]): StatementTxn[] =>
  rows.flatMap((row) => {
    const data = structuredClone(row.full_analysis ?? {});
    const src = data?.analysis ?? data;
    if (!src || typeof src !== "object") return [];
    normalizeAnalysisTransactions(src);
    const range = statementRange(row);
    return EXPENSE_LISTS.flatMap((list) =>
      (Array.isArray(src[list]) ? src[list] : []).map((item: any) => ({
        analysisId: row.id,
        list,
        rawDate: String(item?.date ?? ""),
        desc: String(item?.desc || item?.name || ""),
        amount: toAmount(item?.amt ?? item?.amount),
        date: transactionDate(item?.date, range) ?? range.from,
      }))
    );
  });

const DAY = 86_400_000;

/** Same amount (to the cent) within 5 days of the receipt, closest date first. */
export const suggestMatches = (txns: StatementTxn[], amount: number | null, isoDate: string) => {
  if (!amount) return [];
  const when = isoDate ? new Date(`${isoDate}T12:00:00`) : null;
  return txns
    .filter((t) => Math.abs(t.amount - amount) < 0.01 && (!when || Math.abs(t.date.getTime() - when.getTime()) <= 5 * DAY))
    .sort((a, b) => (when ? Math.abs(a.date.getTime() - when.getTime()) - Math.abs(b.date.getTime() - when.getTime()) : 0));
};

export const txnOptionValue = (t: StatementTxn) => `${t.analysisId}::${txnKey(t.rawDate, t.desc, t.amount)}`;

export const fmtMoney = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

/** Phone photos are often 4–12 MB; the reader only needs ~1600px, so photos are re-encoded as
 * JPEG before upload (PDFs go as they are). */
export const prepareReceiptFile = async (file: File): Promise<{ blob: Blob; mediaType: string; ext: string }> => {
  if (file.type === "application/pdf") return { blob: file, mediaType: file.type, ext: "pdf" };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ? { blob, mediaType: "image/jpeg", ext: "jpg" } : { blob: file, mediaType: file.type, ext: file.name.split(".").pop() || "jpg" };
};

export const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export const openReceiptFile = async (path: string) => {
  const { data } = await supabase.storage.from("receipts").createSignedUrl(path, 600);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
};

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Camera, Eye, FileText, Link2, Loader2, Pencil, Receipt, Save, Trash2, Upload } from "lucide-react";
import { useNavGuard } from "@/components/AppLayout";
import ClientChoice, { NEW_CLIENT, initialClientChoice, resolveClientChoice } from "@/components/ClientChoice";
import type { ClientOption } from "@/components/ClientCombobox";
import { UploadLockedCard, useTrialStatus } from "@/components/SubscribePrompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { fetchClientNodes } from "@/utils/clientTree";
import { STR, tr } from "@/utils/i18n";
import {
  RECEIPT_MAX_BYTES, RECEIPT_TYPES, blobToBase64, fmtMoney, openReceiptFile, prepareReceiptFile, suggestMatches,
  statementTxns, txnOptionValue, type ReceiptRow, type StatementTxn,
} from "@/utils/receipts";
import type { StatementRow } from "@/utils/statementPeriod";

const EXTRACT_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-receipt`;
const NO_LINK = "__none__";
const ALL_CLIENTS = "__all__";
type Field = "date" | "merchant" | "amount" | "tax";

interface ReceiptForm {
  date: string;
  merchant: string;
  amount: string;
  tax: string;
  note: string;
  link: string;
}

const EMPTY_FORM: ReceiptForm = { date: "", merchant: "", amount: "", tax: "", note: "", link: NO_LINK };

const toNumberOrNull = (value: string) => {
  const n = Number(value.replace(/[^\d.-]/g, ""));
  return value.trim() && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

const fmtTxnDate = (d: Date, isEnglish: boolean) =>
  d.toLocaleDateString(isEnglish ? "en-US" : "es-CO", { month: "short", day: "numeric", year: "numeric" });

/** Upload a receipt photo, let the AI read date / merchant / amount / tax, have the person check
 * what it wasn't sure about, add the purpose of the expense, and link it to the statement
 * transaction it backs up (same amount, close date are suggested). */
const Receipts = () => {
  const { t, lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, session, role, canManageClients, loading: authLoading } = useAuth();
  const { uploadsLocked } = useTrialStatus();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [listFilter, setListFilter] = useState<string>(ALL_CLIENTS);

  // New receipt
  const [clientValue, setClientValue] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [file, setFile] = useState<{ blob: Blob; mediaType: string; ext: string; name: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [form, setForm] = useState<ReceiptForm>(EMPTY_FORM);
  const [doubtful, setDoubtful] = useState<Set<Field>>(new Set());
  const [extracted, setExtracted] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [txnsByClient, setTxnsByClient] = useState<Map<string, StatementTxn[]>>(new Map());

  // Editing a saved receipt
  const [editing, setEditing] = useState<ReceiptRow | null>(null);
  const [editForm, setEditForm] = useState<ReceiptForm>(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  useNavGuard(file && !saving ? tr(STR.confirmLeaveWithFiles, isEnglish) : undefined);

  const fetchAll = useCallback(async () => {
    const [nodes, { data }] = await Promise.all([
      fetchClientNodes(),
      supabase.from("receipts").select("*").order("created_at", { ascending: false }),
    ]);
    const options = nodes.map((n) => ({ id: n.id, name: n.name }));
    setClients(options);
    setClientValue((prev) => prev || initialClientChoice(options, canManageClients));
    const rows = (data as ReceiptRow[]) || [];
    setReceipts(rows);
    const imagePaths = rows.filter((r) => !r.storage_path.endsWith(".pdf")).map((r) => r.storage_path);
    if (imagePaths.length > 0) {
      const { data: signed } = await supabase.storage.from("receipts").createSignedUrls(imagePaths, 3600);
      setThumbs(new Map((signed || []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl])));
    }
    setLoading(false);
  }, [canManageClients]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/"); return; }
    fetchAll();
  }, [authLoading, user, navigate, fetchAll]);

  const loadTxns = useCallback(async (clientId: string) => {
    if (!clientId || clientId === NEW_CLIENT || txnsByClient.has(clientId)) return;
    const { data } = await supabase
      .from("analyses")
      .select("id, user_id, client_id, period, original_filename, created_at, full_analysis")
      .eq("client_id", clientId);
    const txns = statementTxns((data as StatementRow[]) || []).sort((a, b) => b.date.getTime() - a.date.getTime());
    setTxnsByClient((prev) => new Map(prev).set(clientId, txns));
  }, [txnsByClient]);

  useEffect(() => { loadTxns(clientValue); }, [clientValue, loadTxns]);
  useEffect(() => { if (editing) loadTxns(editing.client_id); }, [editing, loadTxns]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "—";
  // Authorized users upload and view but never delete (the database enforces it too).
  const fail = (description: string) => toast({ title: "Error", description, variant: "destructive" });

  const resetNew = () => {
    setFile(null);
    setPreviewUrl(null);
    setForm(EMPTY_FORM);
    setDoubtful(new Set());
    setExtracted(null);
    setReadFailed(false);
  };

  const handleFile = async (picked: File | undefined) => {
    if (!picked) return;
    if (!RECEIPT_TYPES.includes(picked.type)) { fail(tr(STR.receiptWrongType, isEnglish)); return; }
    if (picked.size > RECEIPT_MAX_BYTES) { fail(tr(STR.receiptTooBig, isEnglish)); return; }
    resetNew();
    setReading(true);
    try {
      const prepared = await prepareReceiptFile(picked);
      setFile({ ...prepared, name: picked.name });
      if (prepared.mediaType.startsWith("image/")) setPreviewUrl(URL.createObjectURL(prepared.blob));
      const response = await fetch(EXTRACT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ fileBase64: await blobToBase64(prepared.blob), mediaType: prepared.mediaType, lang }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.error) throw new Error(data?.error || "extract failed");
      const flags = new Set<Field>();
      if (!data.date_confident || !data.date) flags.add("date");
      if (!data.merchant_confident || !data.merchant) flags.add("merchant");
      if (!data.total_confident || !data.total) flags.add("amount");
      if (!data.tax_confident) flags.add("tax");
      setDoubtful(flags);
      setExtracted(data);
      setForm((prev) => ({
        ...prev,
        date: /^\d{4}-\d{2}-\d{2}$/.test(data.date || "") ? data.date : "",
        merchant: data.merchant || "",
        amount: data.total ? String(data.total) : "",
        tax: data.tax ? String(data.tax) : "",
      }));
    } catch (err) {
      console.error("extract-receipt:", err);
      setReadFailed(true);
      setDoubtful(new Set(["date", "merchant", "amount", "tax"]));
    } finally {
      setReading(false);
    }
  };

  const linkFields = (value: string, clientId: string) => {
    if (value === NO_LINK) return { analysis_id: null, txn_date: null, txn_desc: null, txn_amount: null };
    const txn = (txnsByClient.get(clientId) || []).find((t) => txnOptionValue(t) === value);
    return txn
      ? { analysis_id: txn.analysisId, txn_date: txn.rawDate, txn_desc: txn.desc, txn_amount: txn.amount }
      : { analysis_id: null, txn_date: null, txn_desc: null, txn_amount: null };
  };

  const handleSave = async () => {
    if (!file || !user) return;
    setSaving(true);
    const resolved = await resolveClientChoice(clientValue, newClientName, {
      empty: t("clientNameEmptyError"),
      duplicate: t("clientDuplicateError"),
    });
    if ("error" in resolved) { setSaving(false); fail(resolved.error); return; }
    const clientId = resolved.client.id;
    if (resolved.created) {
      setClients((prev) => [...prev, resolved.client].sort((a, b) => a.name.localeCompare(b.name)));
      setClientValue(clientId);
      setNewClientName("");
    }

    const path = `${user.id}/${crypto.randomUUID()}.${file.ext}`;
    const { error: uploadError } = await supabase.storage.from("receipts").upload(path, file.blob, { contentType: file.mediaType });
    if (uploadError) { setSaving(false); fail(uploadError.message); return; }

    // A doubtful field the person changed counts as checked; untouched ones stay flagged.
    const extractedValue: Record<Field, string> = {
      date: String(extracted?.date ?? ""),
      merchant: String(extracted?.merchant ?? ""),
      amount: extracted?.total ? String(extracted.total) : "",
      tax: extracted?.tax ? String(extracted.tax) : "",
    };
    const needsReview = [...doubtful].filter((f) => form[f].trim() === extractedValue[f].trim());

    const { data, error } = await supabase
      .from("receipts")
      .insert({
        user_id: user.id,
        client_id: clientId,
        storage_path: path,
        file_name: file.name,
        receipt_date: form.date || null,
        merchant: form.merchant.trim(),
        amount: toNumberOrNull(form.amount),
        tax: toNumberOrNull(form.tax),
        note: form.note.trim(),
        needs_review: needsReview,
        extracted: (extracted as any) ?? null,
        ...linkFields(form.link, clientId),
      })
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      await supabase.storage.from("receipts").remove([path]);
      fail(error?.message || "—");
      return;
    }
    setReceipts((prev) => [data as ReceiptRow, ...prev]);
    if (previewUrl) setThumbs((prev) => new Map(prev).set(path, previewUrl));
    setFile(null);
    setForm(EMPTY_FORM);
    setDoubtful(new Set());
    setExtracted(null);
    toast({ title: "✅", description: tr(STR.receiptSaved, isEnglish) });
  };

  const openEdit = (r: ReceiptRow) => {
    setEditing(r);
    const txn = r.analysis_id
      ? (txnsByClient.get(r.client_id) || []).find((t) => t.analysisId === r.analysis_id && t.rawDate === r.txn_date && t.desc === r.txn_desc)
      : undefined;
    setEditForm({
      date: r.receipt_date || "",
      merchant: r.merchant,
      amount: r.amount === null ? "" : String(r.amount),
      tax: r.tax === null ? "" : String(r.tax),
      note: r.note,
      link: txn ? txnOptionValue(txn) : r.analysis_id ? `${r.analysis_id}::saved` : NO_LINK,
    });
  };

  const handleEditSave = async () => {
    if (!editing) return;
    setEditSaving(true);
    const link = editForm.link.endsWith("::saved")
      ? { analysis_id: editing.analysis_id, txn_date: editing.txn_date, txn_desc: editing.txn_desc, txn_amount: editing.txn_amount }
      : linkFields(editForm.link, editing.client_id);
    const { data, error } = await supabase
      .from("receipts")
      .update({
        receipt_date: editForm.date || null,
        merchant: editForm.merchant.trim(),
        amount: toNumberOrNull(editForm.amount),
        tax: toNumberOrNull(editForm.tax),
        note: editForm.note.trim(),
        needs_review: [],
        ...link,
      })
      .eq("id", editing.id)
      .select("*")
      .single();
    setEditSaving(false);
    if (error || !data) { fail(error?.message || "—"); return; }
    setReceipts((prev) => prev.map((r) => (r.id === editing.id ? (data as ReceiptRow) : r)));
    setEditing(null);
    toast({ title: "✅", description: tr(STR.receiptUpdated, isEnglish) });
  };

  const handleDelete = async (r: ReceiptRow) => {
    if (!window.confirm(tr(STR.confirmDeleteReceipt, isEnglish))) return;
    const { error } = await supabase.from("receipts").delete().eq("id", r.id);
    if (error) { fail(error.message); return; }
    await supabase.storage.from("receipts").remove([r.storage_path]);
    setReceipts((prev) => prev.filter((x) => x.id !== r.id));
    toast({ title: "✅", description: tr(STR.receiptDeleted, isEnglish) });
  };

  const shownReceipts = useMemo(
    () => (listFilter === ALL_CLIENTS ? receipts : receipts.filter((r) => r.client_id === listFilter)),
    [receipts, listFilter]
  );

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const verifyChip = (field: Field) =>
    doubtful.has(field) ? (
      <span className="ml-2 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" /> {tr(STR.verifyBadge, isEnglish)}
      </span>
    ) : null;

  /** Date / merchant / amount / tax / purpose / linked transaction — shared by "new" and "edit". */
  const renderFields = (
    value: ReceiptForm,
    onChange: (next: ReceiptForm) => void,
    clientId: string,
    flagged: (field: Field) => React.ReactNode,
    saved?: ReceiptRow
  ) => {
    const txns = txnsByClient.get(clientId) || [];
    const suggestions = suggestMatches(txns, toNumberOrNull(value.amount), value.date);
    const suggestionKeys = new Set(suggestions.map(txnOptionValue));
    const others = txns.filter((t) => !suggestionKeys.has(txnOptionValue(t))).slice(0, 300);
    const txnLabel = (t: StatementTxn) => `${fmtTxnDate(t.date, isEnglish)} · ${t.desc || "—"} · ${fmtMoney(t.amount)}`;
    const set = (key: keyof ReceiptForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...value, [key]: e.target.value });
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{tr(STR.receiptDate, isEnglish)}{flagged("date")}</label>
            <Input type="date" value={value.date} onChange={set("date")} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{tr(STR.receiptMerchant, isEnglish)}{flagged("merchant")}</label>
            <Input value={value.merchant} onChange={set("merchant")} maxLength={200} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{tr(STR.receiptAmount, isEnglish)}{flagged("amount")}</label>
            <Input inputMode="decimal" value={value.amount} onChange={set("amount")} placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{tr(STR.receiptTax, isEnglish)}{flagged("tax")}</label>
            <Input inputMode="decimal" value={value.tax} onChange={set("tax")} placeholder="0.00" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">{tr(STR.receiptNote, isEnglish)}</label>
          <Textarea value={value.note} onChange={set("note")} rows={2} maxLength={500} placeholder={tr(STR.receiptNotePlaceholder, isEnglish)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Link2 className="h-4 w-4 text-primary" /> {tr(STR.receiptLinkLabel, isEnglish)}
          </label>
          <Select value={value.link} onValueChange={(link) => onChange({ ...value, link })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={NO_LINK}>{tr(STR.receiptNoLink, isEnglish)}</SelectItem>
              {saved?.analysis_id && value.link.endsWith("::saved") && (
                <SelectItem value={value.link}>{`${saved.txn_date || "—"} · ${saved.txn_desc || "—"} · ${fmtMoney(saved.txn_amount)}`}</SelectItem>
              )}
              {suggestions.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{tr(STR.receiptSuggested, isEnglish)}</SelectLabel>
                  {suggestions.map((t) => <SelectItem key={txnOptionValue(t)} value={txnOptionValue(t)}>{txnLabel(t)}</SelectItem>)}
                </SelectGroup>
              )}
              {others.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{tr(STR.receiptOtherTxns, isEnglish)}</SelectLabel>
                  {others.map((t) => <SelectItem key={txnOptionValue(t)} value={txnOptionValue(t)}>{txnLabel(t)}</SelectItem>)}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          {suggestions.length === 0 && toNumberOrNull(value.amount) !== null && (
            <p className="text-xs text-muted-foreground">{tr(STR.receiptNoMatches, isEnglish)}</p>
          )}
        </div>
      </div>
    );
  };

  const clientReady = clientValue === NEW_CLIENT ? !!newClientName.trim() : !!clientValue;

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-5xl w-full mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
          <Receipt className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{tr(STR.receiptsTitle, isEnglish)}</h1>
          <p className="text-sm text-muted-foreground">{tr(STR.receiptsDesc, isEnglish)}</p>
        </div>
      </div>

      {uploadsLocked ? (
        <UploadLockedCard />
      ) : (
        <Card className="neon-border bg-card shadow-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Upload className="h-5 w-5 text-primary" />
              {tr(STR.uploadReceiptNav, isEnglish)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ClientChoice
              clients={clients}
              value={clientValue}
              onChange={setClientValue}
              newName={newClientName}
              onNewNameChange={setNewClientName}
              label={tr(STR.whichClientReceiptLabel, isEnglish)}
              allowNew={canManageClients}
              disabled={saving}
            />

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
            />

            {!file && !reading ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/50 rounded-xl p-8 text-center transition-all"
              >
                <div className="w-14 h-14 rounded-xl bg-muted border border-border flex items-center justify-center mx-auto mb-3">
                  <Camera className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="font-semibold text-foreground">{tr(STR.receiptPickPhoto, isEnglish)}</p>
                <p className="text-xs text-muted-foreground mt-1">{tr(STR.receiptFormats, isEnglish)}</p>
              </button>
            ) : reading ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{tr(STR.receiptReading, isEnglish)}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
                <div className="space-y-2">
                  {previewUrl ? (
                    <img src={previewUrl} alt={tr(STR.receiptWord, isEnglish)} className="w-full max-h-72 object-contain rounded-lg border border-border bg-muted" />
                  ) : (
                    <div className="h-40 rounded-lg border border-border bg-muted flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <FileText className="h-8 w-8" />
                      <span className="text-xs px-2 truncate max-w-full">{file?.name}</span>
                    </div>
                  )}
                  <Button size="sm" variant="ghost" className="w-full" onClick={() => fileInputRef.current?.click()} disabled={saving}>
                    <Camera className="h-4 w-4 mr-1" /> {tr(STR.anotherReceipt, isEnglish)}
                  </Button>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="font-semibold text-foreground">{tr(STR.receiptReviewTitle, isEnglish)}</p>
                    <p className={`text-xs ${readFailed ? "text-destructive" : "text-muted-foreground"}`}>
                      {tr(readFailed ? STR.receiptReadFailed : STR.receiptReviewHint, isEnglish)}
                    </p>
                  </div>
                  {renderFields(form, setForm, clientValue, verifyChip)}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={resetNew} disabled={saving}>{tr(STR.cancelWord, isEnglish)}</Button>
                    <Button onClick={handleSave} disabled={saving || !clientReady} className="neon-glow">
                      {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                      {tr(STR.receiptSave, isEnglish)}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border/60">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              {tr(STR.receiptsListTitle, isEnglish)}
              <span className="text-xs font-normal text-muted-foreground">({shownReceipts.length})</span>
            </CardTitle>
            {clients.length > 1 && (
              <Select value={listFilter} onValueChange={setListFilter}>
                <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CLIENTS}>{tr(STR.clientFilterAllLabel, isEnglish)}</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {shownReceipts.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{tr(STR.noReceipts, isEnglish)}</p>
          ) : (
            <div className="divide-y divide-border/50">
              {shownReceipts.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-3">
                  <button
                    type="button"
                    onClick={() => openReceiptFile(r.storage_path)}
                    className="w-14 h-14 rounded-md border border-border bg-muted overflow-hidden shrink-0 flex items-center justify-center"
                    title={tr(STR.viewReceipt, isEnglish)}
                  >
                    {thumbs.get(r.storage_path) ? (
                      <img src={thumbs.get(r.storage_path)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <FileText className="h-6 w-6 text-muted-foreground" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">
                      {r.merchant || "—"} · {fmtMoney(r.amount)}
                      {r.tax ? <span className="text-xs text-muted-foreground"> ({tr(STR.receiptTax, isEnglish)} {fmtMoney(r.tax)})</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.receipt_date || "—"} · {clientName(r.client_id)}{r.note ? ` · ${r.note}` : ""}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {r.analysis_id ? (
                        <span className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          <Link2 className="h-3 w-3" /> {tr(STR.linkedWord, isEnglish)}: {r.txn_desc || "—"}
                        </span>
                      ) : (
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{tr(STR.receiptNoLink, isEnglish)}</span>
                      )}
                      {r.needs_review.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> {tr(STR.verifyBadge, isEnglish)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => openReceiptFile(r.storage_path)} title={tr(STR.viewReceipt, isEnglish)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(r)} title={t("editWord")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {role !== "authorized" && (
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(r)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              {editing?.merchant || tr(STR.receiptWord, isEnglish)}
            </DialogTitle>
          </DialogHeader>
          {editing && renderFields(editForm, setEditForm, editing.client_id, () => null, editing)}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={editSaving}>{tr(STR.cancelWord, isEnglish)}</Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              {tr(STR.saveWord, isEnglish)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Receipts;

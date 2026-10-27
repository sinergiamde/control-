import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

interface UserRow {
  user_id: string;
  email: string;
  name: string;
  company: string;
  last_sign_in_at: string | null;
}

const MIN_LENGTH = 8;

/** Readable random password (no 0/O/1/l look-alikes) for the admin to hand over. */
const generatePassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

/** Admin-only: when someone (e.g. Luisa) loses their password, TaxForYou sets a new one here and
 * hands it over; the change goes through admin_set_user_password, which re-checks the admin role. */
const Passwords = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<UserRow | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { navigate("/analyze"); return; }
    (async () => {
      setLoading(true);
      const [{ data: accounts, error }, { data: profiles }, { data: clients }, { data: accessRows }] = await Promise.all([
        supabase.rpc("admin_list_users"),
        supabase.from("profiles").select("user_id, name"),
        supabase.from("clients").select("id, name"),
        supabase.from("client_access").select("client_id, user_id"),
      ]);
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      const profileById = new Map((profiles || []).map((p) => [p.user_id, p]));
      const clientName = new Map((clients || []).map((c) => [c.id, c.name]));
      const clientsOf = (userId: string) =>
        (accessRows || []).filter((a) => a.user_id === userId).map((a) => clientName.get(a.client_id)).filter(Boolean).join(", ");
      setUsers(
        (accounts || []).map((a) => {
          const p = profileById.get(a.user_id);
          return {
            user_id: a.user_id,
            email: a.email || "—",
            name: p?.name || "—",
            company: clientsOf(a.user_id),
            last_sign_in_at: a.last_sign_in_at,
          };
        })
      );
      setLoading(false);
    })();
  }, [authLoading, user, isAdmin, navigate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => !q || `${u.name} ${u.email} ${u.company}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, search]);

  const openDialog = (u: UserRow) => {
    setTarget(u);
    setPassword("");
    setConfirm("");
    setShow(false);
  };

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSave = password.length >= MIN_LENGTH && password === confirm && !saving;

  const handleSave = async () => {
    if (!target || !canSave) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_set_user_password", { _user_id: target.user_id, _new_password: password });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "✅", description: `${tr(STR.passwordUpdatedFor, isEnglish)} ${target.name !== "—" ? target.name : target.email}` });
    setTarget(null);
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(isEnglish ? "en-US" : "es-CO", { year: "numeric", month: "short", day: "numeric" }) : "—";

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-5xl w-full mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{tr(STR.passwordsNav, isEnglish)}</h1>
          <p className="text-sm text-muted-foreground">{tr(STR.passwordsPageDesc, isEnglish)}</p>
        </div>
      </div>

      <Card className="neon-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base">{users.length} {tr(STR.accountsWord, isEnglish)}</CardTitle>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={tr(STR.searchUsersPlaceholder, isEnglish)}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-muted border-border text-foreground h-9 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : loadError ? (
            <p className="text-destructive text-sm py-6 text-center">{loadError}</p>
          ) : (
            <div className="divide-y divide-border/40">
              {filtered.map((u) => (
                <div key={u.user_id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {(u.name !== "—" ? u.name : u.email)[0]?.toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {u.email}{u.company ? ` · ${u.company}` : ""} · {tr(STR.lastSignInLabel, isEnglish)}: {fmtDate(u.last_sign_in_at)}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openDialog(u)} className="shrink-0">
                    <KeyRound className="h-4 w-4 mr-1" />
                    {tr(STR.changePasswordButton, isEnglish)}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(open) => { if (!open) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr(STR.changePasswordButton, isEnglish)}</DialogTitle>
            <DialogDescription>
              {target?.name} · {target?.email}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{tr(STR.newPasswordLabel, isEnglish)}</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="show password"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  type="button" variant="outline" size="icon" title={tr(STR.generatePasswordTitle, isEnglish)}
                  onClick={() => { const p = generatePassword(); setPassword(p); setConfirm(p); setShow(true); }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  type="button" variant="outline" size="icon" title={tr(STR.copyWord, isEnglish)}
                  disabled={!password}
                  onClick={() => navigator.clipboard?.writeText(password)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              {tooShort && <p className="text-xs text-destructive">{tr(STR.passwordTooShort, isEnglish)}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{tr(STR.confirmPasswordLabel, isEnglish)}</label>
              <Input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
              {mismatch && <p className="text-xs text-destructive">{tr(STR.passwordsDontMatch, isEnglish)}</p>}
            </div>
            <p className="text-xs text-muted-foreground">{tr(STR.passwordHandOverHint, isEnglish)}</p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={saving}>{tr(STR.cancelWord, isEnglish)}</Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {tr(STR.savePasswordButton, isEnglish)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Passwords;

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, Check, X, Building2, Search } from "lucide-react";

interface ClientRow {
  id: string;
  name: string;
  created_at: string;
  statementsCount: number;
}

const Clients = () => {
  const { t } = useLanguage();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchClients = async () => {
    setLoading(true);
    const [{ data: clientRows, error }, { data: analysisRows }] = await Promise.all([
      supabase.from("clients").select("id, name, created_at").order("name", { ascending: true }),
      supabase.from("analyses").select("client_id"),
    ]);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const counts = new Map<string, number>();
    (analysisRows || []).forEach((r: any) => {
      if (r.client_id) counts.set(r.client_id, (counts.get(r.client_id) || 0) + 1);
    });
    setClients(
      (clientRows || []).map((c: any) => ({ ...c, statementsCount: counts.get(c.id) || 0 }))
    );
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && user) fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    navigate("/");
    return null;
  }

  const isDuplicateError = (message: string) => /duplicate key|unique/i.test(message);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast({ title: "Error", description: t("clientNameEmptyError"), variant: "destructive" });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.from("clients").insert({ name }).select("id, name, created_at").single();
    setCreating(false);
    if (error) {
      toast({
        title: "Error",
        description: isDuplicateError(error.message) ? t("clientDuplicateError") : error.message,
        variant: "destructive",
      });
      return;
    }
    setClients((prev) => [...prev, { ...(data as any), statementsCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    setNewName("");
    toast({ title: "✅", description: t("clientCreated") });
  };

  const startEdit = (client: ClientRow) => {
    setEditingId(client.id);
    setEditingName(client.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const handleSaveEdit = async (id: string) => {
    const name = editingName.trim();
    if (!name) {
      toast({ title: "Error", description: t("clientNameEmptyError"), variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("clients").update({ name }).eq("id", id);
    setSaving(false);
    if (error) {
      toast({
        title: "Error",
        description: isDuplicateError(error.message) ? t("clientDuplicateError") : error.message,
        variant: "destructive",
      });
      return;
    }
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)).sort((a, b) => a.name.localeCompare(b.name)));
    toast({ title: "✅", description: t("clientRenamed") });
    cancelEdit();
  };

  const handleDelete = async (client: ClientRow) => {
    if (!window.confirm(t("confirmDeleteClient"))) return;
    setDeletingId(client.id);
    const { error } = await supabase.from("clients").delete().eq("id", client.id);
    setDeletingId(null);
    if (error) {
      const blocked = /foreign key|violates/i.test(error.message);
      toast({
        title: "Error",
        description: blocked ? t("clientDeleteBlockedError") : error.message,
        variant: "destructive",
      });
      return;
    }
    setClients((prev) => prev.filter((c) => c.id !== client.id));
    toast({ title: "✅", description: t("clientDeleted") });
  };

  const filtered = useMemo(
    () => clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
    [clients, search]
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6 opacity-0 animate-fade-in">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{t("clientsPageTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("clientsPageDesc")}</p>
          </div>
        </div>

        <Card className="neon-border bg-card shadow-2xl mb-6 opacity-0 animate-scale-in stagger-2">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                autoFocus
                placeholder={t("clientNamePlaceholder")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) handleCreate(); }}
                className="bg-muted border-border text-foreground"
              />
              {/* Disabled while empty instead of only validating on click — a click that produces
                  nothing but an error toast reads, to a first-time visitor, like the button is
                  broken rather than like the field needs text first. */}
              <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="neon-glow shrink-0">
                {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                {t("addClient")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="neon-border bg-card shadow-2xl opacity-0 animate-slide-up stagger-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Building2 className="h-5 w-5 text-primary" />
                {clients.length} {t("clientsPageTitle").toLowerCase()}
              </CardTitle>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchClientsPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-muted border-border text-foreground h-9 text-sm"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">{t("noClientsYet")}</p>
            ) : (
              <div className="divide-y divide-border/40">
                {filtered.map((client, i) => (
                  <div
                    key={client.id}
                    className="flex items-center justify-between gap-3 py-3 opacity-0 animate-fade-in"
                    style={{ animationDelay: `${0.03 * i}s` }}
                  >
                    {editingId === client.id ? (
                      <>
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(client.id); if (e.key === "Escape") cancelEdit(); }}
                          autoFocus
                          className="bg-muted border-border text-foreground h-9"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="ghost" disabled={saving} onClick={() => handleSaveEdit(client.id)}
                            className="text-primary hover:text-primary hover:bg-primary/10">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={saving} onClick={cancelEdit}
                            className="text-muted-foreground">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {client.name[0]?.toUpperCase() || "?"}
                          </div>
                          <span className="font-medium text-foreground truncate">{client.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            ({client.statementsCount} {t("statementsCountLabel")})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="ghost" onClick={() => startEdit(client)}
                            className="text-muted-foreground hover:text-primary hover:bg-primary/10">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {isAdmin && (
                            <Button
                              size="sm" variant="ghost"
                              disabled={deletingId === client.id}
                              onClick={() => handleDelete(client)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              {deletingId === client.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Clients;

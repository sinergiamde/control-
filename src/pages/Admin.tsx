import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Users, ShieldCheck, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import Navbar from "@/components/Navbar";
import { useToast } from "@/hooks/use-toast";

interface UserProfile {
  user_id: string;
  name: string;
  phone: string;
  country: string;
  created_at: string;
}

const Admin = () => {
  const { t } = useLanguage();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, name, phone, country, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && user && isAdmin) {
      fetchUsers();
    }
  }, [authLoading, user, isAdmin]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    navigate("/dashboard");
    return null;
  }

  const handleDelete = async (userId: string) => {
    setDeleting(userId);
    const { error } = await supabase.from("profiles").delete().eq("user_id", userId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("userDeleted"), className: "border-primary text-primary" });
      setUsers((prev) => prev.filter((u) => u.user_id !== userId));
    }
    setDeleting(null);
  };

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.country.toLowerCase().includes(search.toLowerCase()) ||
    u.phone.includes(search)
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6 opacity-0 animate-fade-in">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{t("adminPanel")}</h1>
            <p className="text-sm text-muted-foreground">{users.length} {t("allUsers").toLowerCase()}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Total Users", value: users.length, color: "text-primary" },
            { label: "Countries", value: [...new Set(users.map(u => u.country).filter(Boolean))].length, color: "text-primary" },
            { label: "This Month", value: users.filter(u => new Date(u.created_at) > new Date(Date.now() - 30 * 86400000)).length, color: "text-primary" },
          ].map((stat, i) => (
            <Card key={stat.label} className="neon-border bg-card opacity-0 animate-count-up hover-lift"
              style={{ animationDelay: `${0.1 * (i + 1)}s` }}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="neon-border bg-card shadow-2xl opacity-0 animate-slide-up stagger-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Users className="h-5 w-5 text-primary" />
                {t("allUsers")}
              </CardTitle>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
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
              <p className="text-muted-foreground text-center py-8">{t("noUsers")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">{t("name")}</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden sm:table-cell">{t("phone")}</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">{t("country")}</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">{t("joined")}</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u, i) => (
                      <tr key={u.user_id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-all duration-200 opacity-0 animate-fade-in"
                        style={{ animationDelay: `${0.05 * i}s` }}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                              {(u.name || "?")[0].toUpperCase()}
                            </div>
                            <span className="font-medium text-foreground">{u.name || "—"}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground hidden sm:table-cell">{u.phone || "—"}</td>
                        <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{u.country || "—"}</td>
                        <td className="py-3 px-4 text-muted-foreground hidden lg:table-cell">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {u.user_id !== user.id && (
                            <Button variant="ghost" size="sm"
                              onClick={() => handleDelete(u.user_id)}
                              disabled={deleting === u.user_id}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 hover:scale-110 transition-all duration-200">
                              {deleting === u.user_id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Admin;

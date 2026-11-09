import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, Loader2, Lock, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

/** Administration home (TaxForYou admins): one card per area, with live counts. */
const AdminHub = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState<{ users: number; pending: number; elevated: number } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/"); return; }
    // Everyone who isn't a TaxForYou admin only has the authorized-users screen.
    if (!isAdmin) { navigate("/admin/users", { replace: true }); return; }
    (async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("user_id, reviewed_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const admins = new Set((roles || []).filter((r) => r.role === "admin").map((r) => r.user_id));
      setCounts({
        users: (profiles || []).length,
        pending: (profiles || []).filter((p) => !p.reviewed_at && !admins.has(p.user_id)).length,
        elevated: new Set((roles || []).map((r) => r.user_id)).size,
      });
    })();
  }, [authLoading, user, isAdmin, navigate]);

  if (authLoading || !counts) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const cards = [
    {
      to: "/admin/users",
      icon: Users,
      title: tr(STR.hubUsersTitle, isEnglish),
      desc: tr(STR.hubUsersDesc, isEnglish).replace("{n}", String(counts.users)).replace("{p}", String(counts.pending)),
    },
    {
      to: "/admin/permissions",
      icon: Lock,
      title: tr(STR.hubRolesTitle, isEnglish),
      desc: tr(STR.hubRolesDesc, isEnglish).replace("{n}", String(counts.elevated)),
    },
    {
      to: "/passwords",
      icon: KeyRound,
      title: tr(STR.passwordsNav, isEnglish),
      desc: tr(STR.passwordsPageDesc, isEnglish),
    },
  ];

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-6xl w-full mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{tr(STR.usersAndPermissionsNav, isEnglish)}</h1>
          <p className="text-sm text-muted-foreground">{tr(STR.hubDesc, isEnglish)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((c) => (
          <button
            key={c.to}
            type="button"
            onClick={() => navigate(c.to)}
            className="group text-left rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_hsl(0_0%_0%/0.06)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-5">
              <c.icon className="h-6 w-6 text-primary" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-bold text-foreground">{c.title}</p>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
          </button>
        ))}
      </div>
    </main>
  );
};

export default AdminHub;

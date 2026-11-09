import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Building2, ChevronRight, CornerDownRight, Crown, FileText, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Receipt, Settings as SettingsIcon,
  Search, ShieldCheck, Sparkles, Sun, Users, X,
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { FlagIcon } from "@/components/FlagIcon";
import NotificationsBell from "@/components/NotificationsBell";
import PasswordForm from "@/components/PasswordForm";
import { TrialBanner, TrialEndedDialog } from "@/components/SubscribePrompt";
import UserAvatar from "@/components/UserAvatar";
import { fetchClientNodes, type ClientNode } from "@/utils/clientTree";
import { STR, tr } from "@/utils/i18n";

/** Pages register a "you'll lose something" message here (e.g. statements picked but not analyzed
 * yet); every sidebar navigation and logout asks for confirmation while one is set. */
const NavGuardContext = createContext<(message: string | undefined) => void>(() => {});

export const useNavGuard = (message: string | undefined) => {
  const setGuard = useContext(NavGuardContext);
  useEffect(() => {
    setGuard(message);
    return () => setGuard(undefined);
  }, [message, setGuard]);
};

const linkClass = (active: boolean) =>
  `relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
    active
      ? "bg-sidebar-accent text-sidebar-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/70"
  }`;

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/35 mb-1.5">{children}</p>
);

/** CTRL+ by TaxForYou. The sidebar leads with the two things people come for — analyze a statement,
 * upload a receipt — then their dashboard and clients, and the admin tools for who may use them.
 * TaxForYou's own brand (and crown) is reserved for its administrators; everyone else sees their
 * own account name. */
const AppLayout = () => {
  const { lang, setLang, t } = useLanguage();
  const isEnglish = lang === "en";
  const { user, profile, role, isAdmin, permissions, logout, loading, refreshProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [clientsOpen, setClientsOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mobileOpen, setMobileOpen] = useState(false);
  const guardRef = useRef<string | undefined>(undefined);
  const setGuard = useCallback((message: string | undefined) => { guardRef.current = message; }, []);

  // Reload on every route change so a company created/renamed/deleted elsewhere shows up here.
  useEffect(() => {
    if (!user) return;
    fetchClientNodes().then(setNodes);
  }, [user, location.pathname]);

  useEffect(() => {
    if (!loading && !user) navigate("/");
  }, [loading, user, navigate]);

  const roots = useMemo(() => nodes.filter((n) => !n.parent_id).sort((a, b) => a.name.localeCompare(b.name)), [nodes]);
  const childrenOf = (id: string) => nodes.filter((n) => n.parent_id === id).sort((a, b) => a.name.localeCompare(b.name));
  const activeClientId = location.pathname.match(/^\/clients\/([^/]+)/)?.[1];

  // Keep the open company's parent expanded so the current page is always visible in the tree.
  useEffect(() => {
    const active = nodes.find((n) => n.id === activeClientId);
    if (active?.parent_id) setExpanded((prev) => new Set(prev).add(active.parent_id!));
  }, [activeClientId, nodes]);

  const go = (to: string) => {
    if (guardRef.current && !window.confirm(guardRef.current)) return;
    setMobileOpen(false);
    navigate(to);
  };

  const handleLogout = async () => {
    if (guardRef.current && !window.confirm(guardRef.current)) return;
    await logout();
    navigate("/");
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? nodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 6) : [];
  }, [nodes, query]);
  const pageTitle = (() => {
    const path = location.pathname;
    if (path.startsWith("/clients/")) return nodes.find((n) => n.id === activeClientId)?.name || t("clientsNav");
    const titles: Record<string, string> = {
      "/analyze": tr(STR.analyzeNav, isEnglish),
      "/receipts": tr(STR.receiptsTitle, isEnglish),
      "/dashboard": tr(STR.generalDashboardNav, isEnglish),
      "/clients": t("clientsNav"),
      "/results": tr(STR.analyzeTitle, isEnglish),
      "/history": tr(STR.statementsNav, isEnglish),
      "/admin": tr(STR.usersAndPermissionsNav, isEnglish),
      "/admin/users": tr(isAdmin ? STR.hubUsersTitle : STR.authorizedUsersNav, isEnglish),
      "/admin/permissions": tr(STR.hubRolesTitle, isEnglish),
      "/passwords": tr(STR.passwordsNav, isEnglish),
      "/settings": tr(STR.settingsNav, isEnglish),
    };
    return titles[path] || "CTRL+";
  })();
  const displayName = profile?.name || user?.email?.split("@")[0] || t("userFallback");
  const roleLabel = tr(role === "accountant" ? STR.roleAccountant : role === "authorized" ? STR.roleAuthorized : STR.roleUser, isEnglish);

  const sidebar = (
    <aside className="w-64 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="h-16 flex items-center justify-between gap-2 px-4 border-b border-sidebar-border shrink-0">
        <button type="button" onClick={() => go("/analyze")} className="flex items-baseline gap-2">
          <span className="text-xl font-black tracking-tight text-sidebar-primary neon-text">CTRL+</span>
          <span className="text-xs font-light text-sidebar-foreground/60">
            by <span className="text-sidebar-primary/80 font-medium">TaxForYou</span>
          </span>
        </button>
        <button type="button" onClick={() => setMobileOpen(false)} className="md:hidden text-sidebar-foreground/60" aria-label="close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => go("/analyze")}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-bold transition-all bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:brightness-110 ${
              location.pathname === "/analyze" ? "ring-2 ring-sidebar-primary/40 ring-offset-2 ring-offset-sidebar" : ""
            }`}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            {tr(STR.analyzeNav, isEnglish)}
          </button>
          <button
            type="button"
            onClick={() => go("/receipts")}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
              location.pathname === "/receipts"
                ? "border-sidebar-primary bg-sidebar-primary/15 text-sidebar-primary"
                : "border-sidebar-primary/40 text-sidebar-primary hover:bg-sidebar-primary/10"
            }`}
          >
            <Receipt className="h-4 w-4 shrink-0" />
            {tr(STR.uploadReceiptNav, isEnglish)}
          </button>
        </div>

        <div className="space-y-1">
          <SectionLabel>
            {isAdmin ? (
              <span className="inline-flex items-center gap-1"><Crown className="h-3 w-3" /> TaxForYou</span>
            ) : (
              <span className="normal-case tracking-normal text-[11px]">{displayName}</span>
            )}
          </SectionLabel>
          <button type="button" onClick={() => go("/dashboard")} className={linkClass(location.pathname === "/dashboard")}>
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr(STR.generalDashboardNav, isEnglish)}</span>
          </button>
          <button type="button" onClick={() => go("/history")} className={linkClass(location.pathname === "/history")}>
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr(STR.statementsNav, isEnglish)}</span>
          </button>
          <button type="button" onClick={() => go("/receipts")} className={linkClass(location.pathname === "/receipts")}>
            <Receipt className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr(STR.receiptsNav, isEnglish)}</span>
          </button>

          <div className="flex items-center">
            <button type="button" onClick={() => go("/clients")} className={linkClass(location.pathname === "/clients")}>
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1 text-left">{t("clientsNav")}</span>
              <span className="text-[10px] text-sidebar-foreground/40">{roots.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setClientsOpen((v) => !v)}
              className="p-2 text-sidebar-foreground/50 hover:text-sidebar-foreground"
              aria-label="toggle clients"
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${clientsOpen ? "rotate-90" : ""}`} />
            </button>
          </div>

          {clientsOpen && (
            <div className="ml-3 pl-2 border-l border-sidebar-border space-y-0.5">
              {roots.length === 0 && (
                <p className="px-2 py-1 text-xs text-sidebar-foreground/40">{t("noClientsYet")}</p>
              )}
              {roots.map((root) => {
                const kids = childrenOf(root.id);
                const isOpen = expanded.has(root.id);
                return (
                  <div key={root.id}>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => go(`/clients/${root.id}`)}
                        className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md text-xs truncate transition-colors ${
                          activeClientId === root.id
                            ? "bg-sidebar-primary/15 text-sidebar-primary font-semibold"
                            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                        }`}
                        title={root.name}
                      >
                        {root.name}
                      </button>
                      {kids.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggle(root.id)}
                          className="p-1 text-sidebar-foreground/40 hover:text-sidebar-foreground"
                          aria-label="toggle sub-companies"
                        >
                          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        </button>
                      )}
                    </div>
                    {isOpen &&
                      kids.map((kid) => (
                        <button
                          key={kid.id}
                          type="button"
                          onClick={() => go(`/clients/${kid.id}`)}
                          className={`w-full flex items-center gap-1 pl-4 pr-2 py-1 rounded-md text-xs truncate transition-colors ${
                            activeClientId === kid.id
                              ? "bg-sidebar-primary/15 text-sidebar-primary font-semibold"
                              : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                          }`}
                          title={kid.name}
                        >
                          <CornerDownRight className="h-3 w-3 shrink-0" />
                          <span className="truncate">{kid.name}</span>
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {isAdmin ? (
          <div className="space-y-1">
            <SectionLabel>{tr(STR.adminSectionLabel, isEnglish)}</SectionLabel>
            <button type="button" onClick={() => go("/admin")} className={linkClass(location.pathname.startsWith("/admin"))}>
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr(STR.usersAndPermissionsNav, isEnglish)}</span>
            </button>
            <button type="button" onClick={() => go("/passwords")} className={linkClass(location.pathname === "/passwords")}>
              <KeyRound className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr(STR.passwordsNav, isEnglish)}</span>
            </button>
          </div>
        ) : permissions.designate && (
          <div className="space-y-1">
            <SectionLabel>{tr(STR.adminSectionLabel, isEnglish)}</SectionLabel>
            <button type="button" onClick={() => go("/admin/users")} className={linkClass(location.pathname.startsWith("/admin"))}>
              <Users className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr(STR.authorizedUsersNav, isEnglish)}</span>
            </button>
          </div>
        )}

        <div className="space-y-1">
          <SectionLabel>{tr(STR.myAccountSection, isEnglish)}</SectionLabel>
          <button type="button" onClick={() => go("/settings")} className={linkClass(location.pathname === "/settings")}>
            <SettingsIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr(STR.settingsNav, isEnglish)}</span>
          </button>
        </div>
      </nav>

    </aside>
  );

  // A provisional password (set by an administrator) must be replaced before anything else.
  if (profile?.must_change_password) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="text-center space-y-1">
            <p className="text-xl font-bold text-foreground">{tr(STR.mustChangeTitle, isEnglish)}</p>
            <p className="text-sm text-muted-foreground">{tr(STR.mustChangeDesc, isEnglish)}</p>
          </div>
          <PasswordForm submitLabel={tr(STR.continueButton, isEnglish)} onDone={refreshProfile} />
          <button type="button" onClick={handleLogout} className="w-full text-xs text-muted-foreground hover:text-foreground">
            {t("logout")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <NavGuardContext.Provider value={setGuard}>
      <div className="min-h-screen flex bg-background">
        <div className="hidden md:block h-screen sticky top-0 shrink-0">{sidebar}</div>

        {mobileOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="h-full">{sidebar}</div>
            <button type="button" className="flex-1 bg-black/60" onClick={() => setMobileOpen(false)} aria-label="close menu" />
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-14 flex items-center gap-3 px-4 sm:px-6 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur">
            <button type="button" onClick={() => setMobileOpen(true)} aria-label="menu" className="md:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <nav className="hidden sm:flex items-center gap-1.5 text-sm min-w-0" aria-label="breadcrumb">
              <span className="text-muted-foreground">{isAdmin ? "TaxForYou" : "CTRL+"}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="font-semibold text-foreground truncate">{pageTitle}</span>
            </nav>
            <div className="relative flex-1 max-w-md ml-auto hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
                placeholder={t("searchClientsPlaceholder")}
                className="w-full h-9 rounded-lg border border-border bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              {searchOpen && query.trim() && (
                <div className="absolute left-0 right-0 top-11 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                  {matches.length === 0 ? (
                    <p className="px-3 py-2.5 text-sm text-muted-foreground">{t("noClientsYet")}</p>
                  ) : (
                    matches.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setQuery(""); setSearchOpen(false); go(`/clients/${n.id}`); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted"
                      >
                        <Building2 className="h-4 w-4 text-primary shrink-0" />
                        <span className="truncate">{n.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0 max-md:ml-auto">
              <div className="flex items-center rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Language / Idioma">
                {([["en", "us", "EN"], ["es", "es", "ES"]] as const).map(([code, flag, label]) => (
                  <button
                    key={code}
                    type="button" onClick={() => setLang(code)} aria-pressed={lang === code}
                    title={code === "en" ? "English" : "Español"}
                    className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors ${
                      lang === code ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <FlagIcon country={flag} className="w-3.5 h-2.5 rounded-[1px] shrink-0" /> {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                title={tr(theme === "light" ? STR.themeDark : STR.themeLight, isEnglish)}
                aria-label={tr(STR.themeSection, isEnglish)}
                className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
              <NotificationsBell refreshKey={location.pathname} onNavigate={go} />
              <button
                type="button" onClick={() => go("/settings")} title={tr(STR.settingsNav, isEnglish)}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted min-w-0"
              >
                <UserAvatar name={displayName} url={profile?.avatar_url} className="w-8 h-8" />
                <span className="hidden lg:block text-left min-w-0">
                  <span className="block text-sm text-foreground truncate max-w-[200px] leading-tight">{user?.email}</span>
                  <span className="block text-[10px] text-primary leading-tight">{isAdmin ? `${tr(STR.roleAdmin, isEnglish)} · TaxForYou` : roleLabel}</span>
                </span>
              </button>
              <button
                type="button" onClick={handleLogout}
                className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">{t("logout")}</span>
              </button>
            </div>
          </header>
          <TrialBanner />
          <Outlet />
          <TrialEndedDialog />
        </div>
      </div>
    </NavGuardContext.Provider>
  );
};

export default AppLayout;

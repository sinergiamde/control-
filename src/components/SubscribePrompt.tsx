import { useEffect, useState } from "react";
import { Clock, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

export interface TrialStatus {
  /** "trial" while the 24 hours run, "ended" once uploads are paused, "none" for admins and
   * subscribers (and databases that predate trials). */
  state: "none" | "trial" | "ended";
  msLeft: number;
  uploadsLocked: boolean;
}

/** Re-evaluated every minute, so the banner counts down and uploads lock the moment the trial
 * ends without a reload (the database enforces the same cut-off). */
export const useTrialStatus = (): TrialStatus => {
  const { profile, isAdmin, role, canUpload } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (isAdmin) return { state: "none", msLeft: 0, uploadsLocked: false };
  // An authorized user has no trial of their own: they ride on whoever designated them.
  if (role === "authorized") return { state: canUpload ? "none" : "ended", msLeft: 0, uploadsLocked: !canUpload };
  if (!profile || profile.subscribed || !profile.trial_ends_at) {
    return { state: canUpload ? "none" : "ended", msLeft: 0, uploadsLocked: !canUpload };
  }
  const msLeft = new Date(profile.trial_ends_at).getTime() - now;
  if (msLeft <= 0 || !canUpload) return { state: "ended", msLeft: 0, uploadsLocked: true };
  return { state: "trial", msLeft, uploadsLocked: false };
};

/** Tells TaxForYou's admins (in-app) and opens WhatsApp or email with TaxForYou when configured. */
export const useSubscribe = () => {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const subscribe = async () => {
    setBusy(true);
    const [{ error }, { data: settings }] = await Promise.all([
      supabase.rpc("request_subscription"),
      supabase.from("app_settings").select("key, value").in("key", ["subscribe_whatsapp", "subscribe_email"]),
    ]);
    setBusy(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    const value = (key: string) => (settings || []).find((s) => s.key === key)?.value?.trim() || "";
    const message = tr(STR.subscribeWhatsappText, isEnglish).replace("{email}", user?.email || "");
    const whatsapp = value("subscribe_whatsapp").replace(/\D/g, "");
    const email = value("subscribe_email");
    if (whatsapp) {
      window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
    } else if (email) {
      window.location.href = `mailto:${email}?subject=${encodeURIComponent("CTRL+")}&body=${encodeURIComponent(message)}`;
    }
    toast({ title: "✅", description: tr(STR.subscribeRequestSent, isEnglish) });
  };

  return { subscribe, busy };
};

export const SubscribeButton = ({ className = "" }: { className?: string }) => {
  const { lang } = useLanguage();
  const { subscribe, busy } = useSubscribe();
  return (
    <Button onClick={subscribe} disabled={busy} className={`neon-glow ${className}`}>
      <Sparkles className="h-4 w-4 mr-1" />
      {tr(STR.subscribeButton, lang === "en")}
    </Button>
  );
};

/** Replaces an upload box once the trial is over: says why, and how to keep going. */
export const UploadLockedCard = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { role } = useAuth();
  return (
    <Card className="neon-border bg-card">
      <CardContent className="p-6 sm:p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <p className="text-lg font-bold text-foreground">{tr(STR.trialEndedTitle, isEnglish)}</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {tr(role === "authorized" ? STR.authorizedPlanEnded : STR.trialEndedDesc, isEnglish)}
        </p>
        {role !== "authorized" && <SubscribeButton />}
      </CardContent>
    </Card>
  );
};

const ENDED_SEEN_KEY = "ctrl-plus-trial-ended-seen";

/** The clear "subscribe to keep going" alert, once per session when the trial is over. */
export const TrialEndedDialog = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { role } = useAuth();
  const { state } = useTrialStatus();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state !== "ended" || role === "authorized") return;
    let seen = false;
    try { seen = sessionStorage.getItem(ENDED_SEEN_KEY) === "1"; } catch { /* storage blocked */ }
    if (seen) return;
    setOpen(true);
    try { sessionStorage.setItem(ENDED_SEEN_KEY, "1"); } catch { /* storage blocked */ }
  }, [state, role]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            {tr(STR.trialEndedTitle, isEnglish)}
          </DialogTitle>
          <DialogDescription>{tr(STR.trialEndedDesc, isEnglish)}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{tr(STR.laterWord, isEnglish)}</Button>
          <SubscribeButton />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Slim countdown shown at the top of every screen during the trial. */
export const TrialBanner = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { state, msLeft } = useTrialStatus();
  if (state !== "trial") return null;
  const hours = Math.floor(msLeft / 3_600_000);
  const text = hours >= 1
    ? tr(STR.trialHoursLeft, isEnglish).replace("{h}", String(hours))
    : tr(STR.trialMinutesLeft, isEnglish).replace("{m}", String(Math.max(1, Math.ceil(msLeft / 60_000))));
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs border-b border-primary/20 bg-primary/5 text-primary">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
};

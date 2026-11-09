import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

const MIN_PASSWORD = 8;

/** Choose a new password (new + confirm). Used after a recovery email link and when an administrator
 * handed out a provisional password. Clears the "must change" flag once it's done. */
const PasswordForm = ({ onDone, submitLabel }: { onDone: () => void; submitLabel?: string }) => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= MIN_PASSWORD && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSaving(false);
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    // Harmless where the column/function doesn't exist yet.
    await supabase.rpc("clear_must_change_password");
    setSaving(false);
    toast({ title: "✅", description: tr(STR.passwordChanged, isEnglish) });
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">{tr(STR.newPasswordLabel, isEnglish)}</label>
        <div className="relative">
          <Input
            type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password" autoFocus className="pr-9"
          />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label="show password"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {tooShort && <p className="text-xs text-destructive">{tr(STR.passwordTooShort, isEnglish)}</p>}
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">{tr(STR.confirmPasswordLabel, isEnglish)}</label>
        <Input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {mismatch && <p className="text-xs text-destructive">{tr(STR.passwordsDontMatch, isEnglish)}</p>}
      </div>
      <Button type="submit" disabled={!valid || saving} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />}
        {submitLabel ?? tr(STR.savePasswordButton, isEnglish)}
      </Button>
    </form>
  );
};

export default PasswordForm;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import PasswordForm from "@/components/PasswordForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

/** Where the "Forgot my password" email link lands: the person is signed in by the link, and has
 * to choose a new password right away. */
const ResetPassword = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const navigate = useNavigate();
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    // The link's session is read from the URL on load; give it a moment before calling it invalid.
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setReady(!!data.session);
    }, 1500);
    return () => { subscription.unsubscribe(); window.clearTimeout(timer); };
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <KeyRound className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-xl">{tr(STR.resetTitle, isEnglish)}</CardTitle>
          <p className="text-sm text-muted-foreground">{tr(STR.resetDesc, isEnglish)}</p>
        </CardHeader>
        <CardContent>
          {ready === null ? (
            <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : ready ? (
            <PasswordForm onDone={() => navigate("/analyze", { replace: true })} />
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-sm text-destructive">{tr(STR.resetLinkInvalid, isEnglish)}</p>
              <button type="button" onClick={() => navigate("/")} className="text-sm text-primary font-semibold hover:underline">
                {tr(STR.backToLogin, isEnglish)}
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;

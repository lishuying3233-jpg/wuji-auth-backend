import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";
import { Loader2, Lock, Shield, User } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { t } = useLanguage();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success(t("loginSuccess"));
      window.location.href = "/admin";
    },
    onError: (error) => {
      toast.error(error.message || t("loginFailed"));
    },
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <div className="glass-card w-full max-w-md space-y-8 rounded-[2.5rem] border border-white/60 bg-white/40 p-10 shadow-2xl shadow-purple-100/50 backdrop-blur-3xl">
        <div className="space-y-2 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-800 shadow-xl">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="font-serif text-4xl italic tracking-tight text-slate-800">{t("loginTitle")}</h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">{t("loginSubtitle")}</p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            loginMutation.mutate({ username, password });
          }}
        >
          <div className="group relative">
            <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300 transition-colors group-focus-within:text-slate-500" aria-hidden="true" />
            <Input
              autoComplete="username"
              placeholder={t("enterUsername")}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="h-14 rounded-2xl border-none bg-white/60 pl-12 shadow-inner focus-visible:ring-primary/10"
            />
          </div>
          <div className="group relative">
            <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300 transition-colors group-focus-within:text-slate-500" aria-hidden="true" />
            <Input
              autoComplete="current-password"
              type="password"
              placeholder={t("enterPassword")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-14 rounded-2xl border-none bg-white/60 pl-12 shadow-inner focus-visible:ring-primary/10"
            />
          </div>
          <Button
            type="submit"
            disabled={loginMutation.isPending || !username.trim() || !password}
            className="mt-4 h-14 w-full rounded-2xl bg-slate-800 font-bold text-white shadow-xl transition-all hover:bg-slate-900 active:scale-95"
          >
            {loginMutation.isPending ? <Loader2 className="animate-spin" aria-label={t("loading")} /> : t("authenticate")}
          </Button>
        </form>

        <div className="pt-4 text-center">
          <p className="text-[9px] font-medium uppercase tracking-widest text-slate-300 italic">{t("authorizedPersonnel")}</p>
          <p className="pt-3 text-[9px] text-slate-300">{t("secureProtocol")}</p>
        </div>
      </div>
    </div>
  );
}

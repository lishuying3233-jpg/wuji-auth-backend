import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";
import { ArrowRight, Github, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const { t } = useLanguage();
  const displayName = (user as any)?.username || (user as any)?.name || "Admin";

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-6">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <div className="glass w-full max-w-2xl space-y-8 rounded-[3rem] p-12 text-center shadow-2xl shadow-purple-100/30 animate-in fade-in zoom-in duration-700">
        <div className="space-y-2">
          <h1 className="text-7xl font-serif italic tracking-tighter text-slate-800">{t("brand")}</h1>
          <p className="font-sans text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">{t("homeTitle")}</p>
          <p className="pt-2 text-sm text-slate-400">{t("homeSubtitle")}</p>
        </div>

        <div className="mx-auto h-px w-24 bg-slate-200" />

        <p className="mx-auto max-w-md font-serif text-lg italic leading-relaxed text-slate-600">
          “{t("homeQuote")}”
        </p>

        <div className="flex flex-col items-center gap-4 pt-8">
          {loading ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-primary" aria-label={t("loading")} />
          ) : !isAuthenticated ? (
            <Link href="/login">
              <Button className="group h-14 rounded-2xl bg-slate-800 px-10 text-white shadow-2xl transition-all hover:bg-slate-700 active:scale-95">
                {t("adminLogin")}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
          ) : (
            <div className="flex flex-col items-center gap-6">
              <div className="flex items-center gap-3 rounded-2xl border border-white/50 bg-white/50 px-6 py-3">
                <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <span className="font-sans text-sm tracking-wider text-slate-600">{t("welcome", { name: displayName })}</span>
              </div>

              <div className="flex gap-4">
                <Link href="/admin">
                  <Button className="h-14 rounded-2xl bg-primary px-10 text-primary-foreground shadow-xl shadow-primary/20 transition-all hover:bg-primary/90 active:scale-95">
                    {t("enterConsole")}
                  </Button>
                </Link>
                <Button variant="ghost" onClick={() => logout()} className="h-14 rounded-2xl px-8 text-slate-400 hover:bg-white/50 hover:text-slate-600">
                  {t("logout")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-8 pt-12 text-slate-300">
          <Github className="h-5 w-5 opacity-50" aria-hidden="true" />
          <div className="h-4 w-px bg-slate-200" />
          <ShieldCheck className="h-5 w-5 opacity-50" aria-hidden="true" />
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-8 text-[10px] font-bold uppercase tracking-[0.4em] text-slate-400">{t("secureFooter")}</div>
    </div>
  );
}

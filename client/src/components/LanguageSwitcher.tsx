import { Languages } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();

  return (
    <div className={`inline-flex items-center gap-1 rounded-2xl border border-white/60 bg-white/45 p-1 shadow-sm backdrop-blur-xl ${compact ? "" : "px-1"}`} aria-label={t("selectLanguage")}>
      <Languages className="ml-2 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setLocale("zh-CN")}
        aria-pressed={locale === "zh-CN"}
        className={`rounded-xl px-3 py-1.5 text-[10px] font-bold transition-all ${locale === "zh-CN" ? "bg-white text-slate-700 shadow-sm" : "text-slate-400 hover:bg-white/60 hover:text-slate-600"}`}
      >
        {t("chinese")}
      </button>
      <button
        type="button"
        onClick={() => setLocale("en-US")}
        aria-pressed={locale === "en-US"}
        className={`rounded-xl px-3 py-1.5 text-[10px] font-bold transition-all ${locale === "en-US" ? "bg-white text-slate-700 shadow-sm" : "text-slate-400 hover:bg-white/60 hover:text-slate-600"}`}
      >
        {t("english")}
      </button>
    </div>
  );
}

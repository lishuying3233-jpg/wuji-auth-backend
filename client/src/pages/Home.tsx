import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Streamdown } from 'streamdown';

/**
 * All content in this page are only for example, replace with your own feature implementation
 * When building pages, remember your instructions in Frontend Workflow, Frontend Best Practices, Design Guide and Common Pitfalls
 */
import { startLogin } from "@/const";
import { Link } from "wouter";
import { ShieldCheck, ArrowRight, Github } from "lucide-react";

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="glass p-12 rounded-[3rem] max-w-2xl w-full text-center space-y-8 animate-in fade-in zoom-in duration-1000">
        <div className="space-y-2">
          <h1 className="text-7xl font-serif text-slate-800 tracking-tighter italic">Wuji Auth</h1>
          <p className="text-slate-500 font-sans tracking-[0.3em] uppercase text-[10px] font-bold">Cloud License Management System</p>
        </div>

        <div className="h-[1px] w-24 bg-slate-200 mx-auto"></div>

        <p className="text-slate-600 font-serif text-lg leading-relaxed italic max-w-md mx-auto">
          "A sanctuary for secure, ethereal, and sustainable software authorization."
        </p>

        <div className="pt-8 flex flex-col items-center gap-4">
          {loading ? (
            <Loader2 className="animate-spin text-slate-300" />
          ) : !isAuthenticated ? (
            <Link href="/login">
              <Button 
                className="rounded-2xl h-14 px-10 bg-slate-800 hover:bg-slate-700 text-white shadow-2xl transition-all active:scale-95 group"
              >
                管理员登录
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          ) : (
            <div className="flex flex-col items-center gap-6">
              <div className="flex items-center gap-3 bg-white/50 px-6 py-3 rounded-2xl border border-white/50">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></div>
                <span className="text-sm font-sans tracking-wider text-slate-600">Welcome, {(user as any)?.username || (user as any)?.name || 'Admin'}</span>
              </div>
              
              <div className="flex gap-4">
                <Link href="/admin">
                  <Button className="rounded-2xl h-14 px-10 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl shadow-primary/20 transition-all active:scale-95">
                    进入控制台
                  </Button>
                </Link>
                <Button variant="ghost" onClick={() => logout()} className="rounded-2xl h-14 px-8 text-slate-400 hover:text-slate-600 hover:bg-white/50">
                  注销
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="pt-12 flex items-center justify-center gap-8 text-slate-300">
          <Github className="h-5 w-5 opacity-50 cursor-not-allowed" />
          <div className="h-4 w-[1px] bg-slate-200"></div>
          <ShieldCheck className="h-5 w-5 opacity-50 cursor-not-allowed" />
        </div>
      </div>
      
      <div className="fixed bottom-8 text-[10px] uppercase tracking-[0.4em] text-slate-400 font-bold pointer-events-none">
        Manus AI © 2026 Ethereal Auth
      </div>
    </div>
  );
}

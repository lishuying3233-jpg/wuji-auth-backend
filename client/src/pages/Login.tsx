import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Shield, Lock, User } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      window.location.href = "/admin";
    },
    onError: (err) => {
      toast.error(err.message || "登录失败");
    }
  });

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="glass-card p-10 rounded-[2.5rem] border border-white/60 shadow-2xl shadow-purple-100/50 max-w-md w-full space-y-8 bg-white/40 backdrop-blur-3xl">
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-slate-800 rounded-3xl flex items-center justify-center shadow-xl mb-6">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-serif text-slate-800 italic tracking-tight">Wuji Control</h1>
          <p className="text-[10px] text-slate-400 uppercase tracking-[0.3em] font-bold">Secure Management Access</p>
        </div>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); loginMutation.mutate({ username, password }); }}>
          <div className="relative group">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 group-focus-within:text-slate-500 transition-colors" />
            <Input 
              placeholder="Administrator Username" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              className="pl-12 h-14 rounded-2xl bg-white/60 border-none shadow-inner focus-visible:ring-primary/10"
            />
          </div>
          <div className="relative group">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 group-focus-within:text-slate-500 transition-colors" />
            <Input 
              type="password"
              placeholder="Security Password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              className="pl-12 h-14 rounded-2xl bg-white/60 border-none shadow-inner focus-visible:ring-primary/10"
            />
          </div>
          <Button 
            type="submit" 
            disabled={loginMutation.isPending}
            className="w-full h-14 rounded-2xl bg-slate-800 hover:bg-slate-900 text-white font-bold shadow-xl transition-all active:scale-95 mt-4"
          >
            {loginMutation.isPending ? <Loader2 className="animate-spin" /> : "Access Console"}
          </Button>
        </form>

        <div className="pt-4 text-center">
          <p className="text-[9px] text-slate-300 uppercase tracking-widest font-medium italic">Authorized Personnel Only</p>
        </div>
      </div>
    </div>
  );
}

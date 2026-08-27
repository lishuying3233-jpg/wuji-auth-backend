import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Copy, Trash2, ShieldCheck, ShieldAlert, Loader2, RefreshCw, Clock, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState("365");
  
  const utils = trpc.useUtils();
  
  const { data: codes, isLoading, refetch } = trpc.activation.list.useQuery({ query });
  
  const generateMutation = trpc.activation.generate.useMutation({
    onSuccess: () => {
      toast.success("激活码生成成功");
      setNote("");
      utils.activation.list.invalidate();
    }
  });
  
  const updateStatusMutation = trpc.activation.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("状态更新成功");
      utils.activation.list.invalidate();
    }
  });
  
  const deleteMutation = trpc.activation.delete.useMutation({
    onSuccess: () => {
      toast.success("删除成功");
      utils.activation.list.invalidate();
    }
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };

  if (authLoading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin" /></div>;
  if (user?.role !== 'admin') return <div className="flex items-center justify-center h-screen text-2xl font-serif text-slate-400">Unauthorized Access</div>;

  const durationOptions = [
    { label: "1 天", value: "1" },
    { label: "3 天", value: "3" },
    { label: "7 天", value: "7" },
    { label: "1 个月", value: "30" },
    { label: "3 个月", value: "90" },
    { label: "1 年", value: "365" },
  ];

  return (
    <div className="container py-12 space-y-8 max-w-6xl">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-5xl font-serif text-slate-800 tracking-tighter italic">Auth Center</h1>
          <p className="text-slate-500 font-sans tracking-[0.2em] uppercase text-xs">Wuji Assistant License Management</p>
        </div>
        
        <div className="glass p-6 rounded-2xl flex items-end gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold ml-1">New License Note</span>
            <Input 
              placeholder="备注 (如: 张三-专业版)" 
              value={note} 
              onChange={(e) => setNote(e.target.value)}
              className="border-none bg-slate-50/50 focus-visible:ring-primary/20 h-10 w-48 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold ml-1">Duration</span>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger className="w-32 border-none bg-slate-50/50 h-10 text-sm">
                <SelectValue placeholder="选择时长" />
              </SelectTrigger>
              <SelectContent>
                {durationOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button 
            onClick={() => generateMutation.mutate({ note, durationDays: parseInt(duration) })}
            disabled={generateMutation.isPending}
            className="rounded-xl h-10 px-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            {generateMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            生成激活码
          </Button>
        </div>
      </header>

      <div className="glass rounded-3xl overflow-hidden border-none shadow-2xl shadow-slate-200/50">
        <div className="p-8 border-b border-slate-100 flex items-center justify-between gap-4 bg-white/40">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="搜索激活码、机器码或备注..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-12 h-12 bg-white/60 border-none rounded-xl focus-visible:ring-accent/20 shadow-inner"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} className="rounded-xl hover:bg-white/60">
            <RefreshCw className={`h-4 w-4 text-slate-400 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <Table>
          <TableHeader className="bg-slate-50/30">
            <TableRow className="hover:bg-transparent border-none">
              <TableHead className="py-6 pl-8 font-bold text-slate-400 uppercase tracking-widest text-[10px]">激活码</TableHead>
              <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">状态</TableHead>
              <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">绑定设备 (HWID)</TableHead>
              <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">授权时长</TableHead>
              <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">到期时间</TableHead>
              <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">备注</TableHead>
              <TableHead className="text-right pr-8 font-bold text-slate-400 uppercase tracking-widest text-[10px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-64 text-center"><Loader2 className="animate-spin mx-auto opacity-20" size={48} /></TableCell></TableRow>
            ) : codes?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-64 text-center text-slate-400 font-serif italic">No activation codes found.</TableCell></TableRow>
            ) : (
              codes?.map((ac) => (
                <TableRow key={ac.id} className="group hover:bg-white/40 transition-colors border-slate-50">
                  <TableCell className="pl-8 py-6">
                    <div className="flex items-center gap-3">
                      <code className="bg-white/80 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium tracking-wider shadow-sm border border-white/50">{ac.code}</code>
                      <Button variant="ghost" size="icon" onClick={() => copyToClipboard(ac.code)} className="opacity-0 group-hover:opacity-100 h-8 w-8 rounded-lg transition-opacity">
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    {ac.status === 'active' ? (
                      <Badge className="bg-emerald-50 text-emerald-600 hover:bg-emerald-50 border-emerald-100 px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider">
                        已启用
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider">
                        已禁用
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {ac.machineId ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-mono bg-slate-50/50 px-2 py-1 rounded" title={ac.machineId}>{ac.machineId}</span>
                        <Button variant="ghost" size="icon" onClick={() => copyToClipboard(ac.machineId!)} className="h-6 w-6 rounded-md">
                          <Copy className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300 italic">未激活</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock className="w-3.5 h-3.5 text-slate-300" />
                      {ac.durationDays} 天
                    </div>
                  </TableCell>
                  <TableCell>
                    {ac.expiresAt ? (
                      <div className={`flex items-center gap-1.5 text-xs ${new Date(ac.expiresAt).getTime() < Date.now() ? 'text-red-400 font-bold' : 'text-slate-500'}`}>
                        <Calendar className="w-3.5 h-3.5 text-slate-300" />
                        {new Date(ac.expiresAt).toLocaleDateString()}
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-300 uppercase tracking-wider">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600 font-medium">
                    {ac.note || '-'}
                  </TableCell>
                  <TableCell className="text-right pr-8">
                    <div className="flex items-center justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => updateStatusMutation.mutate({ id: ac.id, status: ac.status === 'active' ? 'disabled' : 'active' })}
                        className={`h-9 w-9 rounded-xl ${ac.status === 'active' ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-500 hover:bg-emerald-50'}`}
                      >
                        {ac.status === 'active' ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => { if(confirm("确定删除此激活码？")) deleteMutation.mutate({ id: ac.id }) }}
                        className="h-9 w-9 rounded-xl text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      <footer className="flex justify-center pt-12 pb-6">
        <div className="flex items-center gap-4 text-slate-300">
          <div className="h-[1px] w-12 bg-slate-200"></div>
          <span className="font-serif italic text-sm">Finis</span>
          <div className="h-[1px] w-12 bg-slate-200"></div>
        </div>
      </footer>
    </div>
  );
}

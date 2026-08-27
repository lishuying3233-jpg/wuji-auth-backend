import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Copy, Trash2, ShieldCheck, ShieldAlert, Loader2, RefreshCw, Clock, Calendar, Hash, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState("365");
  const [filter, setFilter] = useState("all");
  
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

  const stats = useMemo(() => {
    if (!codes) return { total: 0, active: 0, expired: 0, available: 0 };
    const now = Date.now();
    return {
      total: codes.length,
      active: codes.filter(c => c.machineId && (!c.expiresAt || new Date(c.expiresAt).getTime() > now)).length,
      expired: codes.filter(c => c.expiresAt && new Date(c.expiresAt).getTime() <= now).length,
      available: codes.filter(c => !c.machineId).length,
    };
  }, [codes]);

  const filteredCodes = useMemo(() => {
    if (!codes) return [];
    const now = Date.now();
    if (filter === 'active') return codes.filter(c => c.machineId && (!c.expiresAt || new Date(c.expiresAt).getTime() > now));
    if (filter === 'expired') return codes.filter(c => c.expiresAt && new Date(c.expiresAt).getTime() <= now);
    if (filter === 'unused') return codes.filter(c => !c.machineId);
    return codes;
  }, [codes, filter]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };

  if (authLoading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-primary" /></div>;
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
    <div className="min-h-screen bg-transparent">
      <div className="container py-12 space-y-10 max-w-6xl mx-auto px-6">
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-1">
            <h1 className="text-6xl font-serif text-slate-800 tracking-tighter italic leading-tight">Auth Center</h1>
            <div className="flex items-center gap-3">
              <div className="h-[1px] w-8 bg-slate-300"></div>
              <p className="text-slate-400 font-sans tracking-[0.3em] uppercase text-[10px] font-bold">License Management Console</p>
            </div>
          </div>
          
          <div className="glass-card p-2 rounded-3xl flex items-center gap-2 shadow-2xl shadow-purple-100/50 border border-white/40">
            <div className="flex items-center gap-2 px-4">
              <Input 
                placeholder="License Note..." 
                value={note} 
                onChange={(e) => setNote(e.target.value)}
                className="border-none bg-transparent focus-visible:ring-0 h-10 w-40 text-sm placeholder:text-slate-300"
              />
              <div className="h-6 w-[1px] bg-slate-100"></div>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="w-24 border-none bg-transparent h-10 text-xs font-bold text-slate-500 focus:ring-0">
                  <SelectValue placeholder="Duration" />
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
              className="rounded-2xl h-11 px-8 bg-slate-800 hover:bg-slate-900 text-white shadow-xl transition-all active:scale-95"
            >
              {generateMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: "Total Licenses", value: stats.total, icon: Hash, color: "text-slate-400" },
            { label: "Active Devices", value: stats.active, icon: Users, color: "text-emerald-400" },
            { label: "Expired", value: stats.expired, icon: AlertTriangle, color: "text-rose-400" },
            { label: "Available", value: stats.available, icon: ShieldCheck, color: "text-blue-400" },
          ].map((item, i) => (
            <div key={i} className="glass-card p-6 rounded-3xl border border-white/60 shadow-sm space-y-2 group hover:translate-y-[-2px] transition-all">
              <div className="flex items-center justify-between">
                <item.icon className={`w-5 h-5 ${item.color} opacity-60`} />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{item.label}</span>
              </div>
              <p className="text-3xl font-serif text-slate-700">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="glass-card rounded-[2.5rem] overflow-hidden border border-white/60 shadow-2xl shadow-slate-200/40 bg-white/40 backdrop-blur-2xl">
          <div className="p-8 border-b border-white/40 flex flex-col md:flex-row items-center justify-between gap-6">
            <Tabs value={filter} onValueChange={setFilter} className="w-full md:w-auto">
              <TabsList className="bg-slate-100/50 p-1 rounded-2xl border border-white/20">
                <TabsTrigger value="all" className="rounded-xl px-6 text-xs uppercase tracking-widest font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">All</TabsTrigger>
                <TabsTrigger value="active" className="rounded-xl px-6 text-xs uppercase tracking-widest font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">Active</TabsTrigger>
                <TabsTrigger value="expired" className="rounded-xl px-6 text-xs uppercase tracking-widest font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm text-rose-400">Expired</TabsTrigger>
                <TabsTrigger value="unused" className="rounded-xl px-6 text-xs uppercase tracking-widest font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">Unused</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-4 w-full md:w-auto">
              <div className="relative flex-1 md:w-64 group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-300 transition-colors group-focus-within:text-primary" />
                <Input 
                  placeholder="Search code, HWID, note..." 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-11 h-11 bg-white/60 border-none rounded-2xl focus-visible:ring-primary/10 shadow-inner text-xs"
                />
              </div>
              <Button variant="ghost" size="icon" onClick={() => refetch()} className="rounded-2xl h-11 w-11 hover:bg-white/60">
                <RefreshCw className={`h-4 w-4 text-slate-400 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/20">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="py-6 pl-10 font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">License Key</TableHead>
                  <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Status</TableHead>
                  <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Device (HWID)</TableHead>
                  <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Duration</TableHead>
                  <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Expiry Date</TableHead>
                  <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Note</TableHead>
                  <TableHead className="text-right pr-10 font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="h-80 text-center"><Loader2 className="animate-spin mx-auto opacity-10" size={64} /></TableCell></TableRow>
                ) : filteredCodes.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-80 text-center text-slate-300 font-serif italic text-lg">No records matching your criteria.</TableCell></TableRow>
                ) : (
                  filteredCodes.map((ac) => {
                    const isExpired = ac.expiresAt && new Date(ac.expiresAt).getTime() <= Date.now();
                    return (
                      <TableRow key={ac.id} className="group hover:bg-white/60 transition-colors border-white/20">
                        <TableCell className="pl-10 py-6">
                          <div className="flex items-center gap-3">
                            <code className="bg-white/80 text-slate-600 px-3 py-1.5 rounded-xl text-xs font-mono tracking-tight shadow-sm border border-white/60 group-hover:border-primary/20 transition-colors">{ac.code}</code>
                            <Button variant="ghost" size="icon" onClick={() => copyToClipboard(ac.code)} className="opacity-0 group-hover:opacity-100 h-8 w-8 rounded-xl transition-all hover:bg-white shadow-sm">
                              <Copy className="h-3 w-3 text-slate-400" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          {ac.status === 'disabled' ? (
                            <Badge variant="outline" className="bg-rose-50/50 text-rose-500 border-rose-100 px-3 py-1 rounded-full text-[9px] uppercase font-black tracking-widest">Disabled</Badge>
                          ) : isExpired ? (
                            <Badge variant="outline" className="bg-amber-50/50 text-amber-500 border-amber-100 px-3 py-1 rounded-full text-[9px] uppercase font-black tracking-widest">Expired</Badge>
                          ) : ac.machineId ? (
                            <Badge variant="outline" className="bg-emerald-50/50 text-emerald-500 border-emerald-100 px-3 py-1 rounded-full text-[9px] uppercase font-black tracking-widest">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-slate-50/50 text-slate-400 border-slate-100 px-3 py-1 rounded-full text-[9px] uppercase font-black tracking-widest">Unused</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {ac.machineId ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-slate-500 font-mono bg-white/40 px-2 py-1 rounded-lg border border-white/60" title={ac.machineId}>{ac.machineId.slice(0, 8)}...{ac.machineId.slice(-4)}</span>
                              <Button variant="ghost" size="icon" onClick={() => copyToClipboard(ac.machineId!)} className="h-7 w-7 rounded-lg hover:bg-white opacity-0 group-hover:opacity-100 transition-all">
                                <Copy className="h-3 w-3 text-slate-300" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-300 uppercase tracking-widest italic font-bold">Pending</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 font-bold">
                            <Clock className="w-3 h-3 text-slate-200" />
                            {ac.durationDays}D
                          </div>
                        </TableCell>
                        <TableCell>
                          {ac.expiresAt ? (
                            <div className={`flex items-center gap-2 text-[11px] ${isExpired ? 'text-rose-400 font-black' : 'text-slate-500 font-medium'}`}>
                              <Calendar className={`w-3 h-3 ${isExpired ? 'text-rose-300' : 'text-slate-200'}`} />
                              {new Date(ac.expiresAt).toLocaleDateString()}
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-200">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-[11px] text-slate-400 font-medium max-w-[120px] truncate">
                          {ac.note || <span className="opacity-20">—</span>}
                        </TableCell>
                        <TableCell className="text-right pr-10">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => updateStatusMutation.mutate({ id: ac.id, status: ac.status === 'active' ? 'disabled' : 'active' })}
                              className={`h-9 w-9 rounded-2xl transition-all ${ac.status === 'active' ? 'text-slate-300 hover:text-amber-500 hover:bg-amber-50' : 'text-emerald-500 hover:bg-emerald-50'}`}
                            >
                              {ac.status === 'active' ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => { if(confirm("Permanently delete this license?")) deleteMutation.mutate({ id: ac.id }) }}
                              className="h-9 w-9 rounded-2xl text-slate-200 hover:text-rose-500 hover:bg-rose-50 transition-all"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        
        <footer className="flex flex-col items-center gap-4 pt-12 pb-10 opacity-30">
          <div className="flex items-center gap-6">
            <div className="h-[1px] w-20 bg-slate-300"></div>
            <span className="font-serif italic text-slate-400 tracking-widest text-sm">Finis</span>
            <div className="h-[1px] w-20 bg-slate-300"></div>
          </div>
          <p className="text-[8px] uppercase tracking-[0.4em] font-black text-slate-400">Secure Ethereal Authorization System</p>
        </footer>
      </div>
    </div>
  );
}

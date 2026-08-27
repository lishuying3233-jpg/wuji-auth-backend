import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Copy, Trash2, ShieldCheck, ShieldAlert, Loader2, RefreshCw, Calendar, Hash, Users, AlertTriangle, LogOut, UserPlus, Shield, Clock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

export default function AdminPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("licenses");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState("365");
  const [batchCount, setCount] = useState("1");
  const [filter, setFilter] = useState("all");
  
  const [newAdminUser, setNewAdminUser] = useState("");
  const [newAdminPass, setNewAdminPass] = useState("");
  const [newAdminRole, setNewAdminRole] = useState<"super" | "sub">("sub");
  const [newAdminPerms, setNewAdminPerms] = useState<string[]>(["generate", "renew"]);

  const utils = trpc.useUtils();
  const { data: codes, isLoading, refetch } = trpc.activation.list.useQuery({ query });
  const { data: admins } = trpc.admin.list.useQuery(undefined, { enabled: (user as any)?.role === 'super' });
  
  const generateMutation = trpc.activation.generate.useMutation({
    onSuccess: (data) => {
      toast.success(`成功生成 ${data.codes.length} 个激活码`);
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

  const renewMutation = trpc.activation.renew.useMutation({
    onSuccess: () => {
      toast.success("续期成功");
      utils.activation.list.invalidate();
    }
  });

  const createAdminMutation = trpc.admin.create.useMutation({
    onSuccess: () => {
      toast.success("子管理员创建成功");
      setNewAdminUser("");
      setNewAdminPass("");
      utils.admin.list.invalidate();
    }
  });

  const deleteAdminMutation = trpc.admin.delete.useMutation({
    onSuccess: () => {
      toast.success("管理员已删除");
      utils.admin.list.invalidate();
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
    let result = codes;
    if (filter === 'active') result = codes.filter(c => c.machineId && (!c.expiresAt || new Date(c.expiresAt).getTime() > now));
    else if (filter === 'expired') result = codes.filter(c => c.expiresAt && new Date(c.expiresAt).getTime() <= now);
    else if (filter === 'unused') result = codes.filter(c => !c.machineId);
    return result;
  }, [codes, filter]);

  if (authLoading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-primary" /></div>;
  
  const currentUser = user as any;
  const isSuper = currentUser?.role === 'super' || user?.role === 'admin';
  const displayName = (user as any)?.username || (user as any)?.name || 'Admin';

  return (
    <div className="min-h-screen bg-transparent">
      <div className="container py-12 space-y-10 max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/40 rounded-2xl border border-white/60 shadow-sm">
              <Shield className="w-6 h-6 text-slate-700" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-tighter">Admin Dashboard</h2>
              <p className="text-[10px] text-slate-400 font-medium">Logged in as {displayName}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => logout()} className="rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>

        <header className="flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-1">
            <h1 className="text-6xl font-serif text-slate-800 tracking-tighter italic leading-tight">Wuji Auth</h1>
            <div className="flex items-center gap-3">
              <div className="h-[1px] w-8 bg-slate-300"></div>
              <p className="text-slate-400 font-sans tracking-[0.3em] uppercase text-[10px] font-bold">Cloud Authorization Control</p>
            </div>
          </div>
          
          <div className="glass-card p-2 rounded-3xl flex items-center gap-2 shadow-2xl shadow-purple-100/50 border border-white/40 bg-white/40 backdrop-blur-xl">
            <div className="flex items-center gap-2 px-4">
              <Input 
                placeholder="Note..." 
                value={note} 
                onChange={(e) => setNote(e.target.value)}
                className="border-none bg-transparent focus-visible:ring-0 h-10 w-32 text-sm placeholder:text-slate-300"
              />
              <div className="h-6 w-[1px] bg-slate-100"></div>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="w-24 border-none bg-transparent h-10 text-xs font-bold text-slate-500 focus:ring-0">
                  <SelectValue placeholder="Duration" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 天</SelectItem>
                  <SelectItem value="3">3 天</SelectItem>
                  <SelectItem value="7">7 天</SelectItem>
                  <SelectItem value="30">1 个月</SelectItem>
                  <SelectItem value="90">3 个月</SelectItem>
                  <SelectItem value="365">1 年</SelectItem>
                </SelectContent>
              </Select>
              <div className="h-6 w-[1px] bg-slate-100"></div>
              <Input 
                type="number"
                min="1"
                max="50"
                value={batchCount}
                onChange={(e) => setCount(e.target.value)}
                className="border-none bg-transparent focus-visible:ring-0 h-10 w-16 text-xs font-bold text-slate-500 text-center"
              />
            </div>
            <Button 
              onClick={() => generateMutation.mutate({ note, durationDays: parseInt(duration), count: parseInt(batchCount) })}
              disabled={generateMutation.isPending}
              className="rounded-2xl h-11 px-8 bg-slate-800 hover:bg-slate-900 text-white shadow-xl transition-all active:scale-95"
            >
              {generateMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: "Total Licenses", value: stats.total, icon: Hash, color: "text-slate-400" },
            { label: "Active Devices", value: stats.active, icon: Users, color: "text-emerald-400" },
            { label: "Expired", value: stats.expired, icon: AlertTriangle, color: "text-rose-400" },
            { label: "Available", value: stats.available, icon: ShieldCheck, color: "text-blue-400" },
          ].map((item, i) => (
            <div key={i} className="glass-card p-6 rounded-3xl border border-white/60 shadow-sm space-y-2 group hover:translate-y-[-2px] transition-all bg-white/40">
              <div className="flex items-center justify-between">
                <item.icon className={`w-5 h-5 ${item.color} opacity-60`} />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{item.label}</span>
              </div>
              <p className="text-3xl font-serif text-slate-700">{item.value}</p>
            </div>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <div className="flex items-center justify-between">
            <TabsList className="bg-white/40 p-1 rounded-2xl border border-white/60 backdrop-blur-xl shadow-sm">
              <TabsTrigger value="licenses" className="rounded-xl px-8 text-xs uppercase tracking-widest font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">Licenses</TabsTrigger>
              {isSuper && <TabsTrigger value="admins" className="rounded-xl px-8 text-xs uppercase tracking-widest font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">Administrators</TabsTrigger>}
            </TabsList>
            
            {activeTab === "licenses" && (
              <div className="flex items-center gap-4">
                <Tabs value={filter} onValueChange={setFilter}>
                  <TabsList className="bg-slate-100/50 p-1 rounded-xl border border-white/20">
                    <TabsTrigger value="all" className="rounded-lg px-4 text-[10px] uppercase tracking-widest font-bold">All</TabsTrigger>
                    <TabsTrigger value="active" className="rounded-lg px-4 text-[10px] uppercase tracking-widest font-bold">Active</TabsTrigger>
                    <TabsTrigger value="expired" className="rounded-lg px-4 text-[10px] uppercase tracking-widest font-bold text-rose-400">Expired</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-300" />
                  <Input 
                    placeholder="Search..." 
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-11 h-10 bg-white/60 border-none rounded-xl focus-visible:ring-primary/10 shadow-inner text-xs w-48"
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => refetch()} className="rounded-xl h-10 w-10 hover:bg-white/60">
                  <RefreshCw className={`h-4 w-4 text-slate-400 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            )}
          </div>

          <TabsContent value="licenses" className="mt-0">
            <div className="glass-card rounded-[2.5rem] overflow-hidden border border-white/60 shadow-2xl shadow-slate-200/40 bg-white/40 backdrop-blur-2xl">
              <Table>
                <TableHeader className="bg-slate-50/20">
                  <TableRow className="hover:bg-transparent border-none">
                    <TableHead className="py-6 pl-10 font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">License Key</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Status</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">HWID</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Duration</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Expiry</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Note</TableHead>
                    <TableHead className="text-right pr-10 font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="h-80 text-center"><Loader2 className="animate-spin mx-auto opacity-10" size={64} /></TableCell></TableRow>
                  ) : filteredCodes.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="h-80 text-center text-slate-300 font-serif italic text-lg">No records found.</TableCell></TableRow>
                  ) : (
                    filteredCodes.map((ac) => {
                      const isExpired = ac.expiresAt && new Date(ac.expiresAt).getTime() <= Date.now();
                      return (
                        <TableRow key={ac.id} className="group hover:bg-white/60 transition-colors border-white/20">
                          <TableCell className="pl-10 py-6">
                            <div className="flex items-center gap-3">
                              <code className="bg-white/80 text-slate-600 px-3 py-1.5 rounded-xl text-xs font-mono tracking-tight shadow-sm border border-white/60">{ac.code}</code>
                              <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(ac.code); toast.success("Copied"); }} className="opacity-0 group-hover:opacity-100 h-8 w-8 rounded-xl transition-all hover:bg-white shadow-sm">
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
                              <span className="text-[11px] text-slate-500 font-mono bg-white/40 px-2 py-1 rounded-lg border border-white/60">{ac.machineId.slice(0, 8)}...</span>
                            ) : (
                              <span className="text-[10px] text-slate-300 uppercase tracking-widest italic font-bold">Pending</span>
                            )}
                          </TableCell>
                          <TableCell className="text-[11px] text-slate-500 font-bold">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 opacity-30" />
                              {ac.durationDays}D
                            </div>
                          </TableCell>
                          <TableCell>
                            {ac.expiresAt ? (
                              <div className={`flex items-center gap-2 text-[11px] ${isExpired ? 'text-rose-400 font-black' : 'text-slate-500 font-medium'}`}>
                                <Calendar className="w-3 h-3 opacity-30" />
                                {new Date(ac.expiresAt).toLocaleDateString()}
                              </div>
                            ) : <span className="text-[10px] text-slate-200">—</span>}
                          </TableCell>
                          <TableCell className="text-[11px] text-slate-400 font-medium max-w-[120px] truncate">{ac.note || "—"}</TableCell>
                          <TableCell className="text-right pr-10">
                            <div className="flex items-center justify-end gap-1">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-2xl text-slate-300 hover:text-primary hover:bg-primary/5">
                                    <RefreshCw className="h-4 w-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="rounded-3xl border-none glass-card shadow-2xl bg-white/90 backdrop-blur-xl">
                                  <DialogHeader><DialogTitle className="font-serif italic text-2xl">Renew License</DialogTitle></DialogHeader>
                                  <div className="py-6 space-y-4 text-center">
                                    <p className="text-sm text-slate-500">Extend authorization for <strong>{ac.code}</strong></p>
                                    <div className="grid grid-cols-3 gap-3">
                                      {[7, 30, 365].map(days => (
                                        <Button key={days} variant="outline" onClick={() => renewMutation.mutate({ id: ac.id, days })} className="rounded-2xl border-slate-100 hover:bg-slate-50">+{days} Days</Button>
                                      ))}
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => updateStatusMutation.mutate({ id: ac.id, status: ac.status === 'active' ? 'disabled' : 'active' })}
                                className={`h-9 w-9 rounded-2xl ${ac.status === 'active' ? 'text-slate-300 hover:text-amber-500' : 'text-emerald-500'}`}
                              >
                                {ac.status === 'active' ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => { if(confirm("Delete?")) deleteMutation.mutate({ id: ac.id }) }}
                                className="h-9 w-9 rounded-2xl text-slate-200 hover:text-rose-500"
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
          </TabsContent>

          {isSuper && (
            <TabsContent value="admins" className="mt-0">
              <div className="grid md:grid-cols-3 gap-8">
                <div className="glass-card p-8 rounded-[2.5rem] border border-white/60 shadow-xl space-y-6 bg-white/40 h-fit">
                  <h3 className="font-serif italic text-2xl text-slate-800">New Admin</h3>
                  <div className="space-y-4">
                    <Input placeholder="Username" value={newAdminUser} onChange={(e) => setNewAdminUser(e.target.value)} className="rounded-2xl bg-white/60 border-none h-12 text-sm" />
                    <Input type="password" placeholder="Password" value={newAdminPass} onChange={(e) => setNewAdminPass(e.target.value)} className="rounded-2xl bg-white/60 border-none h-12 text-sm" />
                    <Select value={newAdminRole} onValueChange={(v: any) => setNewAdminRole(v)}>
                      <SelectTrigger className="rounded-2xl bg-white/60 border-none h-12 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="super">Super Admin</SelectItem><SelectItem value="sub">Sub Admin</SelectItem></SelectContent>
                    </Select>
                    <div className="space-y-2">
                      <p className="text-[9px] uppercase tracking-widest font-bold text-slate-400 ml-1">Permissions</p>
                      <div className="space-y-1">
                        {[
                          { id: "generate", label: "生成激活码" },
                          { id: "delete", label: "删除激活码" },
                          { id: "renew", label: "续期激活码" },
                          { id: "manage_admins", label: "管理子管理员" },
                        ].map(opt => (
                          <label key={opt.id} className="flex items-center gap-3 bg-white/30 p-3 rounded-xl cursor-pointer border border-white/40">
                            <Checkbox 
                              checked={newAdminPerms.includes(opt.id)}
                              onCheckedChange={(checked) => {
                                if (checked) setNewAdminPerms([...newAdminPerms, opt.id]);
                                else setNewAdminPerms(newAdminPerms.filter(p => p !== opt.id));
                              }}
                            />
                            <span className="text-xs text-slate-600 font-medium">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <Button onClick={() => createAdminMutation.mutate({ username: newAdminUser, password: newAdminPass, role: newAdminRole, permissions: JSON.stringify(newAdminPerms) })} className="w-full rounded-2xl h-12 bg-slate-800 hover:bg-slate-900 shadow-lg mt-4"><UserPlus className="w-4 h-4 mr-2" />Create</Button>
                  </div>
                </div>

                <div className="md:col-span-2 glass-card rounded-[2.5rem] overflow-hidden border border-white/60 shadow-xl bg-white/40">
                  <Table>
                    <TableHeader className="bg-slate-50/20">
                      <TableRow className="border-none"><TableHead className="py-6 pl-8 font-bold text-slate-400 uppercase tracking-widest text-[9px]">Admin User</TableHead><TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">Role</TableHead><TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">Permissions</TableHead><TableHead className="text-right pr-8 font-bold text-slate-400 uppercase tracking-widest text-[9px]">Action</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {admins?.map(adm => (
                        <TableRow key={adm.id} className="group hover:bg-white/60 transition-colors border-white/20">
                          <TableCell className="pl-8 py-5 font-bold text-slate-700">{adm.username}</TableCell>
                          <TableCell><Badge variant={adm.role === 'super' ? 'default' : 'secondary'} className="rounded-full text-[8px] uppercase px-3">{adm.role}</Badge></TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {JSON.parse(adm.permissions || "[]").map((p: string) => (
                                <span key={p} className="text-[8px] bg-white/60 px-1.5 py-0.5 rounded border border-white/60 text-slate-400">{p}</span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-8">
                            {adm.username !== displayName && <Button variant="ghost" size="icon" onClick={() => deleteAdminMutation.mutate({ id: adm.id })} className="h-8 w-8 rounded-xl text-slate-200 hover:text-rose-500"><Trash2 className="h-4 w-4" /></Button>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
        
        <footer className="flex flex-col items-center gap-4 pt-12 pb-10 opacity-30">
          <div className="flex items-center gap-6"><div className="h-[1px] w-20 bg-slate-300"></div><span className="font-serif italic text-slate-400 tracking-widest text-sm">Finis</span><div className="h-[1px] w-20 bg-slate-300"></div></div>
          <p className="text-[8px] uppercase tracking-[0.4em] font-black text-slate-400">Secure Ethereal Authorization System</p>
        </footer>
      </div>
    </div>
  );
}

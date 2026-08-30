import React, { useState, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Copy, Trash2, ShieldCheck, ShieldAlert, Loader2, RefreshCw, Calendar, Hash, Users, AlertTriangle, LogOut, UserPlus, Shield, Clock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { canSelectVisibleLicenses, clearLicenseSelection, selectedVisibleLicenseCount, toggleLicenseSelection, toggleVisibleLicenseSelection } from "@/lib/licenseSelection";

export default function AdminPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState("licenses");
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [prefix, setPrefix] = useState("");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState("365");
  const [batchCount, setCount] = useState("1");
  const [filter, setFilter] = useState("all");
  const [generationError, setGenerationError] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectionError, setSelectionError] = useState("");
  const generationInFlight = useRef(false);
  const batchDeleteInFlight = useRef(false);
  
  const [newAdminUser, setNewAdminUser] = useState("");
  const [newAdminPass, setNewAdminPass] = useState("");
  const [newAdminRole, setNewAdminRole] = useState<"super" | "sub">("sub");
  const [newAdminPerms, setNewAdminPerms] = useState<string[]>(["generate", "renew"]);
  const supportedDurations = new Set(["1", "3", "7", "30", "90", "365"]);

  const utils = trpc.useUtils();
  const { data: codes, isLoading, refetch } = trpc.activation.list.useQuery({ query });
  const { data: admins } = trpc.admin.list.useQuery(undefined, { enabled: (user as any)?.role === 'super' });
  const { data: addresses } = trpc.order.listSettings.useQuery(undefined, { enabled: (user as any)?.role === 'super' });
  const { data: orders } = trpc.order.list.useQuery(undefined, { enabled: (user as any)?.role === 'super' });
  const { data: tgSettings } = trpc.order.getTelegramSettings.useQuery(undefined, { enabled: (user as any)?.role === 'super' });

  const [newAddress, setNewAddress] = useState("");
  const [newNetwork, setNewNetwork] = useState<"ERC20" | "TRC20">("TRC20");
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgEnabled, setTgEnabled] = useState(0);

  useEffect(() => {
    if (tgSettings) {
      setTgBotToken(tgSettings.botToken || "");
      setTgChatId(tgSettings.chatId || "");
      setTgEnabled(tgSettings.isEnabled);
    }
  }, [tgSettings]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  
  const generateMutation = trpc.activation.generate.useMutation({
    onSuccess: () => {
      generationInFlight.current = false;
      // 不创建 toast Portal，也不让 React 立即重排授权码表；生成成功后直接重新加载完整页面。
      window.location.reload();
    },
    onError: (error) => {
      generationInFlight.current = false;
      setGenerationError(error.message || t("generationFailed"));
    },
  });

  const handleGenerate = () => {
    if (generationInFlight.current) return;
    generationInFlight.current = true;

    const normalizedPrefix = prefix.trim().toUpperCase();
    const normalizedCount = Number(batchCount);

    if (normalizedPrefix && (normalizedPrefix.length > 24 || !/^[A-Z0-9-]+$/.test(normalizedPrefix))) {
      generationInFlight.current = false;
      setGenerationError(t("invalidPrefix"));
      return;
    }
    if (!supportedDurations.has(duration)) {
      generationInFlight.current = false;
      setGenerationError(t("invalidDuration"));
      return;
    }
    if (!Number.isInteger(normalizedCount) || normalizedCount < 1 || normalizedCount > 50) {
      generationInFlight.current = false;
      setGenerationError(t("invalidCount"));
      return;
    }

    setGenerationError("");
    generateMutation.mutate({
      prefix: normalizedPrefix,
      note: note.trim() || undefined,
      durationDays: Number(duration),
      count: normalizedCount,
    });
  };
  
  const updateStatusMutation = trpc.activation.updateStatus.useMutation({
    onSuccess: () => {
      toast.success(t("statusUpdated"));
      utils.activation.list.invalidate();
    }
  });
  
  const deleteMutation = trpc.activation.delete.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
    onError: (error) => {
      setSelectionError(error.message || t("batchDeleteFailed"));
    },
  });

  const batchDeleteMutation = trpc.activation.deleteMany.useMutation({
    onSuccess: () => {
      batchDeleteInFlight.current = false;
      setSelectedIds(clearLicenseSelection());
      setSelectionError("");
      window.location.reload();
    },
    onError: (error) => {
      batchDeleteInFlight.current = false;
      setSelectionError(error.message || t("batchDeleteFailed"));
    },
  });

  const renewMutation = trpc.activation.renew.useMutation({
    onSuccess: () => {
      toast.success(t("renewSuccess"));
      utils.activation.list.invalidate();
    }
  });

  const createAdminMutation = trpc.admin.create.useMutation({
    onSuccess: () => {
      toast.success(t("adminCreated"));
      setNewAdminUser("");
      setNewAdminPass("");
      utils.admin.list.invalidate();
    }
  });

  const deleteAdminMutation = trpc.admin.delete.useMutation({
    onSuccess: () => {
      toast.success(t("adminDeleted"));
      utils.admin.list.invalidate();
    }
  });

  const manageSettingMutation = trpc.order.manageSettings.useMutation({
    onSuccess: () => {
      toast.success(t("statusUpdated"));
      utils.order.listSettings.invalidate();
      setNewAddress("");
    }
  });

  const deleteSettingMutation = trpc.order.deleteSetting.useMutation({
    onSuccess: () => {
      toast.success(t("deleted"));
      utils.order.listSettings.invalidate();
    }
  });

  const updateOrderStatusMutation = trpc.order.updateStatus.useMutation({
    onSuccess: (data) => {
      toast.success(data.activationCode ? t("paymentConfirmed") : t("statusUpdated"));
      utils.order.list.invalidate();
      utils.activation.list.invalidate();
    }
  });

  const updateTgSettingsMutation = trpc.order.updateTelegramSettings.useMutation({
    onSuccess: () => {
      toast.success(t("tgSaveSuccess"));
      utils.order.getTelegramSettings.invalidate();
    },
    onError: () => toast.error(t("tgSaveFailed"))
  });

  const testTgMutation = trpc.order.testTelegram.useMutation({
    onSuccess: () => toast.success(t("tgTestSuccess")),
    onError: () => toast.error(t("tgTestFailed"))
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

  const visibleIds = useMemo(() => filteredCodes.map((code) => code.id), [filteredCodes]);
  const selectedVisibleCount = selectedVisibleLicenseCount(selectedIds, visibleIds);
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

  const toggleSelected = (id: number, checked: boolean) => {
    setSelectionError("");
    setSelectedIds((current) => toggleLicenseSelection(current, id, checked));
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectionError("");
    if (checked && !canSelectVisibleLicenses(selectedIds, visibleIds)) {
      setSelectionError(t("batchDeleteLimit"));
      return;
    }
    setSelectedIds((current) => toggleVisibleLicenseSelection(current, visibleIds, checked));
  };

  const confirmBatchDelete = () => {
    if (selectedIds.length === 0 || batchDeleteInFlight.current) return;
    if (window.confirm(t("batchDeleteConfirm", { count: selectedIds.length }))) {
      batchDeleteInFlight.current = true;
      batchDeleteMutation.mutate({ ids: selectedIds });
    }
  };

  if (authLoading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin text-primary" /></div>;
  
  const currentUser = user as any;
  const isSuper = currentUser?.role === 'super' || user?.role === 'admin';
  const displayName = (user as any)?.username || (user as any)?.name || 'Admin';

  return (
    <div className="min-h-screen bg-transparent" data-grammarly="false">
      <div className="container py-12 space-y-10 max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/40 rounded-2xl border border-white/60 shadow-sm">
              <Shield className="w-6 h-6 text-slate-700" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-tighter">{t("adminDashboard")}</h2>
              <p className="text-[10px] text-slate-400 font-medium">{t("loggedInAs", { name: displayName })}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher compact />
            <Button variant="ghost" size="sm" onClick={() => logout()} className="rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50">
              <LogOut className="w-4 h-4 mr-2" />
              {t("logout")}
            </Button>
          </div>
        </div>

        <header className="flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-1">
            <h1 className="text-6xl font-serif text-slate-800 tracking-tighter italic leading-tight">{t("brand")}</h1>
            <div className="flex items-center gap-3">
              <div className="h-[1px] w-8 bg-slate-300"></div>
              <p className="text-slate-400 font-sans tracking-[0.3em] uppercase text-[10px] font-bold">{t("cloudAuthorizationControl")}</p>
            </div>
          </div>
          
          <div className="relative glass-card p-2 rounded-3xl flex items-center gap-2 shadow-2xl shadow-purple-100/50 border border-white/40 bg-white/40 backdrop-blur-xl">
            <div className="flex items-center gap-2 px-4">
              <Input 
                placeholder={t("prefix")} 
                value={prefix} 
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                className="border-none bg-transparent focus-visible:ring-0 h-10 w-24 text-sm font-bold placeholder:text-slate-300 placeholder:font-normal"
              />
              <div className="h-6 w-[1px] bg-slate-100"></div>
              <Input 
                placeholder={t("note")} 
                value={note} 
                onChange={(e) => setNote(e.target.value)}
                className="border-none bg-transparent focus-visible:ring-0 h-10 w-32 text-sm placeholder:text-slate-300"
              />
              <div className="h-6 w-[1px] bg-slate-100"></div>
              <select
                aria-label={t("duration")}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-24 h-10 cursor-pointer border-none bg-transparent px-0 text-xs font-bold text-slate-500 outline-none focus:ring-0"
              >
                <option value="1">{t("oneDay")}</option>
                <option value="3">{t("threeDays")}</option>
                <option value="7">{t("sevenDays")}</option>
                <option value="30">{t("oneMonth")}</option>
                <option value="90">{t("threeMonths")}</option>
                <option value="365">{t("oneYear")}</option>
              </select>
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
              onClick={handleGenerate}
              className="rounded-2xl h-11 px-8 bg-slate-800 hover:bg-slate-900 text-white shadow-xl transition-all active:scale-95"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("generate")}
            </Button>
            <p
              role="alert"
              aria-live="polite"
              className={generationError ? "absolute right-2 top-full z-10 mt-2 max-w-xs rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-600 shadow-lg" : "absolute right-2 top-full z-10 mt-2 max-w-xs invisible px-3 py-2 text-[11px]"}
            >
              {generationError || "\u00a0"}
            </p>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: t("totalLicenses"), value: stats.total, icon: Hash, color: "text-slate-400" },
            { label: t("activeDevices"), value: stats.active, icon: Users, color: "text-emerald-400" },
            { label: t("expired"), value: stats.expired, icon: AlertTriangle, color: "text-rose-400" },
            { label: t("available"), value: stats.available, icon: ShieldCheck, color: "text-blue-400" },
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
              <TabsTrigger value="licenses" className="rounded-xl px-8 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("licenses")}</TabsTrigger>
              {isSuper && (
                <>
                  <TabsTrigger value="orders" className="rounded-xl px-8 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("orderManagement")}</TabsTrigger>
                  <TabsTrigger value="payments" className="rounded-xl px-8 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("paymentManagement")}</TabsTrigger>
	                  <TabsTrigger value="admins" className="rounded-xl px-8 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("administrators")}</TabsTrigger>
	                  <TabsTrigger value="notifications" className="rounded-xl px-8 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">{t("notificationSettings")}</TabsTrigger>
	                </>
	              )}
	            </TabsList>
            
            {activeTab === "licenses" && (
              <div className="flex items-center gap-4">
                <Tabs value={filter} onValueChange={setFilter}>
                  <TabsList className="bg-slate-100/50 p-1 rounded-xl border border-white/20">
                    <TabsTrigger value="all" onClick={() => setSelectedIds(clearLicenseSelection())} className="rounded-lg px-4 text-[10px] font-bold">{t("all")}</TabsTrigger>
                    <TabsTrigger value="active" onClick={() => setSelectedIds(clearLicenseSelection())} className="rounded-lg px-4 text-[10px] font-bold">{t("active")}</TabsTrigger>
                    <TabsTrigger value="expired" onClick={() => setSelectedIds(clearLicenseSelection())} className="rounded-lg px-4 text-[10px] font-bold text-rose-400">{t("expired")}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-300" />
                  <Input 
                    placeholder={t("search")} 
                    value={searchInput}
                    onChange={(e) => { setSearchInput(e.target.value); setSelectedIds(clearLicenseSelection()); }}
                    className="pl-11 h-10 bg-white/60 border-none rounded-xl focus-visible:ring-primary/10 shadow-inner text-xs w-48"
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => { setSelectedIds(clearLicenseSelection()); refetch(); }} className="rounded-xl h-10 w-10 hover:bg-white/60">
                  <RefreshCw className={`h-4 w-4 text-slate-400 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            )}
          </div>

          <TabsContent value="licenses" className="mt-0">
            <div className="glass-card rounded-[2.5rem] overflow-hidden border border-white/60 shadow-2xl shadow-slate-200/40 bg-white/40 backdrop-blur-2xl">
              <div className="flex min-h-14 items-center justify-between gap-4 border-b border-white/30 px-8 py-3">
                <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
                  <span className={selectedIds.length > 0 ? "" : "invisible"}>{t("selectedCount", { count: selectedIds.length })}</span>
                  <button type="button" onClick={() => setSelectedIds(clearLicenseSelection())} className={selectedIds.length > 0 ? "text-slate-400 underline-offset-4 hover:underline" : "invisible"}>{t("clearSelection")}</button>
                </div>
                <Button type="button" onClick={confirmBatchDelete} disabled={selectedIds.length === 0} className="h-9 rounded-xl bg-rose-500 px-4 text-xs text-white shadow-sm hover:bg-rose-600 disabled:pointer-events-none disabled:opacity-40">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {t("batchDelete")}
                </Button>
              </div>
              <p role="alert" aria-live="polite" className={selectionError ? "mx-8 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-600" : "mx-8 mt-3 h-0 overflow-hidden text-[11px]"}>
                {selectionError || "\u00a0"}
              </p>
              <div className="max-h-[640px] overflow-auto">
                <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur">
                  <TableRow className="hover:bg-transparent border-none">
                    <TableHead className="w-14 pl-8 py-6">
                      <Checkbox
                        checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? "indeterminate" : false}
                        onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                        aria-label={t("selectAll")}
                      />
                    </TableHead>
                    <TableHead className="py-6 pl-4 font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">{t("licenseKey")}</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">{t("status")}</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">{t("hwid")}</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">{t("duration")}</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">{t("expiry")}</TableHead>
                    <TableHead className="font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">{t("note")}</TableHead>
                    <TableHead className="text-right pr-10 font-bold text-slate-400 uppercase tracking-[0.2em] text-[9px]">{t("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="h-80 text-center"><Loader2 className="animate-spin mx-auto opacity-10" size={64} /></TableCell></TableRow>
                  ) : filteredCodes.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="h-80 text-center text-slate-300 font-serif italic text-lg">{t("noRecords")}</TableCell></TableRow>
                  ) : (
                    filteredCodes.map((ac) => {
                      const isExpired = ac.expiresAt && new Date(ac.expiresAt).getTime() <= Date.now();
                      return (
                        <TableRow key={ac.id} className="group hover:bg-white/60 transition-colors border-white/20">
                          <TableCell className="w-14 pl-8 py-6">
                            <Checkbox
                              checked={selectedIds.includes(ac.id)}
                              onCheckedChange={(checked) => toggleSelected(ac.id, checked === true)}
                              aria-label={t("selectLicense", { code: ac.code })}
                            />
                          </TableCell>
                          <TableCell className="pl-4 py-6">
                            <div className="flex items-center gap-3">
                              <code className="bg-white/80 text-slate-600 px-3 py-1.5 rounded-xl text-xs font-mono tracking-tight shadow-sm border border-white/60">{ac.code}</code>
                              <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(ac.code); toast.success(t("copied")); }} className="opacity-0 group-hover:opacity-100 h-8 w-8 rounded-xl transition-all hover:bg-white shadow-sm">
                                <Copy className="h-3 w-3 text-slate-400" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            {ac.status === 'disabled' ? (
                              <Badge variant="outline" className="bg-rose-50/50 text-rose-500 border-rose-100 px-3 py-1 rounded-full text-[9px] uppercase font-black tracking-widest">{t("disabled")}</Badge>
                            ) : isExpired ? (
                              <Badge variant="outline" className="bg-amber-50/50 text-amber-500 border-amber-100 px-3 py-1 rounded-full text-[9px] uppercase font-black tracking-widest">{t("expired")}</Badge>
                            ) : ac.machineId ? (
                              <Badge variant="outline" className="bg-emerald-50/50 text-emerald-500 border-emerald-100 px-3 py-1 rounded-full text-[9px] uppercase font-black tracking-widest">{t("activeStatus")}</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-slate-50/50 text-slate-400 border-slate-100 px-3 py-1 rounded-full text-[9px] uppercase font-black tracking-widest">{t("unusedStatus")}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {ac.machineId ? (
                              <span className="text-[11px] text-slate-500 font-mono bg-white/40 px-2 py-1 rounded-lg border border-white/60">{ac.machineId.slice(0, 8)}...</span>
                            ) : (
                              <span className="text-[10px] text-slate-300 uppercase tracking-widest italic font-bold">{t("pending")}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-[11px] text-slate-500 font-bold">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 opacity-30" />
                              {ac.durationDays} {t("days")}
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
                                  <DialogHeader><DialogTitle className="font-serif italic text-2xl">{t("renewLicense")}</DialogTitle></DialogHeader>
                                  <div className="py-6 space-y-4 text-center">
                                    <p className="text-sm text-slate-500">{t("renewDescription", { code: ac.code })}</p>
                                    <div className="grid grid-cols-3 gap-3">
                                      {[7, 30, 365].map(days => (
                                        <Button key={days} variant="outline" onClick={() => renewMutation.mutate({ id: ac.id, days })} className="rounded-2xl border-slate-100 hover:bg-slate-50">{days === 7 ? t("renewSevenDays") : days === 30 ? t("renewOneMonth") : t("renewOneYear")}</Button>
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
                                onClick={() => { if (confirm(t("deleteConfirm"))) deleteMutation.mutate({ id: ac.id }) }}
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
            </div>
          </TabsContent>

          {isSuper && (
            <TabsContent value="admins" className="mt-0">
              <div className="grid md:grid-cols-3 gap-8">
                <div className="glass-card p-8 rounded-[2.5rem] border border-white/60 shadow-xl space-y-6 bg-white/40 h-fit">
                  <h3 className="font-serif italic text-2xl text-slate-800">{t("newAdmin")}</h3>
                  <div className="space-y-4">
                    <Input placeholder={t("username")} value={newAdminUser} onChange={(e) => setNewAdminUser(e.target.value)} className="rounded-2xl bg-white/60 border-none h-12 text-sm" />
                    <Input type="password" placeholder={t("password")} value={newAdminPass} onChange={(e) => setNewAdminPass(e.target.value)} className="rounded-2xl bg-white/60 border-none h-12 text-sm" />
                    <Select value={newAdminRole} onValueChange={(v: any) => setNewAdminRole(v)}>
                      <SelectTrigger className="rounded-2xl bg-white/60 border-none h-12 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="super">{t("superAdmin")}</SelectItem><SelectItem value="sub">{t("subAdmin")}</SelectItem></SelectContent>
                    </Select>
                    <div className="space-y-2">
                      <p className="text-[9px] uppercase tracking-widest font-bold text-slate-400 ml-1">{t("permissions")}</p>
                      <div className="space-y-1">
                        {[
                          { id: "generate", label: t("permissionGenerate") },
                          { id: "delete", label: t("permissionDelete") },
                          { id: "renew", label: t("permissionRenew") },
                          { id: "manage_admins", label: t("permissionManageAdmins") },
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
                    <Button onClick={() => createAdminMutation.mutate({ username: newAdminUser, password: newAdminPass, role: newAdminRole, permissions: JSON.stringify(newAdminPerms) })} className="w-full rounded-2xl h-12 bg-slate-800 hover:bg-slate-900 shadow-lg mt-4"><UserPlus className="w-4 h-4 mr-2" />{t("createAdmin")}</Button>
                  </div>
                </div>

                <div className="md:col-span-2 glass-card rounded-[2.5rem] overflow-hidden border border-white/60 shadow-xl bg-white/40">
                  <Table>
                    <TableHeader className="bg-slate-50/20">
                      <TableRow className="border-none"><TableHead className="py-6 pl-8 font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("adminUser")}</TableHead><TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("role")}</TableHead><TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("permissions")}</TableHead><TableHead className="text-right pr-8 font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("actions")}</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {admins?.map(adm => (
                        <TableRow key={adm.id} className="group hover:bg-white/60 transition-colors border-white/20">
                          <TableCell className="pl-8 py-5 font-bold text-slate-700">{adm.username}</TableCell>
                          <TableCell><Badge variant={adm.role === 'super' ? 'default' : 'secondary'} className="rounded-full text-[8px] uppercase px-3">{adm.role === "super" ? t("superAdmin") : t("subAdmin")}</Badge></TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {JSON.parse(adm.permissions || "[]").map((p: string) => (
                                <span key={p} className="text-[8px] bg-white/60 px-1.5 py-0.5 rounded border border-white/60 text-slate-400">{p === "generate" ? t("permissionGenerate") : p === "delete" ? t("permissionDelete") : p === "renew" ? t("permissionRenew") : p === "manage_admins" ? t("permissionManageAdmins") : p}</span>
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

          {isSuper && (
            <TabsContent value="orders" className="space-y-6">
              <div className="glass-card rounded-[2.5rem] overflow-hidden border border-white/60 shadow-xl bg-white/40">
                <Table>
                  <TableHeader className="bg-slate-50/20">
                    <TableRow className="border-none">
                      <TableHead className="py-6 pl-8 font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("orderTime")}</TableHead>
                      <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("hwid")}</TableHead>
                      <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("plan")}</TableHead>
                      <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("amount")}</TableHead>
                      <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("network")}</TableHead>
                      <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("txHash")}</TableHead>
                      <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("orderStatus")}</TableHead>
                      <TableHead className="text-right pr-8 font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders?.map(order => (
                      <TableRow key={order.id} className="group hover:bg-white/60 transition-colors border-white/20">
                        <TableCell className="pl-8 py-5 text-[10px] text-slate-500">{new Date(order.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="font-mono text-[10px] text-slate-700">{order.machineId}</TableCell>
                        <TableCell className="text-[10px] font-bold text-slate-700">{order.planName}</TableCell>
                        <TableCell className="text-[10px] font-bold text-emerald-600">{order.amount} USDT</TableCell>
                        <TableCell><Badge variant="outline" className="text-[8px]">{order.network}</Badge></TableCell>
                        <TableCell className="max-w-[120px] truncate font-mono text-[9px] text-slate-400" title={order.txHash || ""}>{order.txHash || "-"}</TableCell>
<TableCell>
  <div className="flex flex-col gap-1">
    <Badge variant={order.status === 'completed' ? 'default' : order.status === 'pending' ? 'secondary' : 'outline'} className="rounded-full text-[8px] uppercase px-3 w-fit">
      {order.status === 'pending' ? t("pendingAudit") : order.status === 'paid' ? t("paidAudit") : order.status === 'completed' ? t("completedAudit") : t("failedAudit")}
    </Badge>
    {order.errorReason && (
      <span className="text-[9px] text-rose-500 leading-tight max-w-[120px] truncate" title={order.errorReason}>
        {order.errorReason}
      </span>
    )}
  </div>
</TableCell>
                        <TableCell className="text-right pr-8 space-x-2">
                          {order.status === 'pending' || order.status === 'paid' ? (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => updateOrderStatusMutation.mutate({ id: order.id, status: 'completed', machineId: order.machineId, durationDays: order.durationDays })} className="h-7 text-[9px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg">{t("approve")}</Button>
                              <Button variant="ghost" size="sm" onClick={() => updateOrderStatusMutation.mutate({ id: order.id, status: 'failed', machineId: order.machineId, durationDays: order.durationDays })} className="h-7 text-[9px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg">{t("reject")}</Button>
                            </>
                          ) : order.activationCode && (
                            <div className="flex items-center justify-end gap-2 text-[9px] text-slate-400">
                              <span className="font-mono">{order.activationCode}</span>
                              <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(order.activationCode!); toast.success(t("copied")); }} className="h-6 w-6 rounded-md"><Copy className="w-3 h-3" /></Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}

          {isSuper && (
            <TabsContent value="payments" className="space-y-6">
              <div className="grid md:grid-cols-3 gap-8">
                <div className="space-y-6">
                  <div className="glass-card p-8 rounded-[2.5rem] border border-white/60 shadow-xl space-y-6 bg-white/40">
                    <div className="space-y-2">
                      <h3 className="text-lg font-serif text-slate-800 italic">{t("addAddress")}</h3>
                      <p className="text-[10px] text-slate-400 leading-relaxed uppercase tracking-widest font-bold">配置 USDT 收款钱包</p>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">{t("network")}</label>
                        <Select value={newNetwork} onValueChange={(v: any) => setNewNetwork(v)}>
                          <SelectTrigger className="rounded-2xl border-white/60 bg-white/60 h-12 focus:ring-slate-200">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-2xl border-white/60">
                            <SelectItem value="TRC20">USDT-TRC20</SelectItem>
                            <SelectItem value="ERC20">USDT-ERC20</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[9px] font-bold text-slate-400 uppercase ml-1">{t("address")}</label>
                        <Input 
                          placeholder="请输入钱包地址" 
                          value={newAddress} 
                          onChange={(e) => setNewAddress(e.target.value)}
                          className="rounded-2xl border-white/60 bg-white/60 h-12 focus-visible:ring-slate-200"
                        />
                      </div>
                      <Button 
                        onClick={() => manageSettingMutation.mutate({ network: newNetwork, address: newAddress, status: 'active' })} 
                        className="w-full rounded-2xl h-12 bg-slate-800 hover:bg-slate-900 shadow-lg mt-4"
                        disabled={!newAddress}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        {t("addAddress")}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 glass-card rounded-[2.5rem] overflow-hidden border border-white/60 shadow-xl bg-white/40">
                  <Table>
                    <TableHeader className="bg-slate-50/20">
                      <TableRow className="border-none">
                        <TableHead className="py-6 pl-8 font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("network")}</TableHead>
                        <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("address")}</TableHead>
                        <TableHead className="font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("status")}</TableHead>
                        <TableHead className="text-right pr-8 font-bold text-slate-400 uppercase tracking-widest text-[9px]">{t("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {addresses?.map(addr => (
                        <TableRow key={addr.id} className="group hover:bg-white/60 transition-colors border-white/20">
                          <TableCell className="pl-8 py-5"><Badge variant="outline" className="rounded-full text-[8px] uppercase px-3">{addr.network}</Badge></TableCell>
                          <TableCell className="font-mono text-xs text-slate-600">{addr.address}</TableCell>
                          <TableCell>
                            <Badge variant={addr.status === 'active' ? 'default' : 'secondary'} className="rounded-full text-[8px] uppercase px-3">
                              {addr.status === 'active' ? t("active") : t("disabled")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right pr-8">
                            <Button variant="ghost" size="icon" onClick={() => deleteSettingMutation.mutate({ id: addr.id })} className="h-8 w-8 rounded-xl text-slate-200 hover:text-rose-500"><Trash2 className="h-4 w-4" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
          )}

          {isSuper && (
            <TabsContent value="notifications" className="space-y-6 focus-visible:ring-0">
              <div className="glass-card p-8 rounded-3xl border border-white/60 bg-white/40 backdrop-blur-xl shadow-sm max-w-2xl">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-slate-800">{t("notificationSettings")}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{t("tgSettingsHint")}</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">{t("tgBotToken")}</label>
                      <Input 
                        type="password"
                        placeholder="8775411481:AAEeEpi..."
                        value={tgBotToken}
                        onChange={(e) => setTgBotToken(e.target.value)}
                        className="rounded-2xl border-white/60 bg-white/50 h-12 focus:ring-slate-200"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">{t("tgChatId")}</label>
                      <Input 
                        placeholder="8201023469"
                        value={tgChatId}
                        onChange={(e) => setTgChatId(e.target.value)}
                        className="rounded-2xl border-white/60 bg-white/50 h-12 focus:ring-slate-200"
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-white/40 rounded-2xl border border-white/60">
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold text-slate-700">{t("tgEnabled")}</p>
                        <p className="text-[10px] text-slate-400">接收实时订单与授权动态通知</p>
                      </div>
                      <Checkbox 
                        checked={tgEnabled === 1}
                        onCheckedChange={(checked) => setTgEnabled(checked ? 1 : 0)}
                        className="rounded-lg w-6 h-6 border-slate-300 data-[state=checked]:bg-slate-800 data-[state=checked]:border-slate-800"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button 
                      onClick={() => updateTgSettingsMutation.mutate({ botToken: tgBotToken, chatId: tgChatId, isEnabled: tgEnabled })}
                      disabled={updateTgSettingsMutation.isPending}
                      className="flex-1 rounded-2xl h-12 bg-slate-800 hover:bg-slate-900 text-white font-bold shadow-lg"
                    >
                      {updateTgSettingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      {t("finis")}
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => testTgMutation.mutate()}
                      disabled={testTgMutation.isPending || !tgBotToken || !tgChatId}
                      className="rounded-2xl h-12 border-white/60 bg-white/50 font-bold hover:bg-white/80"
                    >
                      {testTgMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                      {t("tgTest")}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
        
        <footer className="flex flex-col items-center gap-4 pt-12 pb-10 opacity-30">
          <div className="flex items-center gap-6"><div className="h-[1px] w-20 bg-slate-300"></div><span className="font-serif italic text-slate-400 tracking-widest text-sm">{t("finis")}</span><div className="h-[1px] w-20 bg-slate-300"></div></div>
          <p className="text-[8px] uppercase tracking-[0.4em] font-black text-slate-400">{t("secureFooter")}</p>
        </footer>
      </div>
    </div>
  );
}

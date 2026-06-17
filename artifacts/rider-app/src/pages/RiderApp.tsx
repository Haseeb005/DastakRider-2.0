import React, { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Bike, Navigation, History, User, Check, Clock, MapPin, PhoneCall, ChevronRight, LogOut, Loader2, ArrowRight } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  useGetRiderMe, getGetRiderMeQueryKey,
  useRegisterRider,
  useLoginRider,
  useLogoutRider,
  useUpdateRiderAvailability,
  useGetAvailableOrders, getGetAvailableOrdersQueryKey,
  useGetActiveOrders, getGetActiveOrdersQueryKey,
  useGetOrderHistory, getGetOrderHistoryQueryKey,
  useAcceptOrder,
  useUpdateOrderStatus,
  useGetRiderEarnings, getGetRiderEarningsQueryKey,
  RiderOrder,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

// -- FORMATTERS --
const formatCurrency = (amount: number) => `Rs. ${Math.round(amount)}`;
const formatTime = (dateStr: string) => formatDistanceToNow(new Date(dateStr), { addSuffix: true });

// -- TABS ENUM --
type Tab = "available" | "active" | "earnings" | "profile";

// -- MAIN COMPONENT --
export default function RiderApp() {
  // Query to check login status
  const { data: rider, isLoading: isRiderLoading, isError } = useGetRiderMe({
    query: { retry: false }
  });

  const [activeTab, setActiveTab] = useState<Tab>("available");

  if (isRiderLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show Auth if not logged in
  if (isError || !rider) {
    return <AuthScreen />;
  }

  return (
    <div className="flex flex-col min-h-screen max-w-[430px] mx-auto bg-background text-foreground shadow-2xl relative overflow-hidden pb-16">
      <main className="flex-1 overflow-y-auto w-full h-full relative">
        <AnimatePresence mode="wait">
          {activeTab === "available" && <AvailableTab key="available" riderId={rider.id} isOnline={rider.isOnline} />}
          {activeTab === "active" && <ActiveTab key="active" />}
          {activeTab === "earnings" && <EarningsTab key="earnings" />}
          {activeTab === "profile" && <ProfileTab key="profile" rider={rider} />}
        </AnimatePresence>
      </main>
      
      {/* Bottom Navigation */}
      <div className="fixed bottom-0 w-full max-w-[430px] bg-card border-t border-border flex justify-around items-center h-16 z-50 px-2 pb-safe">
        <NavButton tab="available" current={activeTab} icon={Bike} label="Find" onClick={() => setActiveTab("available")} />
        <NavButton tab="active" current={activeTab} icon={Navigation} label="Active" onClick={() => setActiveTab("active")} />
        <NavButton tab="earnings" current={activeTab} icon={History} label="Earnings" onClick={() => setActiveTab("earnings")} />
        <NavButton tab="profile" current={activeTab} icon={User} label="Profile" onClick={() => setActiveTab("profile")} />
      </div>
    </div>
  );
}

// -- NAV BUTTON --
function NavButton({ tab, current, icon: Icon, label, onClick }: { tab: Tab, current: Tab, icon: any, label: string, onClick: () => void }) {
  const isActive = tab === current;
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className={`w-6 h-6 ${isActive ? "stroke-[2.5px]" : "stroke-[1.5px]"}`} />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

// -- AUTH SCREEN --
const loginSchema = z.object({ phone: z.string().min(10), password: z.string().min(6) });
const registerSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
  password: z.string().min(6),
  confirmPassword: z.string().min(6),
  city: z.string().min(2),
  vehicleType: z.string().min(2),
}).refine(data => data.password === data.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });

function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginMutation = useLoginRider();
  const registerMutation = useRegisterRider();

  const loginForm = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", password: "" },
  });

  const registerForm = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", phone: "", password: "", confirmPassword: "", city: "", vehicleType: "" },
  });

  const onLoginSubmit = (data: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });
        toast({ title: "Welcome back!", description: "Logged in successfully." });
      },
      onError: () => toast({ title: "Error", description: "Invalid credentials.", variant: "destructive" })
    });
  };

  const onRegisterSubmit = (data: z.infer<typeof registerSchema>) => {
    const { confirmPassword, ...registerData } = data;
    registerMutation.mutate({ data: registerData }, {
      onSuccess: () => {
        // Automatically login after register
        loginMutation.mutate({ data: { phone: data.phone, password: data.password } }, {
          onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetRiderMeQueryKey() })
        });
      },
      onError: () => toast({ title: "Registration failed", variant: "destructive" })
    });
  };

  return (
    <div className="flex flex-col min-h-screen max-w-[430px] mx-auto bg-background text-foreground p-6 justify-center">
      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Bike className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Dastak Rider</h1>
        <p className="text-muted-foreground mt-2">The fastest way to earn.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 shadow-xl">
        <div className="flex space-x-4 mb-6 border-b border-border pb-2">
          <button
            className={`flex-1 pb-2 font-medium text-sm transition-colors relative ${isLogin ? "text-primary" : "text-muted-foreground"}`}
            onClick={() => setIsLogin(true)}
          >
            Login
            {isLogin && <motion.div layoutId="auth-tab" className="absolute bottom-[-2px] left-0 right-0 h-[2px] bg-primary" />}
          </button>
          <button
            className={`flex-1 pb-2 font-medium text-sm transition-colors relative ${!isLogin ? "text-primary" : "text-muted-foreground"}`}
            onClick={() => setIsLogin(false)}
          >
            Register
            {!isLogin && <motion.div layoutId="auth-tab" className="absolute bottom-[-2px] left-0 right-0 h-[2px] bg-primary" />}
          </button>
        </div>

        {isLogin ? (
          <Form {...loginForm}>
            <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
              <FormField control={loginForm.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl><Input placeholder="03001234567" {...field} className="bg-background" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={loginForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl><Input type="password" placeholder="••••••••" {...field} className="bg-background" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full h-12 text-md font-bold" disabled={loginMutation.isPending}>
                {loginMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Sign In
              </Button>
            </form>
          </Form>
        ) : (
          <Form {...registerForm}>
            <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-3">
              <FormField control={registerForm.control} name="name" render={({ field }) => (
                <FormItem><FormControl><Input placeholder="Full Name" {...field} className="bg-background" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={registerForm.control} name="phone" render={({ field }) => (
                <FormItem><FormControl><Input placeholder="Phone Number" {...field} className="bg-background" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={registerForm.control} name="password" render={({ field }) => (
                  <FormItem><FormControl><Input type="password" placeholder="Password" {...field} className="bg-background" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={registerForm.control} name="confirmPassword" render={({ field }) => (
                  <FormItem><FormControl><Input type="password" placeholder="Confirm" {...field} className="bg-background" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={registerForm.control} name="city" render={({ field }) => (
                  <FormItem>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger className="bg-background"><SelectValue placeholder="City" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Sargodha"].map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={registerForm.control} name="vehicleType" render={({ field }) => (
                  <FormItem>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger className="bg-background"><SelectValue placeholder="Vehicle" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Bike">Bike</SelectItem>
                        <SelectItem value="Car">Car</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <Button type="submit" className="w-full h-12 text-md font-bold mt-2" disabled={registerMutation.isPending}>
                {registerMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Account
              </Button>
            </form>
          </Form>
        )}
      </div>
    </div>
  );
}

// -- AVAILABLE ORDERS TAB --
function AvailableTab({ riderId, isOnline }: { riderId: string, isOnline: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: orders, isLoading } = useGetAvailableOrders({
    query: { refetchInterval: 10000, enabled: isOnline } // Poll every 10s if online
  });

  const toggleOnline = useUpdateRiderAvailability();
  const acceptOrder = useAcceptOrder();

  const handleToggleOnline = () => {
    toggleOnline.mutate({ data: { isOnline: true } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRiderMeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAvailableOrdersQueryKey() });
      }
    });
  };

  const handleAccept = (orderId: string) => {
    acceptOrder.mutate({ orderId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAvailableOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
        toast({ title: "Order Accepted!", description: "Head to the restaurant immediately." });
      },
      onError: () => toast({ title: "Failed to accept", description: "Order might have been taken by another rider.", variant: "destructive" })
    });
  };

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-4 pt-8 h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Find Orders</h2>
        <Badge variant={isOnline ? "default" : "secondary"} className={isOnline ? "bg-green-500 hover:bg-green-600" : ""}>
          {isOnline ? "Online" : "Offline"}
        </Badge>
      </div>

      {!isOnline ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center -mt-10">
          <div className="w-24 h-24 bg-card rounded-full flex items-center justify-center mb-6 border border-border">
            <Bike className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">You're Offline</h3>
          <p className="text-muted-foreground mb-8 max-w-[250px]">Go online to start receiving delivery requests near you.</p>
          <Button size="lg" className="w-full max-w-[280px] h-14 rounded-full text-lg shadow-[0_0_20px_rgba(255,69,0,0.4)] font-bold active:scale-95 transition-transform" onClick={handleToggleOnline} disabled={toggleOnline.isPending}>
            {toggleOnline.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "GO ONLINE"}
          </Button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-4 space-y-4">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => (
              <Card key={i} className="bg-card border-border"><CardContent className="p-4 space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-10 w-full mt-4" /></CardContent></Card>
            ))
          ) : !orders || orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
              <p className="text-muted-foreground">Looking for orders nearby...</p>
            </div>
          ) : (
            <AnimatePresence>
              {orders.map(order => (
                <motion.div key={order.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
                  <Card className="bg-card border-border border-l-4 border-l-primary overflow-hidden shadow-lg hover-elevate">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="font-bold text-lg text-white truncate pr-4">{formatCurrency(order.total)}</div>
                        <div className="flex items-center text-xs text-muted-foreground whitespace-nowrap bg-muted px-2 py-1 rounded">
                          <Clock className="w-3 h-3 mr-1" /> {formatTime(order.createdAt)}
                        </div>
                      </div>
                      
                      <div className="space-y-2 mb-4">
                        <div className="flex items-start">
                          <div className="w-6 flex justify-center mt-0.5"><MapPin className="w-4 h-4 text-primary" /></div>
                          <div className="flex-1 ml-1 text-sm font-medium text-white">{order.restaurantName || "Restaurant"}</div>
                        </div>
                        <div className="flex items-start">
                          <div className="w-6 flex justify-center mt-0.5"><MapPin className="w-4 h-4 text-muted-foreground" /></div>
                          <div className="flex-1 ml-1 text-sm text-muted-foreground line-clamp-2">{order.address}</div>
                        </div>
                      </div>

                      <Button 
                        onClick={() => handleAccept(order.id)} 
                        className="w-full font-bold active:scale-95 transition-transform" 
                        disabled={acceptOrder.isPending}
                      >
                        Accept Order <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}
    </motion.div>
  );
}

// -- ACTIVE DELIVERIES TAB --
const getNextStatusAndLabel = (currentStatus: string) => {
  if (currentStatus === "Rider Accepted") return { next: "Rider Picked Up", label: "Picked Up — On My Way", icon: Navigation };
  if (currentStatus === "Rider Picked Up") return { next: "Delivered", label: "Mark as Delivered", icon: Check };
  return null;
};

const getStatusDisplay = (status: string) => {
  const map: Record<string, string> = {
    Pending: "Waiting Pickup", "Rider Accepted": "Accepted", "Rider Picked Up": "On the Way", Delivered: "Delivered"
  };
  return map[status] || status;
};

function ActiveTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: orders, isLoading } = useGetActiveOrders({ query: { refetchInterval: 8000 } });
  const updateStatus = useUpdateOrderStatus();

  const handleUpdateStatus = (orderId: string, status: string) => {
    updateStatus.mutate({ orderId, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRiderEarningsQueryKey() });
        if (status === "Delivered") toast({ title: "Delivery Complete!", description: "Great job. Earnings updated." });
      }
    });
  };

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-4 pt-8 h-full flex flex-col">
      <h2 className="text-2xl font-bold text-white mb-6">Active Deliveries</h2>
      
      <div className="flex-1 overflow-y-auto pb-4 space-y-4">
        {isLoading ? (
          <Card className="bg-card border-border"><CardContent className="p-4 space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-20 w-full" /><Skeleton className="h-12 w-full" /></CardContent></Card>
        ) : !orders || orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Navigation className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">No Active Orders</h3>
            <p className="text-muted-foreground text-sm">Accept an order from the Find tab.</p>
          </div>
        ) : (
          <AnimatePresence>
            {orders.map(order => {
              const progression = getNextStatusAndLabel(order.status);
              const ActionIcon = progression?.icon;
              
              return (
                <motion.div key={order.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mb-4">
                  <Card className="bg-card border-primary/50 shadow-[0_0_15px_rgba(255,69,0,0.15)] relative overflow-hidden">
                    {/* Animated top border line */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/20 via-primary to-primary/20 bg-[length:200%_100%] animate-[pulse_2s_ease-in-out_infinite]" />
                    
                    <CardContent className="p-5">
                      <div className="flex justify-between items-center mb-4">
                        <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30 uppercase tracking-wider text-[10px]">
                          {getStatusDisplay(order.status)}
                        </Badge>
                        <span className="font-bold text-white">{formatCurrency(order.total)}</span>
                      </div>
                      
                      <div className="bg-background rounded-lg p-4 mb-5 border border-border space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="bg-muted p-2 rounded-full mt-1"><MapPin className="w-4 h-4 text-white" /></div>
                          <div>
                            <div className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Pickup</div>
                            <div className="font-semibold text-white leading-tight">{order.restaurantName || "Restaurant"}</div>
                          </div>
                        </div>
                        
                        <div className="ml-[19px] border-l-2 border-dashed border-border h-4 my-[-8px]"></div>
                        
                        <div className="flex items-start gap-3">
                          <div className="bg-primary/20 p-2 rounded-full mt-1"><User className="w-4 h-4 text-primary" /></div>
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Dropoff</div>
                            <div className="font-semibold text-white leading-tight mb-1">{order.address}</div>
                            {order.phone && (
                              <a href={`tel:${order.phone}`} className="inline-flex items-center text-xs text-primary font-medium bg-primary/10 px-2 py-1 rounded">
                                <PhoneCall className="w-3 h-3 mr-1" /> Call Customer
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {progression && (
                        <Button 
                          size="lg"
                          onClick={() => handleUpdateStatus(order.id, progression.next)}
                          disabled={updateStatus.isPending}
                          className={`w-full h-14 font-bold text-base active:scale-95 transition-all ${
                            progression.next === 'delivered' ? 'bg-green-600 hover:bg-green-700 text-white shadow-[0_0_15px_rgba(22,163,74,0.3)]' : ''
                          }`}
                        >
                          {updateStatus.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                            <>
                              {ActionIcon && <ActionIcon className="w-5 h-5 mr-2" />}
                              {progression.label}
                            </>
                          )}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
}

// -- EARNINGS TAB --
function EarningsTab() {
  const { data: summary, isLoading: isLoadingSummary } = useGetRiderEarnings();
  const { data: history, isLoading: isLoadingHistory } = useGetOrderHistory();

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-4 pt-8 h-full flex flex-col">
      <h2 className="text-2xl font-bold text-white mb-6">Earnings</h2>
      
      <div className="flex-1 overflow-y-auto pb-4">
        {isLoadingSummary ? (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : summary && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Card className="bg-primary border-none shadow-[0_0_15px_rgba(255,69,0,0.2)] text-primary-foreground">
                <CardContent className="p-4 flex flex-col justify-center items-center text-center h-full">
                  <span className="text-xs uppercase tracking-wider opacity-80 font-medium mb-1">Today</span>
                  <span className="text-2xl font-bold">{formatCurrency(summary.todayEarnings)}</span>
                  <span className="text-[10px] opacity-80 mt-1">{summary.todayDeliveries} trips</span>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="p-4 flex flex-col justify-center items-center text-center h-full">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">This Week</span>
                  <span className="text-2xl font-bold text-white">{formatCurrency(summary.weekEarnings)}</span>
                  <span className="text-[10px] text-muted-foreground mt-1">{summary.weekDeliveries} trips</span>
                </CardContent>
              </Card>
            </div>
            <Card className="bg-background border-border mb-8">
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium block">All Time</span>
                  <span className="text-xl font-bold text-white">{formatCurrency(summary.totalEarnings)}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium block">Deliveries</span>
                  <span className="text-xl font-bold text-white">{summary.totalDeliveries}</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-4 px-1">Recent Deliveries</h3>
        
        {isLoadingHistory ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : !history || history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No completed deliveries yet.</div>
        ) : (
          <div className="space-y-3">
            {history.map(order => (
              <div key={order.id} className="bg-card border border-border p-3 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <div className="font-medium text-sm text-white">{order.restaurantName || "Restaurant"}</div>
                    <div className="text-xs text-muted-foreground">{formatTime(order.createdAt)}</div>
                  </div>
                </div>
                <div className="font-bold text-white text-sm">{formatCurrency(order.total)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// -- PROFILE TAB --
function ProfileTab({ rider }: { rider: any }) {
  const queryClient = useQueryClient();
  const logoutMutation = useLogoutRider();
  const toggleOnline = useUpdateRiderAvailability();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetRiderMeQueryKey() })
    });
  };

  const handleToggleOnline = (checked: boolean) => {
    toggleOnline.mutate({ data: { isOnline: checked } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetRiderMeQueryKey() })
    });
  };

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="p-4 pt-8 h-full flex flex-col">
      <h2 className="text-2xl font-bold text-white mb-6">Profile</h2>
      
      <div className="flex-1 overflow-y-auto pb-4">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center border-2 border-primary/20">
            <User className="w-10 h-10 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">{rider.name}</h3>
            <p className="text-muted-foreground">{rider.phone}</p>
            <div className="flex items-center mt-1 space-x-2">
              <Badge variant="outline" className="text-[10px]">{rider.vehicleType}</Badge>
              <Badge variant="outline" className="text-[10px]">{rider.city}</Badge>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden mb-6">
          <div className="p-4 flex items-center justify-between border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-background rounded-lg"><Navigation className="w-4 h-4 text-white" /></div>
              <div className="font-medium text-white">Accepting Orders</div>
            </div>
            <Switch checked={rider.isOnline} onCheckedChange={handleToggleOnline} disabled={toggleOnline.isPending} />
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="bg-card border border-border p-4 rounded-xl flex flex-col items-center justify-center text-center">
            <span className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Rating</span>
            <span className="text-xl font-bold text-white">{rider.rating.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">/ 5</span></span>
          </div>
          <div className="bg-card border border-border p-4 rounded-xl flex flex-col items-center justify-center text-center">
            <span className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Reviews</span>
            <span className="text-xl font-bold text-white">{rider.ratingCount}</span>
          </div>
        </div>

        <Button 
          variant="destructive" 
          className="w-full h-14 text-base font-bold flex items-center justify-center" 
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : (
            <><LogOut className="w-5 h-5 mr-2" /> Sign Out</>
          )}
        </Button>
      </div>
    </motion.div>
  );
}

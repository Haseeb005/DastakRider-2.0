import React, { useState } from 'react';
import { 
  Menu, 
  RefreshCw, 
  MapPin, 
  Navigation, 
  Package, 
  CreditCard, 
  Banknote,
  X,
  ListTodo,
  Bike,
  Wallet,
  User,
  ChevronRight,
  CircleDot
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

export default function CleanLight() {
  const [isOnline, setIsOnline] = useState(true);
  const [showAlert, setShowAlert] = useState(true);

  const orders = [
    {
      id: 1,
      restaurant: "KFC",
      pickup: "Gulberg",
      dropoff: "DHA Phase 5",
      distance: "3.2 km",
      items: 2,
      paymentType: "COD",
      orderTotal: "1,850",
      fare: "140",
      color: "bg-red-500 text-white"
    },
    {
      id: 2,
      restaurant: "McDonald's",
      pickup: "Johar Town",
      dropoff: "Model Town",
      distance: "1.8 km",
      items: 1,
      paymentType: "Online paid",
      orderTotal: "1,120",
      fare: "140",
      color: "bg-yellow-500 text-white"
    },
    {
      id: 3,
      restaurant: "Pizza Hut",
      pickup: "Bahria Town",
      dropoff: "Bahria Orchard",
      distance: "4.5 km",
      items: 3,
      paymentType: "COD",
      orderTotal: "2,400",
      fare: "140",
      color: "bg-orange-500 text-white"
    }
  ];

  return (
    <div className="w-full h-full min-h-[900px] max-w-[430px] mx-auto bg-[#F9FAFB] relative overflow-hidden flex flex-col font-sans" style={{ fontFamily: '"Outfit", sans-serif' }}>
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />

      {/* Header */}
      <div className="bg-white px-5 pt-12 pb-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] z-10 sticky top-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[13px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Dastak Rider</h1>
            <h2 className="text-xl font-semibold text-slate-900 tracking-tight">Imran Riaz</h2>
          </div>
          <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-1 pr-4 border border-slate-100">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isOnline ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
              <Bike size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{isOnline ? 'Online' : 'Offline'}</p>
              <p className="text-xs text-slate-500 font-medium">Finding orders...</p>
            </div>
          </div>
          <Switch 
            checked={isOnline} 
            onCheckedChange={setIsOnline} 
            className="data-[state=checked]:bg-emerald-500"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto hide-scrollbar px-4 pt-4 pb-28">
        {/* Alert Banner */}
        {showAlert && (
          <div className="bg-blue-50 border border-blue-100/50 rounded-2xl p-4 flex items-start gap-3 mb-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 rounded-l-2xl"></div>
            <div className="mt-0.5">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-blue-900">2 new orders just arrived!</h3>
              <p className="text-xs text-blue-700 mt-0.5">Accept them before they expire.</p>
            </div>
            <button 
              onClick={() => setShowAlert(false)}
              className="text-blue-400 hover:text-blue-600 p-1 -mr-1"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="text-lg font-semibold text-slate-900">Available Orders</h3>
          <span className="bg-slate-200 text-slate-700 text-xs font-semibold px-2 py-0.5 rounded-full">3</span>
        </div>

        {/* Order List */}
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] border border-slate-100/80">
              {/* Route */}
              <div className="relative pl-6 mb-5">
                <div className="absolute left-[7px] top-1.5 bottom-1.5 w-[2px] bg-slate-100 rounded-full"></div>
                
                <div className="relative mb-4">
                  <div className="absolute -left-6 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-300"></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-lg ${order.color} flex items-center justify-center text-[10px] font-bold`}>
                      {order.restaurant.charAt(0)}
                    </div>
                    <span className="text-[15px] font-medium text-slate-900">{order.restaurant}</span>
                    <span className="text-slate-400 text-sm">•</span>
                    <span className="text-sm text-slate-500">{order.pickup}</span>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute -left-6 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-medium text-slate-900">{order.dropoff}</span>
                  </div>
                </div>
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-2 mb-5">
                <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600">
                  <Navigation size={12} className="text-slate-400" />
                  {order.distance}
                </div>
                <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600">
                  <Package size={12} className="text-slate-400" />
                  {order.items} {order.items === 1 ? 'item' : 'items'}
                </div>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium ${order.paymentType === 'COD' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {order.paymentType === 'COD' ? <Banknote size={12} /> : <CreditCard size={12} />}
                  {order.paymentType}
                </div>
              </div>

              <div className="h-[1px] bg-slate-100 w-full mb-4"></div>

              {/* Financials & Action */}
              <div className="flex items-end justify-between mb-5">
                <div>
                  <p className="text-xs text-slate-500 font-medium mb-1">Customer bill</p>
                  <p className="text-[13px] font-semibold text-slate-400 line-through decoration-slate-300">Rs {order.orderTotal}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-emerald-600 font-bold uppercase tracking-wider mb-0.5">Your Fare</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-semibold text-slate-900">Rs</span>
                    <span className="text-2xl font-bold text-slate-900 tracking-tight">{order.fare}</span>
                  </div>
                </div>
              </div>

              <button className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-2xl py-3.5 font-semibold text-[15px] transition-colors flex items-center justify-center gap-2 shadow-sm">
                Accept Order
                <ChevronRight size={18} className="text-slate-400" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="absolute bottom-0 w-full bg-white border-t border-slate-100 pb-safe pt-2 px-6 shadow-[0_-10px_20px_rgba(0,0,0,0.02)] z-20">
        <div className="flex items-center justify-between pb-6 pt-2">
          <div className="flex flex-col items-center gap-1.5 cursor-pointer">
            <div className="relative">
              <ListTodo size={24} className="text-slate-900" strokeWidth={2.5} />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-500 border-2 border-white rounded-full"></span>
            </div>
            <span className="text-[10px] font-semibold text-slate-900">Orders</span>
          </div>
          
          <div className="flex flex-col items-center gap-1.5 cursor-pointer opacity-40 hover:opacity-100 transition-opacity">
            <Bike size={24} className="text-slate-600" />
            <span className="text-[10px] font-medium text-slate-600">Active</span>
          </div>
          
          <div className="flex flex-col items-center gap-1.5 cursor-pointer opacity-40 hover:opacity-100 transition-opacity">
            <Wallet size={24} className="text-slate-600" />
            <span className="text-[10px] font-medium text-slate-600">Earnings</span>
          </div>
          
          <div className="flex flex-col items-center gap-1.5 cursor-pointer opacity-40 hover:opacity-100 transition-opacity">
            <User size={24} className="text-slate-600" />
            <span className="text-[10px] font-medium text-slate-600">Profile</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import {
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
  ArrowRight,
  Zap,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

const ORDERS = [
  {
    id: 1,
    restaurant: 'KFC',
    initials: 'KFC',
    pickup: 'Gulberg',
    dropoff: 'DHA Phase 5',
    distance: '3.2 km',
    items: 2,
    paymentType: 'COD',
    orderTotal: '1,850',
    fare: '140',
    color: 'bg-red-500',
  },
  {
    id: 2,
    restaurant: "McDonald's",
    initials: 'MCD',
    pickup: 'Johar Town',
    dropoff: 'Model Town',
    distance: '1.8 km',
    items: 1,
    paymentType: 'Online paid',
    orderTotal: '1,120',
    fare: '140',
    color: 'bg-amber-500',
  },
  {
    id: 3,
    restaurant: 'Pizza Hut',
    initials: 'PH',
    pickup: 'Bahria Town',
    dropoff: 'Bahria Orchard',
    distance: '4.5 km',
    items: 3,
    paymentType: 'COD',
    orderTotal: '2,400',
    fare: '140',
    color: 'bg-orange-600',
  },
];

export default function CleanEnergy() {
  const [isOnline, setIsOnline] = useState(true);
  const [showAlert, setShowAlert] = useState(true);

  return (
    <div
      className="w-full h-full min-h-[900px] max-w-[430px] mx-auto bg-[#F8F9FB] relative overflow-hidden flex flex-col"
      style={{ fontFamily: '"Outfit", sans-serif' }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .text-brand { color: #FF5A00; }
        .bg-brand { background-color: #FF5A00; }
      `,
        }}
      />

      {/* Header */}
      <div className="bg-white px-5 pt-12 pb-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] z-10 sticky top-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[12px] font-bold text-brand uppercase tracking-[0.12em] mb-0.5 flex items-center gap-1.5">
              <Bike size={14} strokeWidth={2.75} />
              Dastak Rider
            </h1>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Imran Riaz</h2>
          </div>
          <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors active:scale-95">
            <RefreshCw size={18} strokeWidth={2.25} />
          </button>
        </div>

        <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-1 pr-4 border border-slate-100">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                isOnline ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'
              }`}
            >
              <Bike size={20} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">{isOnline ? 'Online' : 'Offline'}</p>
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
        {showAlert && isOnline && (
          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 flex items-center gap-3 mb-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-brand rounded-l-2xl"></div>
            <div className="bg-brand/10 text-brand p-2 rounded-xl">
              <Zap size={20} className="fill-current" strokeWidth={2} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-orange-900">2 new orders just arrived!</h3>
              <p className="text-xs text-orange-700/90 mt-0.5 font-medium">Accept them before they expire.</p>
            </div>
            <button
              onClick={() => setShowAlert(false)}
              className="text-orange-400 hover:text-orange-600 p-1 -mr-1"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="text-lg font-bold text-slate-900">Available Orders</h3>
          <span className="bg-brand text-white text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide flex items-center gap-1">
            <span className="flex h-1.5 w-1.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
            </span>
            Live
          </span>
        </div>

        {/* Order List */}
        <div className="space-y-4">
          {ORDERS.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] border border-slate-100/80"
            >
              {/* Top row: badges + fare */}
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                      order.paymentType === 'COD'
                        ? 'bg-orange-50 text-orange-700'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {order.paymentType === 'COD' ? <Banknote size={12} /> : <CreditCard size={12} />}
                    {order.paymentType}
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600">
                    <Package size={12} className="text-slate-400" />
                    {order.items} {order.items === 1 ? 'item' : 'items'}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-brand font-extrabold uppercase tracking-[0.12em] mb-0.5">
                    Your Fare
                  </p>
                  <div className="flex items-baseline gap-1 justify-end">
                    <span className="text-sm font-bold text-brand">Rs</span>
                    <span className="text-[26px] leading-none font-black text-brand tracking-tight">
                      {order.fare}
                    </span>
                  </div>
                </div>
              </div>

              {/* Route timeline */}
              <div className="relative pl-4 mb-5">
                <div className="absolute left-[18px] top-5 bottom-5 w-[2px] bg-slate-100 rounded-full"></div>

                {/* Pickup */}
                <div className="relative mb-4 flex gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl ${order.color} flex items-center justify-center text-white text-[11px] font-extrabold shrink-0 z-10`}
                  >
                    {order.initials}
                  </div>
                  <div className="pt-0.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Pickup</p>
                    <p className="text-[15px] font-bold text-slate-900 leading-tight">
                      {order.restaurant}
                    </p>
                    <p className="text-xs text-slate-500 font-medium">{order.pickup}</p>
                  </div>
                </div>

                {/* Dropoff */}
                <div className="relative flex gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 shrink-0 z-10">
                    <MapPin size={18} strokeWidth={2.25} />
                  </div>
                  <div className="pt-0.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Dropoff</p>
                    <p className="text-[15px] font-bold text-slate-900 leading-tight">{order.dropoff}</p>
                    <p className="text-xs text-brand font-semibold flex items-center gap-1 mt-0.5">
                      <Navigation size={11} className="fill-current" />
                      {order.distance}
                    </p>
                  </div>
                </div>
              </div>

              {/* Divider + footer */}
              <div className="h-[1px] bg-slate-100 w-full mb-4"></div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-500 font-medium mb-0.5">Customer bill</p>
                  <p className="text-sm font-bold text-slate-700">Rs {order.orderTotal}</p>
                </div>
                <button className="bg-slate-900 hover:bg-slate-800 text-white rounded-2xl pl-5 pr-4 py-3 font-bold text-sm transition-all active:scale-95 flex items-center gap-2 shadow-sm">
                  Accept Order
                  <span className="bg-brand rounded-lg p-0.5">
                    <ArrowRight size={15} strokeWidth={2.75} className="text-white" />
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="absolute bottom-0 w-full bg-white border-t border-slate-100 pt-2 px-6 shadow-[0_-10px_20px_rgba(0,0,0,0.03)] z-20">
        <div className="flex items-center justify-between pb-6 pt-2">
          <div className="flex flex-col items-center gap-1.5 cursor-pointer text-brand relative">
            <div className="absolute -top-3 w-8 h-1 bg-brand rounded-full"></div>
            <ListTodo size={24} strokeWidth={2.75} />
            <span className="text-[10px] font-bold">Orders</span>
          </div>

          <div className="flex flex-col items-center gap-1.5 cursor-pointer text-slate-400 hover:text-slate-600 transition-colors">
            <Bike size={24} strokeWidth={2.25} />
            <span className="text-[10px] font-semibold">Active</span>
          </div>

          <div className="flex flex-col items-center gap-1.5 cursor-pointer text-slate-400 hover:text-slate-600 transition-colors">
            <Wallet size={24} strokeWidth={2.25} />
            <span className="text-[10px] font-semibold">Earnings</span>
          </div>

          <div className="flex flex-col items-center gap-1.5 cursor-pointer text-slate-400 hover:text-slate-600 transition-colors">
            <User size={24} strokeWidth={2.25} />
            <span className="text-[10px] font-semibold">Profile</span>
          </div>
        </div>
      </div>
    </div>
  );
}

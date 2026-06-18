import React, { useState } from "react";
import { 
  RefreshCcw, 
  MapPin, 
  Navigation, 
  ShoppingBag, 
  CreditCard, 
  Banknote,
  ListOrdered,
  Activity,
  Wallet,
  User,
  X,
  Bell
} from "lucide-react";

export default function DarkPro() {
  const [isOnline, setIsOnline] = useState(true);
  const [showAlert, setShowAlert] = useState(true);
  
  // Data
  const orders = [
    {
      id: 1,
      restaurant: "KFC",
      pickupArea: "Gulberg",
      dropoffArea: "DHA Phase 5",
      distance: "3.2",
      items: 2,
      payment: "COD",
      total: "1,850",
      fare: "140",
      color: "bg-[#E50000]" // KFC red
    },
    {
      id: 2,
      restaurant: "McDonald's",
      pickupArea: "Johar Town",
      dropoffArea: "Model Town",
      distance: "1.8",
      items: 1,
      payment: "Online paid",
      total: "1,120",
      fare: "140",
      color: "bg-[#FFC72C]" // McD yellow
    },
    {
      id: 3,
      restaurant: "Pizza Hut",
      pickupArea: "Bahria Town",
      dropoffArea: "Bahria Orchard",
      distance: "4.5",
      items: 3,
      payment: "COD",
      total: "2,400",
      fare: "140",
      color: "bg-[#EE2A24]" // PH red
    }
  ];

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#0a0a0c] text-white font-sans overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');
        .font-mono-num { font-family: 'JetBrains Mono', monospace; }
        
        /* Hide scrollbar */
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* Header */}
      <header className="flex-none bg-[#121214] border-b border-[#222] px-4 pt-12 pb-4 z-20">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[#a0a0a5] text-xs font-semibold tracking-wider uppercase mb-1">Dastak Rider</h1>
            <h2 className="text-xl font-bold tracking-tight">Imran Riaz</h2>
          </div>
          
          <div className="flex items-center gap-3 bg-[#1a1a1e] p-1.5 rounded-full border border-[#2a2a30]">
            <span className={`text-xs font-bold px-2 ${isOnline ? 'text-[#ccff00]' : 'text-gray-500'}`}>
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
            <button 
              onClick={() => setIsOnline(!isOnline)}
              className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ease-in-out ${isOnline ? 'bg-[#ccff00]' : 'bg-[#333]'}`}
            >
              <div className={`w-5 h-5 bg-[#0a0a0c] rounded-full shadow-sm transform transition-transform duration-300 ${isOnline ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative flex h-3 w-3">
              {isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ccff00] opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isOnline ? 'bg-[#ccff00]' : 'bg-gray-500'}`}></span>
            </div>
            <span className="text-sm font-medium text-[#d0d0d5]">
              {isOnline ? 'Finding orders...' : 'Go online to receive orders'}
            </span>
          </div>
          
          <button className="p-2 rounded-full bg-[#1a1a1e] text-[#a0a0a5] hover:text-white border border-[#2a2a30] transition-colors">
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto no-scrollbar relative">
        
        {/* Background ambient glow */}
        {isOnline && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-[#ccff00] opacity-[0.03] blur-3xl pointer-events-none" />
        )}

        <div className="px-4 py-4 space-y-4 pb-24">
          
          {/* Alert Banner */}
          {showAlert && isOnline && (
            <div className="bg-gradient-to-r from-[#1a1a1e] to-[#222228] border border-[#ccff00]/30 rounded-xl p-3 flex items-start justify-between shadow-[0_0_15px_rgba(204,255,0,0.05)] animate-in slide-in-from-top-2 fade-in duration-300">
              <div className="flex items-center gap-3">
                <div className="bg-[#ccff00]/20 p-2 rounded-lg">
                  <Bell className="w-5 h-5 text-[#ccff00]" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">New orders available</h3>
                  <p className="text-[#a0a0a5] text-xs">2 new orders just arrived!</p>
                </div>
              </div>
              <button 
                onClick={() => setShowAlert(false)}
                className="text-[#a0a0a5] hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Order List */}
          {isOnline ? (
            <div className="space-y-4">
              {orders.map((order) => (
                <div key={order.id} className="bg-[#121214] border border-[#222] rounded-2xl overflow-hidden shadow-lg relative">
                  
                  {/* Accent bar */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-[#333] to-[#1a1a1e]"></div>
                  
                  <div className="p-4 pl-5">
                    {/* Header: Earnings Focus */}
                    <div className="flex justify-between items-start border-b border-[#222] pb-4 mb-4">
                      <div>
                        <p className="text-[#a0a0a5] text-xs font-semibold tracking-wide uppercase mb-1">Your Fare</p>
                        <div className="flex items-baseline gap-1">
                          <span className="text-[#ccff00] text-sm font-bold">Rs</span>
                          <span className="text-3xl font-bold text-white font-mono-num tracking-tight">{order.fare}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[#a0a0a5] text-xs font-semibold tracking-wide uppercase mb-1">Distance</p>
                        <div className="flex items-baseline justify-end gap-1">
                          <span className="text-xl font-bold text-white font-mono-num">{order.distance}</span>
                          <span className="text-[#a0a0a5] text-sm font-medium">km</span>
                        </div>
                      </div>
                    </div>

                    {/* Route */}
                    <div className="relative mb-5">
                      <div className="absolute left-[11px] top-4 bottom-4 w-px bg-[#333]"></div>
                      
                      {/* Pickup */}
                      <div className="flex gap-3 items-start mb-4">
                        <div className="relative z-10 w-6 h-6 rounded-full bg-[#1a1a1e] border border-[#333] flex items-center justify-center mt-0.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${order.color}`}></div>
                        </div>
                        <div className="flex-1">
                          <h4 className="font-bold text-white leading-tight">{order.restaurant}</h4>
                          <p className="text-[#a0a0a5] text-sm">{order.pickupArea}</p>
                        </div>
                      </div>
                      
                      {/* Dropoff */}
                      <div className="flex gap-3 items-start">
                        <div className="relative z-10 w-6 h-6 rounded-full bg-[#1a1a1e] border border-[#ccff00]/50 flex items-center justify-center mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-[#ccff00]" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-bold text-white leading-tight">Customer Dropoff</h4>
                          <p className="text-[#a0a0a5] text-sm">{order.dropoffArea}</p>
                        </div>
                      </div>
                    </div>

                    {/* Meta tags */}
                    <div className="flex flex-wrap gap-2 mb-5">
                      <div className="flex items-center gap-1.5 bg-[#1a1a1e] px-2.5 py-1.5 rounded-md border border-[#2a2a30]">
                        <ShoppingBag className="w-3.5 h-3.5 text-[#a0a0a5]" />
                        <span className="text-xs font-medium text-[#d0d0d5]">{order.items} {order.items > 1 ? 'items' : 'item'}</span>
                      </div>
                      
                      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border ${order.payment === 'COD' ? 'bg-[#2a1a1e] border-[#ff4d4d]/30 text-[#ff4d4d]' : 'bg-[#1a2a1e] border-[#ccff00]/30 text-[#ccff00]'}`}>
                        {order.payment === 'COD' ? <Banknote className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
                        <span className="text-xs font-bold tracking-wide">{order.payment}</span>
                      </div>

                      <div className="flex items-center gap-1.5 bg-[#1a1a1e] px-2.5 py-1.5 rounded-md border border-[#2a2a30]">
                        <span className="text-[#a0a0a5] text-xs">Total:</span>
                        <span className="text-xs font-bold text-white">Rs {order.total}</span>
                      </div>
                    </div>

                    {/* Action */}
                    <button className="w-full bg-[#ccff00] hover:bg-[#b3e600] text-[#0a0a0c] font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] shadow-[0_0_20px_rgba(204,255,0,0.15)] flex items-center justify-center gap-2 text-[15px]">
                      Accept Order
                      <Navigation className="w-4 h-4 fill-current" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center opacity-50">
              <Activity className="w-12 h-12 text-[#555] mb-4" />
              <p className="text-[#a0a0a5] text-lg font-medium">You are offline</p>
              <p className="text-[#777] text-sm mt-1">Go online to start earning</p>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="flex-none bg-[#121214] border-t border-[#222] pb-4 pt-2 px-2 z-20">
        <div className="flex justify-around items-center pb-2">
          
          <button className="flex flex-col items-center p-2 min-w-[72px]">
            <div className="relative">
              <ListOrdered className="w-6 h-6 text-[#ccff00] mb-1" />
              <span className="absolute -top-1 -right-2 bg-[#ff4d4d] text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full border-2 border-[#121214]">
                3
              </span>
            </div>
            <span className="text-[10px] font-semibold text-[#ccff00]">Orders</span>
          </button>
          
          <button className="flex flex-col items-center p-2 min-w-[72px]">
            <Navigation className="w-6 h-6 text-[#777] mb-1" />
            <span className="text-[10px] font-medium text-[#777]">Active</span>
          </button>
          
          <button className="flex flex-col items-center p-2 min-w-[72px]">
            <Wallet className="w-6 h-6 text-[#777] mb-1" />
            <span className="text-[10px] font-medium text-[#777]">Earnings</span>
          </button>
          
          <button className="flex flex-col items-center p-2 min-w-[72px]">
            <User className="w-6 h-6 text-[#777] mb-1" />
            <span className="text-[10px] font-medium text-[#777]">Profile</span>
          </button>
          
        </div>
      </nav>
      
    </div>
  );
}

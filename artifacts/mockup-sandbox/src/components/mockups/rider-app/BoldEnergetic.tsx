import React, { useState } from 'react';
import {
  RefreshCw,
  MapPin,
  Package,
  CreditCard,
  ListOrdered,
  Wallet,
  User,
  X,
  Navigation,
  ArrowRight,
  CheckCircle2,
  Bike,
  Bell
} from 'lucide-react';

// Import Google Font specifically for this component to give it a bold energetic feel
// We'll use 'Outfit' for a modern, geometric, punchy look.

const ORDERS = [
  {
    id: 1,
    restaurant: "KFC",
    pickupArea: "Gulberg",
    dropoffArea: "DHA Phase 5",
    distance: "3.2 km",
    items: "2 items",
    paymentType: "COD",
    orderTotal: "1,850",
    fare: "140",
    color: "bg-red-500",
    textColor: "text-red-500",
    lightColor: "bg-red-50",
    initials: "KFC"
  },
  {
    id: 2,
    restaurant: "McDonald's",
    pickupArea: "Johar Town",
    dropoffArea: "Model Town",
    distance: "1.8 km",
    items: "1 item",
    paymentType: "Online paid",
    orderTotal: "1,120",
    fare: "140",
    color: "bg-amber-500",
    textColor: "text-amber-500",
    lightColor: "bg-amber-50",
    initials: "MCD"
  },
  {
    id: 3,
    restaurant: "Pizza Hut",
    pickupArea: "Bahria Town",
    dropoffArea: "Bahria Orchard",
    distance: "4.5 km",
    items: "3 items",
    paymentType: "COD",
    orderTotal: "2,400",
    fare: "140",
    color: "bg-orange-600",
    textColor: "text-orange-600",
    lightColor: "bg-orange-50",
    initials: "PH"
  }
];

export default function BoldEnergetic() {
  const [isOnline, setIsOnline] = useState(true);
  const [showAlert, setShowAlert] = useState(true);
  const [acceptedOrders, setAcceptedOrders] = useState<number[]>([]);

  const handleAccept = (id: number) => {
    setAcceptedOrders((prev) => [...prev, id]);
  };

  return (
    <div className="w-full h-full bg-[#F4F6F8] font-sans flex flex-col relative overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
        
        .bg-brand {
          background-color: #FF5A00;
        }
        .text-brand {
          color: #FF5A00;
        }
        .border-brand {
          border-color: #FF5A00;
        }
        .shadow-brand {
          box-shadow: 0 10px 25px -5px rgba(255, 90, 0, 0.4);
        }
      `}</style>

      {/* Header */}
      <header className="bg-white px-5 pt-12 pb-4 shadow-sm z-20 rounded-b-2xl">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-sm font-extrabold text-brand uppercase tracking-wider mb-0.5 flex items-center gap-1.5">
              <Bike size={16} strokeWidth={2.5} />
              Dastak Rider
            </h1>
            <p className="text-xl font-bold text-gray-900">Imran Riaz</p>
          </div>
          <button className="p-2.5 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors active:scale-95">
            <RefreshCw size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="relative flex h-4 w-4">
              {isOnline && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-4 w-4 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></span>
            </div>
            <span className={`font-bold text-lg ${isOnline ? 'text-green-600' : 'text-gray-500'}`}>
              {isOnline ? 'You are Online' : 'You are Offline'}
            </span>
          </div>
          
          <button 
            onClick={() => setIsOnline(!isOnline)}
            className={`w-14 h-8 rounded-full p-1 transition-colors duration-300 ease-in-out ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`}
          >
            <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ease-in-out ${isOnline ? 'translate-x-6' : 'translate-x-0'}`}></div>
          </button>
        </div>
      </header>

      {/* Main Content (Scrollable) */}
      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-4 hide-scrollbar">
        
        {/* Alert Banner */}
        {showAlert && isOnline && (
          <div className="bg-brand text-white p-4 rounded-2xl mb-6 shadow-brand flex items-center justify-between transform transition-all animate-in slide-in-from-top-4">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl">
                <Bell size={24} className="text-white fill-white" />
              </div>
              <div>
                <p className="font-extrabold text-lg">2 new orders arrived!</p>
                <p className="text-white/90 text-sm font-medium">Tap accept quickly to secure them.</p>
              </div>
            </div>
            <button 
              onClick={() => setShowAlert(false)}
              className="text-white/80 hover:text-white p-1"
            >
              <X size={20} strokeWidth={3} />
            </button>
          </div>
        )}

        {/* Orders List */}
        {!isOnline ? (
          <div className="flex flex-col items-center justify-center h-64 text-center mt-12">
            <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-4">
              <Bike size={40} className="text-gray-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">You're Offline</h2>
            <p className="text-gray-500 max-w-[250px]">Go online to start receiving and delivering orders.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <h2 className="font-bold text-gray-800 text-lg px-1 flex items-center justify-between">
              Available Orders
              <span className="bg-brand text-white text-xs px-2.5 py-1 rounded-full font-bold">LIVE</span>
            </h2>
            
            {ORDERS.map((order) => (
              <div key={order.id} className={`bg-white rounded-[24px] p-5 shadow-sm border border-gray-100 transition-all ${acceptedOrders.includes(order.id) ? 'opacity-50 scale-95 pointer-events-none' : ''}`}>
                
                {/* Header: Earn & Badges */}
                <div className="flex justify-between items-start mb-5">
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider ${order.paymentType === 'COD' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {order.paymentType}
                    </span>
                    <span className="px-3 py-1.5 rounded-xl bg-gray-100 text-gray-600 text-xs font-bold flex items-center gap-1">
                      <Package size={12} strokeWidth={3} />
                      {order.items}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-extrabold text-gray-400 uppercase tracking-widest mb-0.5">Your Fare</p>
                    <p className="text-2xl font-black text-brand leading-none">Rs {order.fare}</p>
                  </div>
                </div>

                {/* Route Information */}
                <div className="relative pl-4 mb-6">
                  {/* Timeline Line */}
                  <div className="absolute left-[7px] top-4 bottom-4 w-0.5 bg-gray-200 rounded-full"></div>
                  
                  {/* Pickup */}
                  <div className="relative mb-5">
                    <div className={`absolute -left-[14px] top-1 w-4 h-4 rounded-full border-4 border-white shadow-sm ${order.color}`}></div>
                    <div className="flex gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-extrabold shrink-0 ${order.color}`}>
                        {order.initials}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase mb-0.5">Pickup</p>
                        <p className="font-bold text-gray-900 text-lg leading-tight">{order.restaurant}</p>
                        <p className="text-gray-500 text-sm font-medium">{order.pickupArea}</p>
                      </div>
                    </div>
                  </div>

                  {/* Dropoff */}
                  <div className="relative">
                    <div className="absolute -left-[14px] top-1 w-4 h-4 rounded-full border-4 border-white shadow-sm bg-gray-800"></div>
                    <div className="flex gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600 shrink-0">
                        <MapPin size={20} strokeWidth={2.5} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase mb-0.5">Dropoff</p>
                        <p className="font-bold text-gray-900 text-lg leading-tight">{order.dropoffArea}</p>
                        <p className="text-brand font-bold text-sm flex items-center gap-1 mt-0.5">
                          <Navigation size={12} className="fill-brand" /> {order.distance}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer: Details & CTA */}
                <div className="flex items-center justify-between pt-4 border-t border-dashed border-gray-200">
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase mb-0.5">Customer Bill</p>
                    <p className="font-bold text-gray-800">Rs {order.orderTotal}</p>
                  </div>
                  
                  <button 
                    onClick={() => handleAccept(order.id)}
                    className="bg-gray-900 hover:bg-black text-white px-6 py-3.5 rounded-xl font-bold flex items-center gap-2 transition-transform active:scale-95"
                  >
                    {acceptedOrders.includes(order.id) ? (
                      <>Accepted <CheckCircle2 size={18} strokeWidth={3} className="text-green-400" /></>
                    ) : (
                      <>Accept Order <ArrowRight size={18} strokeWidth={3} className="text-brand" /></>
                    )}
                  </button>
                </div>

              </div>
            ))}
          </div>
        )}
      </main>

      {/* Bottom Tab Bar */}
      <nav className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 pb-safe pt-2 px-6 pb-6 z-30 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <div className="flex justify-between items-center">
          <button className="flex flex-col items-center p-2 text-brand group relative">
            <div className="absolute -top-3 w-10 h-1 bg-brand rounded-full"></div>
            <ListOrdered size={24} strokeWidth={3} className="mb-1" />
            <span className="text-[11px] font-bold">Orders</span>
          </button>
          <button className="flex flex-col items-center p-2 text-gray-400 hover:text-gray-600 transition-colors">
            <Bike size={24} strokeWidth={2.5} className="mb-1" />
            <span className="text-[11px] font-semibold">Active</span>
          </button>
          <button className="flex flex-col items-center p-2 text-gray-400 hover:text-gray-600 transition-colors">
            <Wallet size={24} strokeWidth={2.5} className="mb-1" />
            <span className="text-[11px] font-semibold">Earnings</span>
          </button>
          <button className="flex flex-col items-center p-2 text-gray-400 hover:text-gray-600 transition-colors">
            <User size={24} strokeWidth={2.5} className="mb-1" />
            <span className="text-[11px] font-semibold">Profile</span>
          </button>
        </div>
      </nav>

    </div>
  );
}

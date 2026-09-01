import {
  Banknote,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  LockKeyhole,
  MapPin,
  Navigation,
  Phone,
  Receipt,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";

type PrivacyState = "locked" | "revealed";

const order = {
  number: "D-10482",
  restaurant: "Burger Lab — Gulberg",
  restaurantAddress: "28-C Main Boulevard, Gulberg III, Lahore",
  restaurantPhone: "+92 300 123 4567",
  customer: "Ayesha Khan",
  customerPhone: "+92 321 765 4321",
  customerAddress: "House 18, Street 7, DHA Phase 5, Lahore",
  items: [
    { quantity: 1, name: "Smash Burger", detail: "Double patty · Extra cheese", price: "Rs. 890" },
    { quantity: 1, name: "Loaded Fries", detail: "Regular", price: "Rs. 420" },
    { quantity: 2, name: "Cola", detail: "Chilled", price: "Rs. 240" },
  ],
  total: "Rs. 1,550",
  riderFare: "Rs. 180",
};

function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "crimson" | "green" | "amber";
}) {
  return <span className={`dop-pill dop-pill--${tone}`}>{children}</span>;
}

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="dop-section">
      <div className="dop-section__label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="dop-panel">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`dop-row${strong ? " dop-row--strong" : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function RestaurantPanel() {
  return (
    <Section label="Pickup from" icon={<Store size={14} />}>
      <div className="dop-place">
        <div className="dop-place__mark">BL</div>
        <div className="dop-place__copy">
          <strong>{order.restaurant}</strong>
          <span>{order.restaurantAddress}</span>
          <a href={`tel:${order.restaurantPhone}`}>
            <Phone size={13} />
            {order.restaurantPhone}
          </a>
        </div>
      </div>
      <button className="dop-map-button" type="button">
        <Navigation size={14} />
        Open pickup in Maps
      </button>
    </Section>
  );
}

function CustomerPanel() {
  return (
    <Section label="Deliver to" icon={<UserRound size={14} />}>
      <div className="dop-place">
        <div className="dop-place__mark dop-place__mark--customer">
          <UserRound size={16} />
        </div>
        <div className="dop-place__copy">
          <strong>{order.customer}</strong>
          <span>{order.customerAddress}</span>
          <a href={`tel:${order.customerPhone}`}>
            <Phone size={13} />
            {order.customerPhone}
          </a>
        </div>
      </div>
      <button className="dop-map-button" type="button">
        <Navigation size={14} />
        Open delivery in Maps
      </button>
    </Section>
  );
}

function LockedCustomerPanel() {
  return (
    <Section label="Customer details" icon={<LockKeyhole size={14} />}>
      <div className="dop-locked">
        <div className="dop-locked__icon">
          <LockKeyhole size={18} />
        </div>
        <div>
          <strong>Hidden until you accept</strong>
          <span>Delivery address, phone, and customer name will appear here after acceptance.</span>
        </div>
      </div>
    </Section>
  );
}

function ItemsPanel() {
  return (
    <Section label={`Order items · ${order.items.length}`} icon={<Receipt size={14} />}>
      <div className="dop-items">
        {order.items.map((item) => (
          <div className="dop-item" key={item.name}>
            <div className="dop-item__count">{item.quantity}×</div>
            <div className="dop-item__copy">
              <strong>{item.name}</strong>
              <span>{item.detail}</span>
            </div>
            <b>{item.price}</b>
          </div>
        ))}
      </div>
    </Section>
  );
}

function PaymentPanel() {
  return (
    <Section label="Payment" icon={<CreditCard size={14} />}>
      <div className="dop-payment-badge">
        <CreditCard size={14} />
        <span>Paid online</span>
      </div>
      <div className="dop-payment-rows">
        <Row label="Order total" value={order.total} strong />
        <Row label="Your earning" value={order.riderFare} strong />
      </div>
    </Section>
  );
}

export function OrderPrivacy({ state }: { state: PrivacyState }) {
  const locked = state === "locked";

  return (
    <main className="dop-shell">
      <header className="dop-header">
        <div className="dop-brand">
          <div className="dop-brand__logo">D</div>
          <span>Dastak <em>Rider</em></span>
        </div>
        <span className="dop-online">
          <span />
          Online
        </span>
      </header>

      <div className="dop-content">
        <div className="dop-titlebar">
          <div>
            <span className="dop-eyebrow">Order details</span>
            <h1>#{order.number}</h1>
          </div>
          <Pill tone={locked ? "amber" : "green"}>
            {locked ? "New order" : "Accepted"}
          </Pill>
        </div>

        <div className={`dop-privacy dop-privacy--${locked ? "locked" : "revealed"}`}>
          <div className="dop-privacy__icon">
            {locked ? <LockKeyhole size={18} /> : <ShieldCheck size={19} />}
          </div>
          <div>
            <strong>{locked ? "Customer details are protected" : "Customer details unlocked"}</strong>
            <span>
              {locked
                ? "Accept this order to view delivery information."
                : "You accepted this order. Delivery information is now available."}
            </span>
          </div>
          {!locked && <Check className="dop-privacy__check" size={17} />}
        </div>

        <div className="dop-statusline">
          <div className="dop-statusline__step dop-statusline__step--done">
            <span><Check size={12} /></span>
            <small>Order received</small>
          </div>
          <div className={`dop-statusline__track${locked ? "" : " dop-statusline__track--done"}`} />
          <div className={`dop-statusline__step${locked ? "" : " dop-statusline__step--done"}`}>
            <span>{locked ? <LockKeyhole size={11} /> : <Check size={12} />}</span>
            <small>Accepted</small>
          </div>
          <div className="dop-statusline__track" />
          <div className="dop-statusline__step">
            <span><MapPin size={11} /></span>
            <small>Delivered</small>
          </div>
        </div>

        <RestaurantPanel />
        {locked ? <LockedCustomerPanel /> : <CustomerPanel />}
        <ItemsPanel />
        <PaymentPanel />

        <div className="dop-note">
          <Clock3 size={14} />
          <span>{locked ? "Order came in 2 min ago" : "Accepted just now · Keep customer details private"}</span>
        </div>
      </div>

      <footer className="dop-footer">
        {locked ? (
          <button className="dop-primary" type="button">
            <Check size={17} />
            Accept order
            <ChevronRight size={17} />
          </button>
        ) : (
          <button className="dop-primary dop-primary--arrived" type="button">
            <Navigation size={17} />
            Mark arrived at restaurant
            <ChevronRight size={17} />
          </button>
        )}
        <span className="dop-footer__hint">
          {locked ? "Customer info appears after acceptance" : "Next step · confirm pickup location"}
        </span>
      </footer>
    </main>
  );
}
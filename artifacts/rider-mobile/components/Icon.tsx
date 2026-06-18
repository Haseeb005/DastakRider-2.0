import {
  AlertCircle,
  ArrowRight,
  Bell,
  Bike,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  Inbox,
  LogOut,
  MapPin,
  MessageSquare,
  Navigation,
  Package,
  Phone,
  Power,
  RefreshCw,
  ShoppingBag,
  Star,
  Truck,
  User,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react-native";
import type { StyleProp, ViewStyle } from "react-native";

// SVG icon set (lucide). We render real SVGs via react-native-svg instead of an
// icon font, so icons paint reliably on web and native with no font preloading.
// Keys mirror the Feather names previously used so call sites stay unchanged.
const ICONS = {
  "alert-circle": AlertCircle,
  "arrow-right": ArrowRight,
  bell: Bell,
  bike: Bike,
  check: Check,
  "check-circle": CheckCircle,
  "chevron-right": ChevronRight,
  clock: Clock,
  "credit-card": CreditCard,
  "dollar-sign": DollarSign,
  inbox: Inbox,
  "log-out": LogOut,
  "map-pin": MapPin,
  "message-square": MessageSquare,
  navigation: Navigation,
  package: Package,
  phone: Phone,
  power: Power,
  "refresh-cw": RefreshCw,
  "shopping-bag": ShoppingBag,
  star: Star,
  truck: Truck,
  user: User,
  x: X,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 24,
  color = "#000000",
  strokeWidth = 2,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} style={style} />;
}

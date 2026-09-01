import "./_group.css";
import "./privacy.css";
import { OrderPrivacy } from "./_OrderPrivacy";

export function BeforeAccept() {
  return <OrderPrivacy state="locked" />;
}
import "./_group.css";
import "./privacy.css";
import { OrderPrivacy } from "./_OrderPrivacy";

export function AfterAccept() {
  return <OrderPrivacy state="revealed" />;
}
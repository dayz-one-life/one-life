import type { Metadata } from "next";
import { NotificationsInbox } from "@/components/notifications/inbox";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false }, // a private inbox has no business in a search index
};

export default function NotificationsPage() {
  return <NotificationsInbox />;
}

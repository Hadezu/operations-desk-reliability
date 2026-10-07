import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "Operations Desk · Approvals, with a record",
  description:
    "A multi-tenant approval workflow with verifiable engineering evidence.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

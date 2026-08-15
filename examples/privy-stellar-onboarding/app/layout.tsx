import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Privy → Stellar onboarding",
  description:
    "Email login to funded testnet contribution in one flow, via a Privy embedded wallet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

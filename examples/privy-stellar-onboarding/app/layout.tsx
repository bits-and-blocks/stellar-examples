import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stellar wallet from an email address",
  description:
    "Sign in with email and get a funded Stellar testnet wallet that can hold USDC and send its first payment. No seed phrase.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {/* The column that keeps the footer at the bottom of the viewport on a
            page too short to reach it, such as the signed-out one. */}
        <div className="page">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}

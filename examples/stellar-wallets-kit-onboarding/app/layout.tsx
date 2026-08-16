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
  title: "Onboard a Stellar wallet you already have",
  description:
    "Connect Freighter or xBull and get a funded Stellar testnet account that can hold USDC and send its first payment. The key never leaves the extension.",
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

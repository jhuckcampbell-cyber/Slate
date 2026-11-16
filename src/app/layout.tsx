import { ViewTransition } from "react";
import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import { publicEnv } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Scoreboard display face: headlines, odds, money, countdowns (CSS var --font-display).
const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: "Slate", template: "%s · Slate" },
  description: "Play-money betting tournaments with your friends. Blind picks, live sweat.",
  // iPhone "Add to Home Screen": full-screen launch, our icon, a light status bar on the paper page
  // (pages already pad for env(safe-area-inset-top)).
  appleWebApp: { capable: true, title: "Slate", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbfaf7",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${display.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers><ViewTransition>{children}</ViewTransition></Providers>
        <Toaster theme="light" position="top-center" richColors />
      </body>
    </html>
  );
}

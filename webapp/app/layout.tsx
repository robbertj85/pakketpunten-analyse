import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import "./marker-cluster.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pakketpuntenviewer - Alle pakketpunten in Nederland op de kaart",
  description: "Bekijk en vergelijk alle 18.000+ pakketpunten en pakketautomaten in Nederland. DHL, PostNL, DPD, InPost, Budbee, GLS, Amazon, VintedGo, ViaTim en De Buren op een interactieve kaart per gemeente.",
  openGraph: {
    title: "Pakketpuntenviewer - Alle pakketpunten in Nederland",
    description: "Bekijk en vergelijk alle 18.000+ pakketpunten en pakketautomaten in Nederland van 10 vervoerders op een interactieve kaart per gemeente.",
    type: "website",
    locale: "nl_NL",
    url: "https://pakketpuntenviewer.nl",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pakketpunten",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Poppins, Roboto, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Admix (SPRUKO) typography: Poppins headings · Roboto body/UI (nav var maps to Roboto in globals.css)
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PlayBeat Lead Pulse — WhatsApp Dialer, Bulk Messaging & CRM",
  description:
    "Enterprise CRM communication platform: lead management, CSV import, WhatsApp conversations, bulk campaigns, call activity, employee assignment, follow-ups and analytics.",
  icons: { icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${roboto.variable} ${poppins.variable} ${geistMono.variable} antialiased bg-[#eef1f7] text-[#212529]`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

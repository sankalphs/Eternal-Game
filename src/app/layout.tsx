import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eternal — The Shadow's Ascension",
  description: "A cinematic 2D shadow fighting game. You are the villain. Eight sealers stand in your way.",
  keywords: ["Shadow Fight", "fighting game", "martial arts", "canvas game", "Next.js"],
  authors: [{ name: "Z.ai" }],
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "Eternal — The Shadow's Ascension",
    description: "A cinematic 2D shadow fighting game. You are the villain.",
    url: "https://chat.z.ai",
    siteName: "Z.ai",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Eternal — The Shadow's Ascension",
    description: "A cinematic 2D shadow fighting game. You are the villain.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}

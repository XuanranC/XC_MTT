import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { UserMenu } from "./user-menu";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import type { Viewport } from "next";

export const metadata: Metadata = {
  title: "GTO Preflop Drill",
  description: "Master GTO preflop ranges through interactive drills",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex flex-col">
        <AuthProvider>
          {/* Desktop top nav */}
          <header className="hidden md:flex items-center justify-between px-6 py-3 border-b border-white/10 bg-bg-card/80 backdrop-blur-sm sticky top-0 z-50">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-accent font-bold text-xl tracking-tight">
                GTO Drill
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-sm font-medium">
              <Link
                href="/"
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                Study
              </Link>
              <Link
                href="/drill"
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                Drill
              </Link>
              <Link
                href="/progress"
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                Progress
              </Link>
              <UserMenu />
            </nav>
          </header>

          {/* Mobile top bar */}
          <header className="flex md:hidden items-center justify-between px-4 py-3 border-b border-white/10 bg-bg-card/80 backdrop-blur-sm sticky top-0 z-50">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-accent font-bold text-lg tracking-tight">
                GTO Drill
              </span>
            </Link>
            <UserMenu />
          </header>

          {/* Main content */}
          <main className="flex-1 pb-16 md:pb-0">{children}</main>

          {/* Mobile bottom tab bar */}
          <nav className="fixed bottom-0 left-0 right-0 md:hidden flex items-center justify-around bg-bg-card/95 backdrop-blur-sm border-t border-white/10 py-2 z-50">
            <Link
              href="/"
              className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors px-4 py-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              <span className="text-[10px] font-medium">Study</span>
            </Link>
            <Link
              href="/drill"
              className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors px-4 py-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
              <span className="text-[10px] font-medium">Drill</span>
            </Link>
            <Link
              href="/progress"
              className="flex flex-col items-center gap-0.5 text-text-secondary hover:text-accent transition-colors px-4 py-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              <span className="text-[10px] font-medium">Progress</span>
            </Link>
          </nav>
        </AuthProvider>
      </body>
    </html>
  );
}

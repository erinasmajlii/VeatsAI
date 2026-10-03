import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VeatsAI — AI-assisted electrical engineering",
  description: "From natural language to engineering, standards, BOM, inventory, cost, CAD, quote and engineer approval.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="print-full min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}

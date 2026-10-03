import type { Metadata } from "next";
import { LangProvider } from "@/components/i18n";
import { TopBar } from "@/components/topbar";
import { getLang } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "VeatsAI — AI-assisted electrical engineering",
  description: "From natural language to engineering, standards, BOM, inventory, cost, CAD, quote and engineer approval.",
};

// Applies the saved/system theme before first paint (avoids a light→dark flash).
const THEME_SCRIPT = `try{var t=localStorage.getItem("veats-theme");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = await getLang();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <LangProvider lang={lang}>
          <TopBar />
          <main className="print-full">{children}</main>
        </LangProvider>
      </body>
    </html>
  );
}

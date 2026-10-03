import type { Metadata } from "next";
import { LangProvider } from "@/components/i18n";
import { getLang } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "VEATSAI — Electrical engineering platform",
  description: "From architectural plan to approved electrical design: upload, analyse, review, approve and release.",
};

// Runs before first paint: applies the saved/system theme (no light→dark flash) and remembers that the intro was already played in this tab.
const BOOT_SCRIPT = `try{var t=localStorage.getItem("veats-theme");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}try{if(sessionStorage.getItem("veats-intro")==="1")document.documentElement.setAttribute("data-intro","seen")}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = await getLang();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}

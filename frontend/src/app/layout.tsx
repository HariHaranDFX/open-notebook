import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ConnectionGuard } from "@/components/common/ConnectionGuard";
import { themeScript } from "@/lib/theme-script";
import { I18nProvider } from "@/components/providers/I18nProvider";
import { BrandProvider } from "@/components/providers/BrandProvider";
import { getBrandConfig, getReadableBrandForeground } from "@/lib/brand-config";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-source-sans",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-source-serif",
  display: "swap",
});

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  const brand = getBrandConfig()

  return {
    title: brand.appName,
    description: "Privacy-focused research and knowledge management",
    // Authenticated internal application — keep it out of search indexes.
    robots: { index: false, follow: false },
    icons: brand.faviconUrl ? { icon: brand.faviconUrl } : undefined,
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brand = getBrandConfig()
  const brandStyle = {
    '--brand-action-light': brand.actionLight,
    '--brand-action-light-foreground': getReadableBrandForeground(brand.actionLight),
    '--brand-action-dark': brand.actionDark,
    '--brand-action-dark-foreground': getReadableBrandForeground(brand.actionDark),
  } as CSSProperties

  return (
    <html lang="en" suppressHydrationWarning style={brandStyle}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sourceSans.variable} ${sourceSerif.variable} font-sans`}>
        <BrandProvider brand={brand}>
          <ErrorBoundary>
            <ThemeProvider>
              <QueryProvider>
                <I18nProvider>
                  <ConnectionGuard>
                    {children}
                    <Toaster />
                  </ConnectionGuard>
                </I18nProvider>
              </QueryProvider>
            </ThemeProvider>
          </ErrorBoundary>
        </BrandProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import { QueryProvider } from "@/components/providers/query-provider";
import { Navigation } from "@/components/navigation";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Pyre Sauna + Cold Plunge",
  description: "Schedule and manage your bookings with Pyre",
  icons: {
    icon: "/assets/logos/pyre-logo.png",
    shortcut: "/assets/logos/pyre-logo.png",
    apple: "/assets/logos/pyre-logo.png",
  },
};

// Pyre Brand Fonts
const pyreLogo = localFont({
  src: [
    {
      path: "../public/assets/fonts/Eckmannpsych-Small.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/Eckmannpsych-Small.woff",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-pyre-logo",
  display: "swap",
});

const pyreMono = localFont({
  src: [
    {
      path: "../public/assets/fonts/PPNeueMontreal-Mono.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/PPNeueMontreal-Mono.woff",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-pyre-mono",
  display: "swap",
});

const pyreSans = localFont({
  src: [
    {
      path: "../public/assets/fonts/PPNeueMontreal-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/PPNeueMontreal-Regular.woff",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/PPNeueMontreal-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/PPNeueMontreal-SemiBold.woff",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-pyre-sans",
  display: "swap",
});

const pyreMonoBold = localFont({
  src: [
    {
      path: "../public/assets/fonts/PPFraktionMono-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/PPFraktionMono-Bold.woff",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-pyre-mono-bold",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${pyreMono.variable} ${pyreLogo.variable} ${pyreSans.variable} ${pyreMonoBold.variable} font-mono antialiased`}>
        <QueryProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <div className="min-h-screen flex flex-col">
              <Navigation />
              <main className="flex-1">
                {children}
              </main>
            </div>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

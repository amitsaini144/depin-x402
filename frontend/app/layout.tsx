import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import '@solana/wallet-adapter-react-ui/styles.css'
import { SolanaProvider } from '@/components/wallet/solanaProvider'
import { ThemeProvider } from '@/components/ui/themeProvider'

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "SettLd — DePIN x402 Operator Dashboard",
  description: "SettLd · DePIN facilitator network dashboard for x402 on Solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <SolanaProvider>
            {children}
          </SolanaProvider>
        </ThemeProvider>
      </body>
    </html >
  );
}

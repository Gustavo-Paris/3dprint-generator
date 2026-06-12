import type { Metadata, Viewport } from "next";
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
  metadataBase: new URL(process.env.AUTH_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Gerador 3D',
    template: '%s · Gerador 3D',
  },
  description: 'Gere, visualize e fatie peças para impressão 3D a partir de uma descrição ou imagem.',
  applicationName: 'Gerador 3D',
  openGraph: {
    title: 'Gerador 3D',
    description: 'Gere, visualize e fatie peças para impressão 3D a partir de uma descrição ou imagem.',
    siteName: 'Gerador 3D',
    locale: 'pt_BR',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#3b82f6',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

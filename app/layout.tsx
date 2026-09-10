import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const fredoka = localFont({
  display: "swap",
  src: [
    { path: "../node_modules/@fontsource/fredoka/files/fredoka-latin-500-normal.woff2", weight: "500" },
    { path: "../node_modules/@fontsource/fredoka/files/fredoka-latin-600-normal.woff2", weight: "600" },
    { path: "../node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-fredoka",
});

const nunito = localFont({
  display: "swap",
  src: [
    { path: "../node_modules/@fontsource/nunito/files/nunito-latin-500-normal.woff2", weight: "500" },
    { path: "../node_modules/@fontsource/nunito/files/nunito-latin-600-normal.woff2", weight: "600" },
    { path: "../node_modules/@fontsource/nunito/files/nunito-latin-700-normal.woff2", weight: "700" },
    { path: "../node_modules/@fontsource/nunito/files/nunito-latin-800-normal.woff2", weight: "800" },
    { path: "../node_modules/@fontsource/nunito/files/nunito-latin-900-normal.woff2", weight: "900" },
  ],
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: "Scar | Shared safety memory",
  description: "Shared safety memory for autonomous agents.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}

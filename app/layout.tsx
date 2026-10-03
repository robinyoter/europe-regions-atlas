import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Атлас регионов Европы",
  description: "Исследуйте административные регионы Европы на интерактивной карте.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Shareboard | 情報共有", description: "トピック単位でチームの情報を共有するアプリ" };
export default function RootLayout({ children }: LayoutProps<"/">) { return <html lang="ja"><body>{children}</body></html>; }

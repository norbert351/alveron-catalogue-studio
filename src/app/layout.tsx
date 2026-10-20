import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alveron Catalogue Studio",
  description: "Private catalogue creation studio for Alveron Fashion.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}

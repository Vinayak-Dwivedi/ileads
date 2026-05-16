import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QMS — Quality Management System",
  description: "Contact-centre call audits, parameters, and reviews.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased min-h-screen bg-[#f4f7fb] text-slate-700">
        {children}
      </body>
    </html>
  );
}

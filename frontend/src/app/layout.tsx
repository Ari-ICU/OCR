import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Khmer OCR & AI Formula Corrector",
  description: "Extract Khmer text from PDF, fix Unicode character ordering, grammar, and preserve mathematical formulas with Gemini AI.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="km" className="dark h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-[#070A12] text-[#F8FAFC]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

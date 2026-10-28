import type { Metadata } from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Gas Forecast',
  description: 'When will this transaction be cheaper? Fee history, hour-of-week heatmap and a seven-day forecast across major chains.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("light", "font-sans", geist.variable)}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}

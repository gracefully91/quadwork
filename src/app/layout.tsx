import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import GlobalNotificationListener from "@/components/GlobalNotificationListener";

const pretendard = localFont({
  src: "../../public/fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuadWork",
  description: "Unified dashboard for multi-agent coding teams",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${pretendard.variable} h-full`}>
      <body className="h-full flex flex-col">
        <GlobalNotificationListener />
        <TopHeader />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}

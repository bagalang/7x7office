import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../components/AuthProvider";

export const metadata: Metadata = {
  title: "7x7office · secp",
  description: "Файлове и офис документи",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="bg">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

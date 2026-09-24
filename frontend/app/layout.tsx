import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../components/AuthProvider";
import { ThemeProvider } from "../components/ThemeProvider";
import { I18nProvider } from "../components/I18nProvider";
import { WorkspaceProvider } from "../components/WorkspaceProvider";
import { RealtimeProvider } from "../components/RealtimeProvider";
import { THEME_SCRIPT } from "../lib/theme";

export const metadata: Metadata = {
  title: "7x7office · secp",
  description: "Файлове и офис документи",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // lang="bg" е само SSR началната стойност; I18nProvider го сменя според
    // избора на потребителя (и за spellCheck, и за екранни четци).
    <html lang="bg-BG" suppressHydrationWarning>
      <head>
        {/* Темата се слага преди първото рисуване — иначе мига бяло при тъмна. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              {/* RealtimeProvider е ПОД WorkspaceProvider: той чете
                  активното пространство, за да се абонира за него. */}
              <WorkspaceProvider>
                <RealtimeProvider>{children}</RealtimeProvider>
              </WorkspaceProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

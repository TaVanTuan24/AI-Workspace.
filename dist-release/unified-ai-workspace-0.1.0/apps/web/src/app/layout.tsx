import "../styles/globals.css";
import type { Metadata } from "next";
import { Providers } from "../lib/providers";
import { AppNav } from "../components/AppNav";
import { WorkspaceNotifications } from "../components/WorkspaceNotifications";

export const metadata: Metadata = {
  title: "Unified AI Workspace",
  description: "Local-first workspace for personal AI provider accounts"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppNav />
          <WorkspaceNotifications />
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}

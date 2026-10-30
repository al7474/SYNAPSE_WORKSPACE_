import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const pageTitle = "Synapse Workspace | Collaborative Technical Notes";
const pageDescription =
  "A collaborative technical-notes workspace with autosave, realtime updates, and semantic search.";

export const metadata: Metadata = {
  metadataBase: new URL("https://synapse-workspace-app.vercel.app"),
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "/",
    siteName: "Synapse Workspace",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: pageTitle,
    description: pageDescription,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

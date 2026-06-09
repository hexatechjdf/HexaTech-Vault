import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "HexaTech Vault",
  description: "Secure company file management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
          <Toaster
            position="top-right"
            theme="light"
            duration={3500}
            visibleToasts={4}
            closeButton
            toastOptions={{
              classNames: {
                toast: "brand-toast",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}

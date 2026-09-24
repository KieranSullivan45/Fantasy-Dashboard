import "./globals.css";

export const metadata = {
  title: "Fantasy Command Center",
  description: "Live Sleeper league dashboard and read-only ChatGPT snapshot.",
};
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

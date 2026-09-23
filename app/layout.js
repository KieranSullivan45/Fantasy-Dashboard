import "./globals.css";

export const metadata = {
  title: "Fantasy Command Center",
  description: "Live Sleeper league dashboard and read-only ChatGPT snapshot.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

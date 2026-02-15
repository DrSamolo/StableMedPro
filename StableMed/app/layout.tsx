import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <head>
        <title>SudMed CRM</title>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}

import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <head>
        <title>StableMed CRM</title>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}

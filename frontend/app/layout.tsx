import React from "react"
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AuthProvider } from '@/lib/auth-context'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Capacita DC',
  description: 'Gestão de membros, trainees e conteúdos do setor comercial',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // next-themes troca a classe do <html> antes da hidratação.
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`font-sans antialiased`}>
        {/* O escuro continua como padrão; a escolha de cada pessoa fica salva no navegador.
            Ele é marcado como "theme-dark", não "dark", para as variantes dark: dos
            componentes continuarem desligadas como sempre estiveram (ver globals.css). */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}
          value={{ light: "light", dark: "theme-dark" }} disableTransitionOnChange>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}

import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'Market Signals',
  description: 'Personal algorithmic signal observations. Not investment advice.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full bg-zinc-950 text-zinc-100 antialiased">
        {children}

        <div className="fixed bottom-0 inset-x-0 z-50 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 px-4 py-2 text-center text-xs text-zinc-500 leading-relaxed">
          <strong className="text-zinc-400">Signals are algorithmic observations only — not investment advice.</strong>{' '}
          Never use this tool to make financial decisions. No trade execution. Past signals do not predict future performance.
        </div>
      </body>
    </html>
  )
}

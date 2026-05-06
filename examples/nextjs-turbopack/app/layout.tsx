import { WebDevMcpInit } from '@winstonfassett/webdev-nextjs/init'

export const metadata = {
  title: 'Next.js MCP Test App (turbopack)',
  description: 'Testing webdev-gateway with Turbopack',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <WebDevMcpInit />
        {children}
      </body>
    </html>
  )
}

import { withWebdev } from '@winstonfassett/webdev-nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {}

// Webpack mode: withWebdev injects client via webpack entry + adds rewrites
// No WebdevInit component needed
export default withWebdev(nextConfig)

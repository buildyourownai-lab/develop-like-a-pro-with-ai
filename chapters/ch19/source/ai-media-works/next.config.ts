import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16's `next dev` otherwise writes AGENTS.md/CLAUDE.md at the repo
  // root on every dev server start — unrelated noise in this chapter's tree.
  agentRules: false,
};

export default nextConfig;

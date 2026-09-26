import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma 在 Node 运行时执行，避免被打包器误处理
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;

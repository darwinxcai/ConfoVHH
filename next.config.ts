import type { NextConfig } from "next";

const isVercelStaticBuild = process.env.CONFOVHH_VERCEL_STATIC === "1";

const nextConfig: NextConfig = isVercelStaticBuild
  ? {
      output: "export",
    }
  : {
      async redirects() {
        return [
          {
            source: "/:path*",
            has: [
              {
                type: "host",
                value: "confovhh.darwin-cai.chatgpt.site",
              },
            ],
            destination: "https://github.com/darwinxcai/ConfoVHH",
            permanent: false,
          },
        ];
      },
    };

export default nextConfig;

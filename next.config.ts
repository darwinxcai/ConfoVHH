import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

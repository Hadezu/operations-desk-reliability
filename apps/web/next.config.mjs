import { fileURLToPath } from "node:url";
/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  trailingSlash: true,
  poweredByHeader: false,
  ...(process.env.NODE_ENV === "development"
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: "http://127.0.0.1:3101/api/:path*",
            },
          ];
        },
      }
    : {}),
};
export default config;

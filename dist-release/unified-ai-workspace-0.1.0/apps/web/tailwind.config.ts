import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(214 18% 88%)",
        panel: "hsl(0 0% 100%)",
        ink: "hsl(222 22% 12%)",
        muted: "hsl(215 12% 45%)",
        surface: "hsl(210 30% 98%)",
        accent: "hsl(173 64% 35%)",
        warn: "hsl(38 92% 50%)",
        danger: "hsl(0 72% 51%)"
      }
    }
  },
  plugins: []
};

export default config;

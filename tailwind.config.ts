import type { Config } from "tailwindcss";

// Tailwind v4 reads its real theme from CSS (`@theme inline` in app/globals.css).
// This file exists for IDE intellisense (so editor autocomplete knows about
// our brand utilities) and as the single canonical place where the brand
// token names are documented. The CSS variables themselves are declared in
// :root and mutated at runtime by <BrandingApplier /> in app/providers.tsx,
// which subscribes to the React Query branding cache.
//
// Available utilities (the v4 generator picks these up from globals.css):
//   bg-brand-primary       text-brand-primary       border-brand-primary
//   bg-brand-accent        text-brand-accent        border-brand-accent
//   bg-brand-primary-light text-brand-primary-light border-brand-primary-light
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "var(--brand-primary)",
          "primary-light": "var(--brand-primary-light)",
          accent: "var(--brand-accent)",
        },
      },
    },
  },
  plugins: [],
};

export default config;

import coffee from "vite-plugin-coffee";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit(),
    coffee({
      jsx: false,
    }),
  ],
});

import vinext from "vinext";
import { defineConfig } from "vite";

// This atlas is a static export; no Worker or runtime bindings are needed.
export default defineConfig({ plugins: [vinext()] });

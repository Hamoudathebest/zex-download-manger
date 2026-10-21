import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Phase 1 web prototype only. No Tauri / native code is configured here.
// Tauri + Windows packaging is explicitly Phase 2 (see README.md).
export default defineConfig({
  plugins: [react(), tailwindcss()],
})

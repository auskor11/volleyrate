import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // rally-lab holds the Python detector lab (and gigabytes of local video); the app never imports it
  server: { watch: { ignored: ['**/rally-lab/**', '**/private/**'] } },
})

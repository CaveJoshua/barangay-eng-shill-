import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('jspdf') || id.includes('docx') || id.includes('html2canvas')) {
              return 'pdf-engine';
            }
            if (id.includes('exceljs')) {
              return 'excel-engine';
            }
            if (id.includes('chart.js') || id.includes('react-chartjs-2')) {
              return 'charts-engine';
            }
            if (id.includes('lucide') || id.includes('react-icons')) {
              return 'icons-bundle';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'react-core';
            }
          }
        }
      }
    }
  }
})

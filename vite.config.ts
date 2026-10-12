import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      /**
       * Вендоров выносим в отдельные чанки НЕ ради красоты, а ради кеша.
       *
       * Исходники приложения меняются на каждом деплое, а react/motion/lucide
       * — практически никогда. Если они лежат в общем чанке, каждая правка
       * инвалидирует их копию в кеше у всех, кто открывал Mini App: человек
       * снова качает 200+ КБ неизменившегося кода. Отдельные чанки переиспользуются
       * из кеша и переживают деплой.
       */
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            // React и его рантайм должны ехать одним куском: motion и react-dom
            // импортируют их синхронно на старте, и разнесение по чанкам
            // добавляет лишний запрос при первом рендере.
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
            if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'motion';
            if (id.includes('node_modules/lucide-react')) return 'icons';
            return 'vendor';
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

import {StrictMode, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initTelegram} from './telegram';
import ErrorBoundary from './components/ErrorBoundary.tsx';

// Инициализируем Telegram Mini App (безопасно вне Telegram — просто no-op).
initTelegram();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/*
      Граница ошибок — обязательная. Приложение открывается как Telegram Mini App
      без адресной строки, поэтому необработанный сбой рендера = белый экран, из
      которого нельзя выйти. Здесь он превращается в экран с кнопкой перезагрузки.
    */}
    <ErrorBoundary area="загрузка">
      {/* Пока тянется первый чанк — тот же пульсирующий знак, что и на афише. */}
      <Suspense fallback={<BootSplash />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);

/** Заглушка на время подгрузки стартового чанка. */
function BootSplash() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 rounded-full border-2 border-[#E6FD3A]/25 border-t-[#E6FD3A] animate-spin" />
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/40">Загружаем клуб…</p>
    </div>
  );
}

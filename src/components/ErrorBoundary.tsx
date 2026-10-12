import { Component, type ErrorInfo, type ReactNode } from 'react';
import { LogoEmblem } from './VectorIcons';
import { clearChunkReloadFlag } from '../lazy';

interface Props {
  children: ReactNode;
  /** Имя слоя для сообщения — «Афиша», «Профиль», «Админка». */
  area?: string;
}

interface State {
  error: Error | null;
}

/**
 * Граница ошибок.
 *
 * Зачем она здесь: приложение живёт внутри Telegram Mini App, где нет
 * адресной строки и кнопки «назад». Любой сбой рендера без этой границы
 * даёт белый экран, из которого человек не может выйти вообще — он закрывает
 * и открывает Mini App заново и не понимает, что произошло. С границей он
 * хотя бы видит, что случилось, и может перезагрузить страницу одним тапом.
 *
 * Почему class, а не функция: `getDerivedStateFromError` и `componentDidCatch`
 * на хуках не существуют, а ловить ошибки рендера в React можно только ими.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Не роняем приложение из-за самого логирования — worst case пишем в консоль.
    try {
      console.error(`[flint:${this.props.area || 'app'}] рендер упал`, error, info.componentStack);
    } catch {
      /* консоль недоступна — молча */
    }
  }

  private reset = (): void => {
    // Снимаем флаг «уже перезагружались»: новая попытка должна быть честной,
    // иначе следующая ошибка увидит флаг и не даст перезагрузиться снова.
    clearChunkReloadFlag();
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        id="error-boundary"
        className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center px-6 text-center"
      >
        <LogoEmblem size={56} className="opacity-40" />
        <h1 className="font-display font-black text-2xl uppercase tracking-tight mt-5 mb-3">
          Что-то сломалось
        </h1>
        <p className="text-sm text-white/60 max-w-sm leading-relaxed">
          Экран не открылся{this.props.area ? ` (${this.props.area})` : ''}. Обычно помогает
          перезагрузка — данные не пропадут.
        </p>

        {/* Диагностика: текст ошибки помогает понять, это наша ошибка или
            проблема сети/CDN. Скрыт в <details>, чтобы не пугать обычного
            пользователя стеком. */}
        <details className="mt-5 text-left w-full max-w-sm">
          <summary className="cursor-pointer text-[11px] text-white/40 font-mono uppercase tracking-wider">
            Подробности
          </summary>
          <pre className="mt-2 text-[10px] text-rose-300/80 font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {String(error?.message || error)}
          </pre>
        </details>

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={this.reset}
            className="px-6 py-3 rounded-full bg-[#E6FD3A] text-black font-black text-sm uppercase tracking-wide border-none cursor-pointer"
          >
            Попробовать снова
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-full border border-white/15 text-white/70 font-mono text-xs uppercase tracking-wide cursor-pointer bg-transparent"
          >
            Перезагрузить
          </button>
        </div>
      </div>
    );
  }
}

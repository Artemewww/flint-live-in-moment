import React from 'react';
import { Instagram } from 'lucide-react';
import { SOCIAL } from '../site';
import { openBot } from '../telegram';

/**
 * ССЫЛКИ КЛУБА ВНЕ TELEGRAM — Instagram и Threads.
 *
 * Почему это важно именно в приложении, а не в описании канала: человек,
 * пришедший из рилса или из пересланного приглашения, открывает Mini App и
 * дальше листает ленту. Если отсюда нельзя перейти в Instagram, контакт с
 * клубом обрывается на первом же экране — и человек уходит туда, где уже есть
 * контент (то есть к конкурентам, а не к нам).
 *
 * Ссылки ОТКРЫВАЮТСЯ ЧЕРЕЗ openTelegramLink, а не через `target="_blank"`:
 * внутри Telegram обычный переход по внешней ссылке открывает системный
 * браузер поверх мессенджера, и человек теряет приложение. `openBot` уже
 * умеет разбирать оба случая (внутри Telegram и в обычном браузере), поэтому
 * переиспользуем его — иначе эти кнопки сломались бы на десктопной веб-версии.
 */

/** Threads нет в lucide (и не будет —Meta держит знак проприетарным), рисуем свой. */
function ThreadsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12.19 2C6.9 2 4.2 5.1 4.2 10.1c0 2.5.9 4.6 2.6 6.1.4.4.6.7.6 1.2 0 .4-.1.9-.2 1.3-.1.3-.3.5-.6.5-.3 0-.6-.1-.9-.2-2.9-1.2-4.8-4-4.8-7.5C.9 6.6 5.3 1.2 12.3 1.2c4.3 0 7.6 2.1 8.9 5.2.1.3.1.6.1.9 0 2.4-1.6 4.1-3.8 4.5-1.4.2-2.6-.5-2.8-1.6-.1-.4.1-.8.3-1.1.3-.5.7-.9 1.3-1.2.7-.4 1.2-1 1.2-1.9 0-1.3-1.2-2.4-3.2-2.4-2.5 0-4.4 1.4-4.4 3.3 0 .6.2 1.1.5 1.6.2.3.2.5 0 .8-.4.5-.9 1.3-.9 1.8 0 .6.4 1 .9 1.4.5.4 1.1.5 1.7.4 1.8-.3 2.9-1.6 2.9-3.4 0-.6-.1-1.2-.4-1.7-.2-.3-.2-.5 0-.8.3-.4.9-1.1.9-1.7 0-.7-.5-1.3-1.1-1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Props = {
  /** Тёмный фон (приложение) или светлый (жёлтый футер). */
  tone?: 'dark' | 'light';
  className?: string;
};

export default function SocialLinks({ tone = 'dark', className = '' }: Props) {
  const dark = tone === 'dark';
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer no-underline';
  const skin = dark
    ? 'border-white/15 text-white/70 hover:text-brand hover:border-brand/40 hover:bg-brand/10'
    : 'border-black/20 text-black/75 hover:bg-black/10';
  const box = 'h-9 px-3';

  /**
   * Ссылки на Instagram и Threads открываем обычным window.open, а НЕ через
   * openTelegramLink.
   *
   * Живой баг: openTelegramLink задуман для t.me. На внешний домен внутри
   * Mini App он либо ничего не делает, либо открывает встроенный браузер
   * Telegram, из которого не вернуться в приложение — человек видит, что
   * перехода нет. Ссылка на t.me вроде бота оставляем на openBot, там он и
   * нужен. В обычном браузере window.open честно откроет новую вкладку.
   */
  const open = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault();
    if (/^https?:\/\/t\.me\//i.test(url)) { openBot(url); return; }
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) window.location.href = url;
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <a
        href={SOCIAL.instagram}
        onClick={(e) => open(e, SOCIAL.instagram)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} ${skin} ${box}`}
        title="Instagram клуба"
      >
        <Instagram className="w-4 h-4" />
        Instagram
      </a>
      <a
        href={SOCIAL.threads}
        onClick={(e) => open(e, SOCIAL.threads)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} ${skin} ${box}`}
        title="Threads клуба"
      >
        <ThreadsGlyph className="w-4 h-4" />
        Threads
      </a>
    </div>
  );
}
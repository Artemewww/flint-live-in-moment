import React, { useState } from 'react';

/**
 * Кружок участника: фото из Telegram, а если его нет или оно скрыто
 * приватностью — первая буква имени на цветном фоне. Фото грузится лениво,
 * и пока его нет, буква уже видна: кружок не мигает пустым местом.
 */
export default function Avatar({
  name, src, size = 44, ring, className = '',
}: {
  name: string;
  src?: string;
  size?: number;
  /** Цвет обводки: костяк выделяется кольцом бренда. */
  ring?: 'brand' | 'none';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  // Один и тот же человек — всегда один цвет подложки.
  const hue = [...(name || '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const showPhoto = !!src && !failed;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black text-white ${
        ring === 'brand' ? 'ring-2 ring-brand ring-offset-2 ring-offset-[#0A0A0A]' : ''
      } ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: `hsl(${hue} 35% 28%)` }}
      aria-label={name}
    >
      <span aria-hidden>{letter}</span>
      {showPhoto && (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

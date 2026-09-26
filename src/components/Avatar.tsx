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

/**
 * Кто едет — стопкой кружков внахлёст, как в сторис и банковских сборах.
 * Больше пяти кружков на карточке уже не считываются глазом, поэтому
 * показываем максимум `max`: если людей больше, последний кружок — «+N».
 * Так всего кружков никогда не больше `max`, а число людей видно сразу.
 */
export function AvatarStack({
  people, total, max = 5, size = 26, className = '',
}: {
  people: { name: string; avatar?: string }[];
  /** Сколько людей всего (может быть больше, чем пришло в people). */
  total?: number;
  max?: number;
  size?: number;
  className?: string;
}) {
  const count = Math.max(total ?? 0, people.length);
  if (!count) return null;
  const overflow = count > max;
  const shown = people.slice(0, overflow ? max - 1 : max);
  const rest = count - shown.length;
  // Нахлёст ~30% диаметра: лица видны, стопка компактная.
  const overlap = Math.round(size * 0.3);
  return (
    <span className={`inline-flex items-center ${className}`} aria-label={`Едут: ${count}`}>
      {shown.map((p, i) => (
        <span key={i} className="inline-flex rounded-full ring-2 ring-[#121212]" style={{ marginLeft: i ? -overlap : 0, zIndex: max - i }}>
          <Avatar name={p.name} src={p.avatar} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-white/15 font-black text-white ring-2 ring-[#121212] backdrop-blur"
          style={{ width: size, height: size, marginLeft: shown.length ? -overlap : 0, fontSize: Math.max(9, Math.round(size * 0.36)) }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

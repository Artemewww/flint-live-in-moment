/**
 * Бан/разбан человека во ВСЕХ Telegram-группах событий.
 *
 * Зачем: «бан = полная изоляция» не выполнялось до конца — отмена регистраций и
 * снятие кнопки афиши не выкидывают человека из группы события, и он продолжал
 * читать переписку, локации и планы. В группу он мог попасть и без регистрации
 * (по пересланной инвайт-ссылке), поэтому проходим по ВСЕМ активным группам, а
 * не только по событиям, где он был записан.
 *
 * `banChatMember` и удаляет, и запрещает вернуться. Разбан — с `only_if_banned`,
 * чтобы не трогать тех, кого никто не банил.
 *
 * Требует, чтобы бот был админом группы с правом ограничивать участников. Если
 * права нет — Telegram отвечает ошибкой, и она ВОЗВРАЩАЕТСЯ наверх, а не
 * глушится: молчаливый провал здесь означает, что забаненный остался в чате, а
 * организатор думает, что человек изолирован.
 *
 * Живёт в `api/_lib/` (папка на «_» не считается serverless-функцией, лимит
 * Hobby 12) и импортируется и вебхуком, и админкой.
 */

export interface GroupBanResult {
  /** Сколько активных групп нашли. */
  groups: number;
  /** В скольких операция удалась. */
  kicked: number;
  /** Человекочитаемые причины отказов — их показываем организатору. */
  failed: string[];
}

export async function setGroupBan(
  supabase: any,
  botToken: string,
  telegramId: number,
  ban: boolean,
): Promise<GroupBanResult> {
  const out: GroupBanResult = { groups: 0, kicked: 0, failed: [] };
  // Отрицательный id — веб-заявка без Telegram, банить в группах нечего.
  if (!botToken || !Number.isFinite(telegramId) || telegramId <= 0) return out;

  let chats: number[] = [];
  try {
    const { data } = await supabase.from('event_groups').select('chat_id').eq('active', true);
    chats = Array.from(new Set((data || [])
      .map((g: any) => Number(g.chat_id))
      .filter((c: number) => Number.isFinite(c) && c !== 0)));
  } catch {
    return out; // таблицы может не быть — не ломаем блокировку
  }

  out.groups = chats.length;
  const method = ban ? 'banChatMember' : 'unbanChatMember';
  for (const chatId of chats) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          user_id: telegramId,
          ...(ban ? {} : { only_if_banned: true }),
        }),
      });
      const j = await r.json();
      if (j?.ok) out.kicked += 1;
      else out.failed.push(`${chatId}: ${j?.description || 'отказ Telegram'}`);
    } catch (e) {
      out.failed.push(`${chatId}: ${(e as Error).message}`);
    }
  }
  return out;
}

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
РЕЖИССЁР РОЛИКА — Gemini смотрит на кадры и пишет сценарий монтажа.

Без него монтаж выбирал «самое живое окно» по движению: ролик выходил
перемешанным (зал → бассейн → зал), прыжок резался до всплеска, а подписи
были общими. Режиссёр делает то, что делает монтажёр топ-блогера:
  • раскладывает клипы по главам истории (разминка → высота → прыжок…);
  • находит в каждом клипе пик — момент всплеска, прыжка, улыбки;
  • выбирает хук на первую секунду и героя для слоу-мо;
  • пишет короткие тексты по смыслу события голосом клуба.

Вход: список клипов (path, kind) + событие. Выход: dict (см. SCHEMA ниже)
или None — тогда montage.py монтирует по своей эвристике.
Зависимости: только stdlib + Pillow + ffmpeg. Ключ: GEMINI_API_KEY.
"""
import base64, io, json, os, subprocess, sys, urllib.error, urllib.request
from PIL import Image, ImageDraw

MODEL = os.environ.get('RECAP_DIRECTOR_MODEL', 'gemini-3.5-flash')
FR = 6           # кадров на клип в раскадровке
TW, TH = 160, 284

VOICE = (
    'Голос клуба «Живи в моменте» (FLINT): на «ты», коротко, энергично, по-человечески. '
    'Клуб находит возможности расти и дарит их своим; трезвая среда, живое общение. '
    'Опорные слова (не больше одного на текст, только к месту): врывайся, заряжайся, поток, '
    'синхрон, перезагрузка, заземляйся, стержень, масштаб, эволюция. '
    'Без канцелярита, без «уникальной возможности», без восклицательных знаков и эмодзи.'
)

SCHEMA = '''{
  "clips": [{"id": 0, "scene": "что в кадре, 3-6 слов", "peak": 3.9,
             "peak_kind": "splash|jump|action|smile|group|calm",
             "quality": 1-10, "chapter": 0}],
  "chapters": [{"title": "РАЗМИНКА", "clips": [ids в порядке показа]}],
  "hook": {"clip": id, "t": сек, "text": "1-2 слова-вопрос или вызов"},
  "hero": [{"clip": id, "t": сек}],
  "finale": {"text": "2-5 слов, смысл события", "sub": "до 40 символов"}
}'''


def _frames(path, kind, dur):
    """Раскадровка клипа одной полосой с метками времени."""
    if kind == 'photo':
        im = Image.open(path).convert('RGB'); im.thumbnail((TW * 2, TH * 2))
        return im, [0.0]
    ts = [round(dur * (k + 0.5) / FR, 2) for k in range(FR)]
    strip = Image.new('RGB', (TW * FR, TH), 'black'); d = ImageDraw.Draw(strip)
    for k, t in enumerate(ts):
        b = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.2f}', '-i', path, '-frames:v', '1',
                            '-vf', f'scale={TW}:{TH}:force_original_aspect_ratio=increase,crop={TW}:{TH}',
                            '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], capture_output=True).stdout
        if b:
            strip.paste(Image.open(io.BytesIO(b)).convert('RGB'), (k * TW, 0))
        d.rectangle((k * TW, 0, k * TW + 58, 20), fill='black')
        d.text((k * TW + 4, 4), f'{t:.1f}s', fill=(255, 255, 0))
    return strip, ts


def _b64(im):
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=72); return base64.b64encode(buf.getvalue()).decode()


def direct(items, event, timeout=120):
    key = os.environ.get('GEMINI_API_KEY', '')
    if not key or not items:
        return None
    parts = [{'text': (
        f'Ты — монтажёр вертикальных видеоотчётов уровня топ-блогеров (динамика, история, смысл). '
        f'Событие: «{event.get("title", "")}». {str(event.get("description") or "")[:700]}\n\n'
        f'Ниже {len(items)} клипов участников, у каждого — полоса кадров с метками времени (сек от начала клипа). '
        'Задача — сценарий 35–45-секундного ролика с историей: завязка → напряжение → кульминация → смысл.\n'
        '1) Для каждого клипа: что в кадре, пик (секунда самого сильного момента; у прыжка/броска — момент '
        'приземления или входа в воду, когда летят брызги; иначе улыбка в камеру, общий кадр) и качество 1–10 (резкость, свет, читаемость действия, '
        'дубли и скучные проходы — ниже).\n'
        '2) Главы: 2–4 главы в порядке того, как событие шло на самом деле; заголовок главы — 1–2 слова ЗАГЛАВНЫМИ, '
        'по смыслу этапа (не «ГЛАВА 1»), пиши с буквой ё. Нужно ~20 склеек, поэтому в главы клади ВСЕ годные клипы '
        '(обычно 70–90 % от всех, без явного брака и полных дублей), лучшие — в кульминацию.\n'
        '3) Хук: самый зрелищный момент для первой секунды ролика + 1–2 слова (до 12 букв), которые цепляют: '
        'вопрос или вызов зрителю. Хук — там, где человек КРУПНО в кадре и действие читается на телефоне.'
        ' Хук — Слова без двойного смысла: клуб трезвый, поэтому никаких «сорваться», «оторваться», «зажечь».\n'
        '4) Герои: 1–2 момента для замедления (лучше всего — вход в воду / отрыв).\n'
        '5) Финал: фраза о том, что человек унёс с события (смысл, а не «спасибо всем»), лучше перекличкой с описанием, '
        'не повторяя заголовки глав; '
        'подпись — конкретика события (без названия клуба и «живи в моменте»: они будут в концовке).\n'
        f'{VOICE}\n\nВерни ТОЛЬКО JSON по схеме:\n{SCHEMA}')}]
    for i, it in enumerate(items):
        im, _ = _frames(it['path'], it['kind'], it.get('dur') or 0)
        parts.append({'text': f'Клип {i} ({it["kind"]}, {it.get("dur", 0):.1f} с):'})
        parts.append({'inline_data': {'mime_type': 'image/jpeg', 'data': _b64(im)}})
    body = {'contents': [{'parts': parts}],
            'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0.4}}
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={key}'
    post = lambda b: json.load(urllib.request.urlopen(urllib.request.Request(
        url, data=json.dumps(b).encode(), headers={'Content-Type': 'application/json'}), timeout=timeout))
    try:
        try:  # короткое «размышление» — ответ за десятки секунд, а не минуты
            j = post({**body, 'generationConfig': {**body['generationConfig'], 'thinkingConfig': {'thinkingLevel': 'low'}}})
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
            j = post(body)
        txt = ''.join(p.get('text', '') for p in j['candidates'][0]['content']['parts'])
        plan = json.loads(txt)
    except Exception as e:  # нет сети/квоты — монтаж всё равно должен выйти
        print('[director] fail', e, file=sys.stderr)
        return None
    return _sanitize(plan, items)


def _sanitize(p, items):
    """ИИ может ошибиться в номерах и секундах — чиним, а не падаем."""
    n = len(items)
    ok = lambda i: isinstance(i, int) and 0 <= i < n
    dur = lambda i: items[i].get('dur') or 0
    clips = {}
    for c in p.get('clips') or []:
        i = c.get('id')
        if ok(i):
            c['peak'] = max(0.0, min(float(c.get('peak') or 0), max(0.0, dur(i) - 0.3)))
            c['quality'] = int(c.get('quality') or 5)
            clips[i] = c
    chapters = []
    used = set()
    for ch in p.get('chapters') or []:
        ids = [i for i in ch.get('clips') or [] if ok(i) and i not in used]
        used.update(ids)
        if ids:
            chapters.append({'title': str(ch.get('title') or '').upper()[:22], 'clips': ids})
    def moment(m):
        if isinstance(m, dict) and ok(m.get('clip')):
            return {'clip': m['clip'], 't': max(0.0, min(float(m.get('t') or 0), dur(m['clip']) - 0.3)),
                    'text': str(m.get('text') or '').upper()[:18]}
        return None
    fin = p.get('finale') or {}
    return {
        'clips': clips, 'chapters': chapters,
        'hook': moment(p.get('hook')),
        'hero': [h for h in (moment(x) for x in (p.get('hero') or [])) if h][:2],
        'finale': {'text': str(fin.get('text') or '').upper()[:40], 'sub': str(fin.get('sub') or '').upper()[:44]},
    }


if __name__ == '__main__':
    # Проверка руками: python3 director.py manifest.json → план в stdout
    m = json.load(open(sys.argv[1]))
    for it in m['items']:
        if it['kind'] == 'video' and 'dur' not in it:
            it['dur'] = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of',
                                              'csv=p=0', it['path']], capture_output=True, text=True).stdout or 0)
    print(json.dumps(direct(m['items'], {'title': m.get('title'), 'description': m.get('description')}),
                     ensure_ascii=False, indent=1))

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
МУЗЫКА ПОД СОБЫТИЕ — Lyria (Google) пишет инструментал под настроение.

Раньше в каждом ролике звучал один из трёх треков клуба с вокалом — чаще
всего гимн «Живи в моменте», который к прыжкам или форуму не подходит.
Теперь трек генерируется под событие: без слов, нужного темпа и со
структурой «напряжение → дроп → развязка», под которую режет монтаж.
Нет ключа или модель не ответила — montage.py берёт трек из библиотеки.

Ключ: GEMINI_API_KEY (тот же, что у режиссёра).
"""
import base64, json, os, sys, urllib.request

MODELS = [m for m in os.environ.get('RECAP_MUSIC_MODELS', 'lyria-3-pro-preview,lyria-3-clip-preview').split(',') if m]

MOODS = {
    'sport': 'energetic modern sport edit, punchy drums, deep bass, bright synth hook, adrenaline',
    'epic': 'cinematic uplifting, big drums, wide synths, sense of scale and ambition',
    'calm': 'warm chill organic house, soft percussion, mellow keys, cozy and grounded',
    'team': 'feel-good indie electronic, claps, warm guitar plucks, friendship and joy',
}


def prompt_for(mood, theme, bpm=124):
    style = MOODS.get(mood, MOODS['team'])
    return (
        f'Instrumental only, absolutely no vocals or lyrics. {bpm} BPM, steady 4/4 beat that is easy to cut video to. '
        f'Soundtrack for a 40-second vertical recap reel: {theme}. Style: {style}. '
        'Structure: 8 seconds of tense low intro with rising riser and filtered drums; then a big clear drop with a strong '
        'impact hit; full-energy groove; a short 4-second breakdown with a riser; second drop, even bigger; '
        'end on a clean final hit with a short tail. Premium mix, like a top travel/sport YouTube creator.')


def generate(mood, theme, out_path, bpm=124, timeout=240):
    key = os.environ.get('GEMINI_API_KEY', '')
    if not key:
        return None
    body = {'contents': [{'parts': [{'text': prompt_for(mood, theme, bpm)}]}]}
    for model in MODELS:
        try:
            req = urllib.request.Request(
                f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}',
                data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
            j = json.load(urllib.request.urlopen(req, timeout=timeout))
            for p in j['candidates'][0]['content']['parts']:
                d = p.get('inlineData') or p.get('inline_data')
                if d and str(d.get('mimeType') or d.get('mime_type') or '').startswith('audio/'):
                    mime = d.get('mimeType') or d.get('mime_type')
                    path = os.path.splitext(out_path)[0] + ('.wav' if 'wav' in mime else '.mp3')
                    open(path, 'wb').write(base64.b64decode(d['data']))
                    print('[music]', model, 'ok', path, file=sys.stderr)
                    return path
        except Exception as e:
            print('[music]', model, 'fail', e, file=sys.stderr)
    return None


if __name__ == '__main__':
    # python3 music.py sport "diving tower jumps in an indoor pool" out.mp3
    print(generate(sys.argv[1], sys.argv[2], sys.argv[3]))

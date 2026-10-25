#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
АВТОМОНТАЖ ИТОГОВ СОБЫТИЯ FLINT — вертикальный ролик 1080x1920 с историей.

Вход — манифест JSON (его собирает scripts/recap/orchestrate.mts):
{
  "title": "Прыжки с вышек", "dates": "24 октября 2026", "description": "…",
  "kicker": "FLINT · ВОДА", "mood": "sport", "music_theme": "diving tower jumps",
  "music": "public/assets/music/x.mp3" (необязательно — иначе Lyria),
  "finale": "…", "finale_sub": "…",
  "seed": 0, "items": [{"path": "/tmp/a.mp4", "kind": "video", "author": 123}],
  "out": "/tmp/recap.mp4"
}
Выход: out (mp4), out.jpg (обложка), out.json (сводка).

Драматургия (как у топовых видеоотчётов — хук, история, смысл, призыв):
  ХУК    2 с   самый зрелищный момент в слоу-мо + 1–2 слова («СТРАШНО?»)
  ТИТР   2 с   название поверх яркого кадра, без затемнения
  ГЛАВЫ        по сценарию режиссёра (director.py): у каждой своё слово;
               предпоследняя — медленнее (напряжение), последняя — на дроп
               трека, рубленая, с героем в слоу-мо
  СМЫСЛ  4 с   что человек унёс с события — по описанию события
  ФИНАЛ  4 с   знак клуба + «запись — в приложении» (без дат: ролик вечный)
Склейки — строго в доли трека; дроп музыки совпадает с началом кульминации.
Под музыкой живой звук клипов (всплеск, смех) — без него ролик «немой».

Зависимости: ffmpeg/ffprobe, Pillow. Без numpy — чтобы запускалось где угодно.
"""
import array, json, math, os, random, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageStat

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ASSETS = os.path.join(HERE, 'assets')
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
W, H, FPS = 1080, 1920, 30
LIME, BLACK, WHITE = (230, 253, 58), (10, 10, 10), (255, 255, 255)
# Безопасная зона Reels/Shorts: сверху шапка, снизу подпись и кнопки.
SAFE_TOP, SAFE_BOTTOM = 240, 1500


def log(*a):
    print('[montage]', *a, file=sys.stderr, flush=True)


def run(cmd, capture=False):
    r = subprocess.run(cmd, stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.PIPE)
    if r.returncode:
        raise RuntimeError(f"{cmd[0]} failed: {r.stderr.decode(errors='ignore')[-800:]}")
    return r.stdout


def probe(path):
    out = run(['ffprobe', '-v', 'error', '-show_entries',
               'stream=codec_type,width,height:stream_side_data=rotation:format=duration',
               '-of', 'json', path], capture=True)
    j = json.loads(out or b'{}')
    v = next((s for s in j.get('streams') or [] if s.get('codec_type') == 'video'), {})
    w, h = int(v.get('width') or 0), int(v.get('height') or 0)
    rot = 0
    for sd in v.get('side_data_list') or []:
        if 'rotation' in sd:
            rot = int(sd['rotation'])
    if abs(rot) == 90:
        w, h = h, w
    has_a = any(s.get('codec_type') == 'audio' for s in j.get('streams') or [])
    return w, h, float((j.get('format') or {}).get('duration') or 0), has_a


# ── анализ кадров (запасной путь без ИИ + уточнение пика) ──────────────────

SW, SH = 72, 128


def frames_of(path, fps=4, t0=0.0, t=120):
    raw = run(['ffmpeg', '-v', 'error', '-ss', f'{t0:.2f}', '-t', f'{t:.2f}', '-i', path, '-vf',
               f'fps={fps},scale={SW}:{SH}:force_original_aspect_ratio=increase,crop={SW}:{SH},format=gray',
               '-f', 'rawvideo', '-'], capture=True)
    n = len(raw) // (SW * SH)
    return [Image.frombytes('L', (SW, SH), raw[i * SW * SH:(i + 1) * SW * SH]) for i in range(n)]


def sharpness(im):
    return ImageStat.Stat(im.filter(ImageFilter.FIND_EDGES)).var[0] ** 0.5


def ahash(im):
    s = im.resize((8, 8), Image.BILINEAR)
    px = list(s.tobytes()); m = sum(px) / 64
    return sum(1 << i for i, p in enumerate(px) if p > m)


def analyze(it):
    """Пик клипа без ИИ: окно с живым движением, резкостью и нормальным светом."""
    if it['kind'] == 'photo':
        im = Image.open(it['path']).convert('L'); im.thumbnail((SW * 2, SH * 2))
        L = ImageStat.Stat(im).mean[0]
        it.update(peak=0.0, quality=round(10 * (0.6 * min(sharpness(im), 50) / 50 + 0.4 * (1 - min(1, abs(L - 115) / 115)))),
                  peak_kind='group', hash=ahash(im), motion=0.0)
        return
    fr = frames_of(it['path'])
    if len(fr) < 3:
        it.update(peak=0.0, quality=0, peak_kind='calm', hash=0, motion=0.0); return
    mot = [0.0] + [ImageStat.Stat(ImageChops.difference(fr[i], fr[i - 1])).mean[0] for i in range(1, len(fr))]
    sh = [sharpness(f) for f in fr]
    lu = [ImageStat.Stat(f).mean[0] for f in fr]
    best, bi = -1, 0
    for i in range(1, len(fr) - 1):
        s = 0.45 * (min(mot[i], 14) / 14 - max(0, mot[i] - 28) / 28) + 0.35 * min(sh[i], 40) / 40 \
            + 0.2 * (1 - min(1, abs(lu[i] - 115) / 115))
        if s > best:
            best, bi = s, i
    it.update(peak=bi * 0.25, quality=max(1, round(best * 10)), peak_kind='action' if mot[bi] > 8 else 'calm',
              hash=ahash(fr[bi]), motion=sum(mot) / len(mot))


def refine_peak(it, t):
    """ИИ видит 6 кадров на клип — пик у него «примерно». Уточняем по
    движению в окне ±0.8 с: всплеск и отрыв — это всплеск разницы кадров."""
    if it['kind'] != 'video':
        return t
    t0 = max(0.0, t - 0.8)
    fr = frames_of(it['path'], fps=10, t0=t0, t=1.6)
    if len(fr) < 4:
        return t
    mot = [ImageStat.Stat(ImageChops.difference(fr[i], fr[i - 1])).mean[0] for i in range(1, len(fr))]
    i = max(range(len(mot)), key=lambda k: mot[k])
    return t0 + (i + 1) / 10


# ── музыка: сетка долей и дроп ─────────────────────────────────────────────

def music_map(path):
    """Темп, фаза долей и дропы трека. Огибающая → автокорреляция → фаза;
    дроп — доля, после которой энергия резко выше, чем до неё.
    Рядом с треком может лежать <имя>.json с точной сеткой (bpm, beat0,
    drops) — у синтезированных треков она известна и не угадывается."""
    side = os.path.splitext(path)[0] + '.json'
    if os.path.exists(side):
        j = json.load(open(side))
        dur = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                        capture=True) or 0)
        P = 60 / float(j['bpm'])
        return {'beat': P, 'beat0': float(j.get('beat0', 0)), 'n': int((dur - j.get('beat0', 0)) / P),
                'drops': j.get('drops', []), 'start': 0, 'dur': dur, 'bpm': float(j['bpm'])}
    raw = run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture=True)
    a = array.array('h'); a.frombytes(raw)
    hop = 80; fps = 8000 / hop  # 100 точек в секунду
    env = []
    for i in range(0, len(a) - hop, hop):
        seg = a[i:i + hop:2]
        env.append(math.sqrt(sum(x * x for x in seg) / len(seg) + 1))
    # Онсеты — по низам (бочка): хэты на слабую долю иначе сдвигают фазу на полдоли.
    rl = run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-af', 'lowpass=f=160,lowpass=f=160', '-ar', '8000',
              '-f', 's16le', '-'], capture=True)
    lo = array.array('h'); lo.frombytes(rl)
    envl = [math.sqrt(sum(x * x for x in lo[i:i + hop:2]) / (hop // 2) + 1) for i in range(0, len(lo) - hop, hop)]
    on = [0.0] + [max(0.0, envl[i] - envl[i - 1]) for i in range(1, len(envl))]
    best = (120.0, -1.0)
    for bpm10 in range(900, 1600, 2):
        lag = 60 / (bpm10 / 10) * fps
        li = int(lag); fr = lag - li
        s = sum(on[i] * (on[i + li] * (1 - fr) + on[i + li + 1] * fr) for i in range(0, len(on) - li - 2, 2))
        s *= 1.0 + 0.15 * (110 <= bpm10 / 10 <= 135)  # монтажный темп — вероятнее
        if s > best[1]:
            best = (bpm10 / 10, s)
    # Уточнение темпа до сотых: ошибка в 1 BPM за 50 секунд уводит склейки
    # с доли на полкадра-кадр — глаз это видит как «мимо бита».
    def fit(bpm):
        per = 60 / bpm * fps
        nb = int((len(on) - 1) / per)
        return max(((sum(on[min(len(on) - 1, int(o + k * per))] for k in range(nb)), o)
                    for o in (x / 2 for x in range(int(per * 2)))))
    cand = [best[0] + d / 20 for d in range(-30, 31)]
    score, bpm = max((fit(c)[0], c) for c in cand)
    best = (round(bpm, 2), score)
    P = 60 / best[0]
    per = P * fps
    nb = int((len(on) - 1) / per)
    phase = fit(best[0])[1]
    beat0 = phase / fps
    # энергия по долям
    e = []
    for k in range(nb):
        i0, i1 = int(phase + k * per), int(phase + (k + 1) * per)
        e.append(sum(env[i0:i1]) / max(1, i1 - i0))
    med = sorted(e)[len(e) // 2] if e else 1
    drops = []
    for k in range(8, len(e) - 8):
        before, after = sum(e[k - 8:k]) / 8, sum(e[k:k + 8]) / 8
        if after > 1.35 * before and after > 0.9 * med:
            if not drops or k - drops[-1][0] > 16:
                drops.append((k, after / before))
            elif after / before > drops[-1][1]:
                drops[-1] = (k, after / before)
    start = next((k for k, x in enumerate(e) if x > 0.35 * med), 0)
    return {'beat': P, 'beat0': beat0, 'n': nb, 'drops': [k for k, _ in drops], 'start': start,
            'dur': len(a) / 8000, 'bpm': best[0]}


def pick_library_track(mood):
    """Запасной трек из public/assets/music. Гимн клуба в авто-выбор не идёт."""
    d = os.path.join(ROOT, 'public/assets/music')
    try:
        files = sorted(f for f in os.listdir(d) if f.lower().endswith(('.mp3', '.wav')))
    except OSError:
        return None
    files = [f for f in files if not f.startswith('zhivi-v-momente')] or files
    fit = [f for f in files if f.startswith(mood + '__')]
    return os.path.join(d, (fit or files)[0]) if files else None


# ── режиссура: сценарий из ИИ или эвристики ───────────────────────────────

def heuristic_plan(items, m):
    vids = sorted(range(len(items)), key=lambda i: -items[i]['quality'])
    best = vids[0] if vids else 0
    ids = [i for i in range(len(items)) if items[i]['quality'] >= 3]
    return {'chapters': [{'title': '', 'clips': ids}],
            'hook': {'clip': best, 't': items[best]['peak'], 'text': ''},
            'hero': [{'clip': best, 't': items[best]['peak']}] if items[best]['kind'] == 'video' else [],
            'finale': {'text': '', 'sub': ''}, 'clips': {}}


def make_plan(items, m):
    plan = m.get('plan')
    if not plan and not m.get('no_ai'):
        try:
            import director
            plan = director.direct(items, {'title': m.get('title'), 'description': m.get('description')})
        except Exception as e:
            log('director error', e)
    if not plan or not plan.get('chapters'):
        log('plan: heuristic')
        return heuristic_plan(items, m)
    for k, c in (plan.get('clips') or {}).items():
        i = int(k)
        items[i]['peak'] = float(c.get('peak', items[i]['peak']))
        items[i]['quality'] = int(c.get('quality', items[i]['quality']))
        items[i]['peak_kind'] = c.get('peak_kind') or items[i]['peak_kind']
        items[i]['scene'] = c.get('scene', '')
    log('plan: director', [(c['title'], c['clips']) for c in plan['chapters']])
    return plan


# ── рендер сегментов ───────────────────────────────────────────────────────

GRADE = 'eq=contrast=1.06:saturation=1.08:brightness=0.01,vibrance=intensity=0.12,unsharp=5:5:0.45'


def push_in(nf, amount):
    z = f"(1-{amount}*n/{nf})"
    return f"crop=w='trunc(iw*{z}/2)*2':h='trunc(ih*{z}/2)*2':x='(iw-ow)/2':y='(ih-oh)/2'"


def render_clip(it, ss, nf, out, speed=1.0, zoom=0.05, vol=1.0):
    """Сегмент ровно nf кадров со звуком той же длины."""
    dur = nf / FPS
    src = dur * speed
    fill = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}"
    tail = f"{push_in(nf, zoom)},scale={W}:{H}:flags=lanczos,{GRADE},scale=out_range=tv,format=yuv420p,setsar=1"
    landscape = it.get('w', 0) > it.get('h', 1) * 1.15
    if it['kind'] == 'photo':
        base = (f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},split[a][b];"
                f"[a]gblur=sigma=40[bg];[b]scale={W - 120}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2") if landscape else fill
        vf = f"{base},fps={FPS},{tail}"
        inp = ['-loop', '1', '-framerate', str(FPS), '-t', f'{dur + 0.5:.2f}', '-i', it['path']]
        af = f"anullsrc=r=48000:cl=stereo,atrim=0:{dur:.3f}"
        args = ['ffmpeg', '-y', '-v', 'error', *inp, '-f', 'lavfi', '-i', af, '-filter_complex', f'[0:v]{vf}[v]',
                '-map', '[v]', '-map', '1:a']
    else:
        if speed < 0.99:  # слоу-мо: дорисовываем промежуточные кадры, а не дублируем
            motion = f"minterpolate=fps={round(FPS / speed)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,setpts=PTS/{speed},fps={FPS}"
        else:
            motion = f"fps={FPS}"
        if landscape:
            vf = (f"[0:v]{motion},split[a][b];[a]{fill},gblur=sigma=30[bg];[b]scale={W - 80}:-2[fg];"
                  f"[bg][fg]overlay=(W-w)/2:(H-h)/2,{tail}[v]")
        else:
            vf = f"[0:v]{motion},{fill},{tail}[v]"
        atempo = f"atempo={max(0.5, speed):.3f}," if speed < 0.99 else ''
        if it.get('has_audio'):
            af = (f"[0:a]{atempo}aresample=48000,aformat=channel_layouts=stereo,volume={vol},"
                  f"afade=t=in:d=0.03,afade=t=out:st={max(0, dur - 0.05):.3f}:d=0.05,apad,atrim=0:{dur:.3f}[a]")
            src_a = []
        else:
            af = f"[1:a]atrim=0:{dur:.3f}[a]"
            src_a = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
        args = ['ffmpeg', '-y', '-v', 'error', '-ss', f'{ss:.3f}', '-t', f'{src + 0.4:.3f}', '-i', it['path'], *src_a,
                '-filter_complex', vf + ';' + af, '-map', '[v]', '-map', '[a]']
    run(args + ['-frames:v', str(nf), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-r', str(FPS),
                '-c:a', 'pcm_s16le', '-ar', '48000', '-shortest' if it['kind'] == 'photo' else '-y', out.replace('.mp4', '.mov')])
    return out.replace('.mp4', '.mov')


def render_black(nf, out):
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', f'color=c=0x0a0a0a:s={W}x{H}:r={FPS}',
         '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-frames:v', str(nf), '-t', f'{nf / FPS:.3f}',
         '-vf', 'format=yuv420p,setsar=1', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15',
         '-c:a', 'pcm_s16le', out])
    return out


# ── графика ────────────────────────────────────────────────────────────────

def F(name, size):
    return ImageFont.truetype(os.path.join(ASSETS, 'fonts', name), size)


HEAVY = lambda s: F('SONGER_C_Heavy.otf', s)
GUNT = lambda s: F('Gunterz-Medium.otf', s)


def clamp(x): return max(0.0, min(1.0, x))
def prog(f, a, b): return clamp((f - a) / max(1, b - a))
def out_cubic(t): return 1 - (1 - t) ** 3
def out_back(t, s=1.7): t -= 1; return t * t * ((s + 1) * t + s) + 1
def in_cubic(t): return t ** 3


def alpha(im, a):
    if a >= 0.999: return im
    im = im.copy(); im.putalpha(im.getchannel('A').point(lambda v: int(v * a))); return im


def text_img(txt, fnt, fill, spacing=0):
    if spacing:
        ws = [(fnt.getbbox(c)[2] - fnt.getbbox(c)[0]) if c != ' ' else fnt.size * 0.3 for c in txt]
        w = int(sum(ws) + spacing * (len(txt) - 1)) + 8
    else:
        w = int(fnt.getlength(txt)) + 8
    asc, desc = fnt.getmetrics()
    im = Image.new('RGBA', (max(1, w), asc + desc + 8), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if spacing:
        x = 0
        for c, cw in zip(txt, ws):
            d.text((x - (fnt.getbbox(c)[0] if c != ' ' else 0), 4), c, font=fnt, fill=fill); x += cw + spacing
    else:
        d.text((0, 4), txt, font=fnt, fill=fill)
    bb = im.getbbox()
    return im.crop((0, bb[1] - 2, im.width, bb[3] + 2)) if bb else im


def shadowed(im, r=12, a=0.6):
    """Мягкая тень только под буквами: текст читается на любом кадре, а сам
    кадр не затемняем (раньше на весь ролик лежали виньетка и градиент)."""
    pad = r * 2
    base = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 255)); sh.putalpha(im.getchannel('A').point(lambda v: int(v * a)))
    base.alpha_composite(sh, (pad, pad + 3)); base = base.filter(ImageFilter.GaussianBlur(r))
    base.alpha_composite(im, (pad, pad)); return base


def lines_fit(text, font_fn, max_w, sizes, max_lines=2):
    words = str(text or '').upper().split()
    for size in sizes:
        f = font_fn(size)
        lines, cur = [], ''
        for w in words:
            t = (cur + ' ' + w).strip()
            if f.getlength(t) <= max_w:
                cur = t
            else:
                if cur: lines.append(cur)
                cur = w
        if cur: lines.append(cur)
        # висячий предлог («ПРЫЖКИ С / ВЫШЕК») переносим к своему слову
        for k in range(len(lines) - 1):
            ws = lines[k].split()
            if len(ws) > 1 and len(ws[-1]) <= 2:
                lines[k], lines[k + 1] = ' '.join(ws[:-1]), ws[-1] + ' ' + lines[k + 1]
        if len(lines) <= max_lines and all(f.getlength(l) <= max_w for l in lines):
            return lines, f
    return [' '.join(words)], font_fn(sizes[-1])


def block(text, font_fn, sizes, fill, max_w=940, max_lines=2, gap=22, align='c', r=14):
    """Многострочный блок текста одной картинкой."""
    lines, f = lines_fit(text, font_fn, max_w, sizes, max_lines)
    ims = [text_img(l, f, fill) for l in lines if l]
    if not ims:
        return None
    w = max(i.width for i in ims); h = sum(i.height for i in ims) + gap * (len(ims) - 1)
    out = Image.new('RGBA', (w, max(1, h)), (0, 0, 0, 0)); y = 0
    for i in ims:
        out.alpha_composite(i, ((w - i.width) // 2 if align == 'c' else 0, y)); y += i.height + gap
    if out.width > max_w:
        out = out.resize((max_w, round(out.height * max_w / out.width)), Image.LANCZOS)
    return shadowed(out, r)


def small(text, size=34, fill=WHITE, spacing=4, max_w=940):
    txt = str(text or '').upper()
    while size > 18:
        im = text_img(txt, GUNT(size), fill, spacing)
        if im.width <= max_w: break
        size -= 2
    return shadowed(im, 8, 0.7)


def pill(label, max_w=940):
    size = 34
    tl = text_img(label.upper(), GUNT(size), BLACK, 3)
    while tl.width + 88 > max_w and size > 20:
        size -= 2; tl = text_img(label.upper(), GUNT(size), BLACK, 2)
    h = 84; w = tl.width + 88
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=LIME + (255,))
    im.alpha_composite(tl, (44, (h - tl.height) // 2)); return im


class Graphics:
    def __init__(self, m, plan, marks, total):
        self.mk, self.total = marks, total
        self.stack = Image.open(os.path.join(ASSETS, 'stack.png'))
        hz = Image.open(os.path.join(ASSETS, 'horiz.png'))
        self.wm = alpha(hz.resize((150, round(150 * hz.height / hz.width)), Image.LANCZOS), 0.9)
        hook = (plan.get('hook') or {}).get('text') or m.get('hook') or ''
        self.hook = block(hook, HEAVY, [230, 200, 170, 150, 130], LIME, max_lines=2, r=18) if hook else None
        title = str(m.get('title') or 'FLINT').split(':')[0].strip()
        self.title = block(title, HEAVY, [190, 170, 150, 130, 112, 96], LIME, max_lines=2)
        self.kicker = small(m.get('kicker') or 'FLINT', 34, WHITE, 6)
        self.dates = small(m.get('dates'), 32, WHITE, 4) if m.get('dates') else None
        chs = plan['chapters']
        self.chap = []
        for i, ch in enumerate(chs):
            t = ch.get('title') or ''
            if not t:
                self.chap.append(None); continue
            num = small(f'{i + 1:02d} / {len(chs):02d}', 30, LIME, 5)
            self.chap.append((num, block(t, HEAVY, [150, 130, 112, 96], WHITE, max_w=900, max_lines=1, align='l')))
        fin = plan.get('finale') or {}
        self.fin = block(m.get('finale') or fin.get('text') or m.get('finale_fallback') or 'В МОМЕНТЕ', HEAVY, [140, 120, 104, 92, 80], LIME, max_lines=3)
        sub = m.get('finale_sub') or fin.get('sub') or m.get('finale_sub_fallback') or ''
        self.fin_sub = small(sub, 34, WHITE, 3) if sub else None
        self.stats = small(m['stats_line'], 30, WHITE, 3) if m.get('stats_line') else None
        self.tag = small('ЖИВИ В МОМЕНТЕ', 50, WHITE, 6)
        self.next = pill(f"ДАЛЬШЕ: {m['next']}") if m.get('next') else None
        self.cta = small(m.get('cta') or 'ЗАПИСЬ — В ПРИЛОЖЕНИИ FLINT', 28, (200, 200, 200), 2)

    def put(self, fr, im, x, y, a=1.0, scale=1.0, anchor='c'):
        if im is None or a <= 0.003: return
        if abs(scale - 1) > 0.003:
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        if anchor == 'c': x -= im.width / 2
        fr.alpha_composite(alpha(im, a), (round(x), round(y - im.height / 2)))

    def wipe(self, fr, im, x, y, t, anchor='c', out_t=0.0):
        """Текст выезжает снизу из-под невидимой маски — ровно на долю трека."""
        if im is None or t <= 0: return
        if anchor == 'c': x -= im.width / 2
        vis = max(1, round(im.height * out_cubic(t)))
        crop = im.crop((0, 0, im.width, vis))
        if out_t > 0:
            crop = alpha(crop, 1 - out_t)
        fr.alpha_composite(crop, (round(x), round(y - im.height / 2 + im.height - vis - out_t * 40)))

    def frame(self, f):
        fr = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        mk = self.mk
        if f < mk['title']:  # хук
            if self.hook and f >= mk['hook_hit']:
                t = prog(f, mk['hook_hit'], mk['hook_hit'] + 6)
                self.put(fr, self.hook, W / 2, 900, clamp(t * 2), 1.25 - 0.25 * out_back(t))
            return fr
        if f < mk['body']:  # титр
            a, b = mk['title'], mk['body']
            o = prog(f, b - 6, b)
            self.wipe(fr, self.kicker, W / 2, 1110, prog(f, a + 2, a + 10), out_t=o)
            self.wipe(fr, self.title, W / 2, 1110 + 30 + self.title.height / 2, prog(f, a + 4, a + 14), out_t=o)
            if self.dates:
                self.wipe(fr, self.dates, W / 2, 1110 + 70 + self.title.height, prog(f, a + 10, a + 20), out_t=o)
            fr.alpha_composite(alpha(self.wm, prog(f, a, a + 8)), (64, SAFE_TOP - 90))
            return fr
        if f < mk['finale']:
            fr.alpha_composite(self.wm, (64, SAFE_TOP - 90))
            for (a, b), ch in zip(mk['chapters'], self.chap):
                if ch and a <= f < b:
                    num, word = ch
                    o = prog(f, b - 6, b)
                    self.wipe(fr, num, 70, 1250, prog(f, a + 1, a + 8), anchor='l', out_t=o)
                    self.wipe(fr, word, 52, 1250 + 20 + word.height / 2, prog(f, a + 2, a + 12), anchor='l', out_t=o)
            return fr
        if f < mk['outro']:  # смысл
            a = mk['finale']
            self.wipe(fr, self.fin, W / 2, 1180, prog(f, a + 3, a + 16))
            y = 1180 + self.fin.height / 2 + 40
            if self.fin_sub:
                self.wipe(fr, self.fin_sub, W / 2, y, prog(f, a + 12, a + 24)); y += 60
            if self.stats:
                self.wipe(fr, self.stats, W / 2, y, prog(f, a + 18, a + 30))
            fr.alpha_composite(self.wm, (64, SAFE_TOP - 90))
            return fr
        a = mk['outro']  # знак клуба на чёрном
        t = prog(f, a + 1, a + 14)
        self.put(fr, self.stack, W / 2, 760, clamp(t * 2.5), 0.8 + 0.2 * out_back(t, 1.4))
        self.put(fr, self.tag, W / 2, 1090, prog(f, a + 10, a + 20))
        if self.next:
            self.put(fr, self.next, W / 2, 1210, prog(f, a + 16, a + 26), 0.9 + 0.1 * out_back(prog(f, a + 16, a + 26)))
        self.put(fr, self.cta, W / 2, 1310 if self.next else 1180, prog(f, a + 22, a + 32) * 0.9)
        if f > self.total - 10:
            fr.alpha_composite(Image.new('RGBA', (W, H), (10, 10, 10, int(255 * prog(f, self.total - 10, self.total - 1)))))
        return fr


# ── сборка ─────────────────────────────────────────────────────────────────

def main(manifest_path):
    m = json.load(open(manifest_path))
    seed = int(m.get('seed') or 0)
    rnd = random.Random(seed)
    out = m['out']
    work = tempfile.mkdtemp(prefix='recap_')

    items = [dict(it) for it in m['items'] if os.path.exists(it['path'])]
    for it in items:
        w, h, d, a = probe(it['path']) if it['kind'] == 'video' else (*Image.open(it['path']).size, 0.0, False)
        it.update(w=w, h=h, dur=d, has_audio=a)
    items = [it for it in items if it['kind'] == 'photo' or it['dur'] >= 0.9]
    with ThreadPoolExecutor(max_workers=max(2, os.cpu_count() or 2)) as ex:
        list(ex.map(lambda it: (analyze(it) if True else None), items))
    if len(items) < 4:
        raise SystemExit('too_little_media')

    plan = make_plan(items, m)
    # дубли (одинаковые кадры от двух людей) — выкидываем худший
    seen = []
    for ch in plan['chapters']:
        keep = []
        for i in ch['clips']:
            hsh = items[i].get('hash', 0)
            if any(bin(hsh ^ s).count('1') <= 6 for s in seen) and items[i]['kind'] == 'photo':
                continue
            seen.append(hsh); keep.append(i)
        ch['clips'] = keep
    plan['chapters'] = [c for c in plan['chapters'] if c['clips']]

    # Музыка: трек из манифеста → Lyria → свой инструментал, написанный ПОД
    # раскладку ролика (synth_track). Песни клуба с вокалом в авто-выбор не идут.
    mood = m.get('mood') or 'sport'
    music = m.get('music') if m.get('music') and os.path.exists(m.get('music')) else None
    if not music and not m.get('no_ai'):
        import music as gen
        music = gen.generate(mood, m.get('music_theme') or m.get('title') or 'friends event', os.path.join(work, 'music.mp3'))
    synth = not music and not m.get('library_music')
    if synth:
        bpm = {'sport': 124, 'epic': 120, 'team': 118, 'calm': 104}.get(mood, 120)
        mm = None
        B = 60 / bpm
    else:
        music = music or pick_library_track(mood)
        mm = music_map(music)
        B = mm['beat']
        log('music', os.path.basename(music), f"{mm['bpm']} bpm", 'drops', mm['drops'])

    # ── раскладка по долям ──
    target = int(m.get('target_beats') or round(40 / B))  # ≈ 40 секунд
    # хук ≈ 2.4 с: в слоу-мо помещаются полёт и вход в воду
    HOOK, TITLE, FIN, OUT = max(4, 2 * math.ceil(2.4 / B / 2)), 4, 8, 8
    body_beats = max(24, target - HOOK - TITLE - FIN - OUT)
    chs = plan['chapters']
    nch = len(chs)
    heroes = [h for h in plan.get('hero') or [] if items[h['clip']]['kind'] == 'video'][:1]
    # титр — на широком ярком кадре первой главы; из самой главы его убираем,
    # чтобы тот же план не шёл два раза подряд
    first = chs[0]['clips']
    title_i = max(first, key=lambda i: items[i]['quality'] + (2 if items[i].get('peak_kind') == 'group' else 0))
    if len(first) >= 3:
        first.remove(title_i)
    # кадр «смысла» — улыбки/общий план; из глав его убираем, чтобы не повторялся
    smiles = [i for i in range(len(items)) if items[i].get('peak_kind') in ('smile', 'group') and i != title_i]
    fin_i = max(smiles or [i for i in range(len(items)) if i != title_i], key=lambda i: items[i]['quality'] + (3 if items[i].get('peak_kind') == 'smile' else 0))
    for ch in chs:
        if fin_i in ch['clips']:
            ch['clips'].remove(fin_i)
    chs = plan['chapters'] = [c for c in chs if c['clips']]
    nch = len(chs)
    # Кульминация — глава, где больше всего экшна (прыжки, всплески), а не
    # просто последняя: режиссёр может поставить после неё эпилог. ИИ иногда
    # путается (героя берёт из разминки, хук — из улыбки), поэтому героя и хук
    # проверяем: они должны быть экшном из кульминации.
    ACT = ('jump', 'splash', 'action')
    cx = max(range(nch), key=lambda ci: (sum(items[i].get('peak_kind') in ('jump', 'splash') for i in chs[ci]['clips']),
                                          len(chs[ci]['clips'])))
    act = sorted([i for i in chs[cx]['clips'] if items[i]['kind'] == 'video' and items[i].get('peak_kind') in ACT],
                 key=lambda i: -items[i]['quality'])
    heroes = [h for h in heroes if h['clip'] in chs[cx]['clips']] or \
             ([{'clip': act[0], 't': items[act[0]]['peak']}] if act else [])
    hk = plan.get('hook') or {}
    if not hk or items[hk['clip']]['kind'] != 'video' or items[hk['clip']].get('peak_kind') not in ACT:
        alt = [i for i in act if not heroes or i != heroes[0]['clip']] or act
        if alt:
            plan['hook'] = {'clip': alt[0], 't': items[alt[0]]['peak'], 'text': hk.get('text', '')}
    tense_ch = cx - 1 if (cx >= 1 and nch >= 3) else None
    share = [0.9 if ci > cx else 1.0 for ci in range(nch)]
    if nch >= 2:
        share[cx] = 0.45 / 0.55 * sum(x for ci, x in enumerate(share) if ci != cx)
    tot = sum(share)
    budget = [max(4, round(body_beats * s / tot / 2) * 2) for s in share]
    for ci in range(cx + 1, nch):
        budget[ci] = min(budget[ci], 8)
    segs = []  # (kind, item, ss, beats, speed, chapter)
    for ci, ch in enumerate(chs):
        climax = ci == cx and nch >= 2
        per = 4 if (ci == tense_ch or ci > cx) else 2
        b = budget[ci]
        ids = sorted(ch['clips'], key=lambda i: -items[i]['quality'])
        hero = heroes[0] if (climax and heroes) else None
        if hero:
            b -= 6
        n = max(1, min(len(ids), b // per))
        chosen = [i for i in ch['clips'] if i in ids[:n]]  # порядок главы — от режиссёра
        rest = b - n * per
        for k, i in enumerate(chosen):
            beats = per + (2 if rest >= 2 and k == 0 else 0)
            if beats > per: rest -= 2
            segs.append(['clip', i, None, beats, 1.0, ci])
        if hero:  # герой в слоу-мо — в середину кульминации
            pos = len(segs) - len(chosen) + max(1, len(chosen) // 2)
            segs.insert(pos, ['clip', hero['clip'], hero['t'], 6, 0.5, ci])
    # Музыкальные части — целыми тактами: «до напряжения», «напряжение»,
    # «кульминация и дальше». Иначе дроп придётся на середину такта.
    groups = [lambda c: c < (tense_ch if tense_ch is not None else cx), lambda c: c == tense_ch, lambda c: c >= cx]
    for gi, g in enumerate(groups):
        part = [s for s in segs if g(s[5])]
        extra = (TITLE if gi == 0 else 0) + (FIN if gi == 2 else 0)
        if part and (sum(s[3] for s in part) + extra) % 4:
            part[0][3] += 2
    pre_b = TITLE + sum(s[3] for s in segs if groups[0](s[5]))
    tense_b = sum(s[3] for s in segs if groups[1](s[5]))
    post_b = sum(s[3] for s in segs if groups[2](s[5])) + FIN

    plan_beats = [HOOK, TITLE] + [s[3] for s in segs] + [FIN, OUT]
    total_b = sum(plan_beats)
    climax_beat = HOOK + pre_b + tense_b
    if synth:
        import synth_track
        intro_bars = -(-HOOK // 4)
        bars = (intro_bars, pre_b // 4, tense_b // 4, post_b // 4)
        music = synth_track.render(os.path.join(work, f'{mood}__score.mp3'), bpm, m.get('key') or 'A', bars,
                                   seed=seed * 31 + len(items))
        mm = music_map(music)
        off = (intro_bars * 4 - HOOK) * B
        log('music: score', bars, f'{bpm} bpm')
    else:
        # дроп трека — на первую склейку кульминации; иначе дроп — на титр
        k0 = mm['start']
        for d in mm['drops']:
            if d - climax_beat >= 0:
                k0 = d - climax_beat; break
        else:
            if mm['drops'] and mm['drops'][0] - HOOK >= 0:
                k0 = mm['drops'][0] - HOOK
        if mm['beat0'] + (k0 + total_b) * B > mm['dur'] - 0.5:  # трек короче ролика — начинаем раньше
            k0 = max(0, int((mm['dur'] - 0.5 - mm['beat0']) / B) - total_b)
        off = mm['beat0'] + k0 * B
    tl, acc = [], 0
    for nb in plan_beats:
        tl.append((round(acc * B * FPS), round((acc + nb) * B * FPS))); acc += nb
    total = tl[-1][1]
    log('beats', total_b, 'frames', total, 'music off', round(off, 2), 'climax beat', climax_beat)

    # ── рендер ──
    def window(i, L, center=None):
        it = items[i]
        if it['kind'] == 'photo':
            return 0.0
        p = refine_peak(it, center if center is not None else it['peak'])
        lead = 0.5 if it.get('peak_kind') in ('calm', 'group', 'smile') else 0.62
        return max(0.05, min(p - lead * L, it['dur'] - L - 0.05))

    files = []
    hook = plan.get('hook') or {'clip': heroes[0]['clip'] if heroes else 0, 't': 0}
    hook_i = hook['clip'] if items[hook['clip']]['kind'] == 'video' else (heroes[0]['clip'] if heroes else hook['clip'])
    nf = tl[0][1] - tl[0][0]
    hp = refine_peak(items[hook_i], float(hook.get('t') or items[hook_i]['peak']))
    # хук: 1 с до пика в реальном времени ускоряется в слоу-мо на ударе
    ss = max(0.05, min(hp - 0.75 * nf / FPS * 0.5, items[hook_i]['dur'] - nf / FPS * 0.5 - 0.05))
    files.append(render_clip(items[hook_i], ss, nf, os.path.join(work, 'hook.mp4'), speed=0.5, zoom=0.08, vol=1.0))
    hook_hit = round((hp - ss) / 0.5 * FPS)
    # титр — на широком ярком кадре (общий план из первой главы)
    nf = tl[1][1] - tl[1][0]
    files.append(render_clip(items[title_i], window(title_i, nf / FPS), nf, os.path.join(work, 'title.mp4'), zoom=0.04, vol=0.5))
    for k, (kind, i, center, beats, speed, ci) in enumerate(segs):
        f0, f1 = tl[2 + k]
        nf = f1 - f0
        L = nf / FPS * speed
        ss = window(i, L, center)
        files.append(render_clip(items[i], ss, nf, os.path.join(work, f's{k:03d}.mp4'), speed=speed,
                                 zoom=0.03 if speed < 1 else 0.06, vol=0.9 if speed < 1 else 0.7))
    # смысл — человеческий кадр (выбран выше)
    nf = tl[-2][1] - tl[-2][0]
    files.append(render_clip(items[fin_i], window(fin_i, nf / FPS), nf, os.path.join(work, 'fin.mp4'), zoom=0.05, vol=0.6))
    files.append(render_black(tl[-1][1] - tl[-1][0], os.path.join(work, 'outro.mp4')))

    # ── графика ──
    marks = {'hook_hit': min(hook_hit, tl[0][1] - 8), 'title': tl[1][0], 'body': tl[2][0],
             'finale': tl[-2][0], 'outro': tl[-1][0], 'chapters': []}
    for ci in range(nch):
        ks = [k for k, s in enumerate(segs) if s[5] == ci]
        if ks:
            marks['chapters'].append((tl[2 + ks[0]][0], min(tl[2 + ks[0]][0] + round(4 * B * FPS), tl[2 + ks[-1]][1])))
        else:
            marks['chapters'].append((0, 0))
    g = Graphics(m, plan, marks, total)
    ov = os.path.join(work, 'ov'); os.makedirs(ov)
    empty = None
    for f in range(total):
        im = g.frame(f)
        p = os.path.join(ov, f'{f:05d}.png')
        im.save(p, compress_level=1)

    # ── финальная сборка: видео + графика + музыка + живой звук ──
    dur = total / FPS
    args = ['ffmpeg', '-y', '-v', 'error']
    pre, cat = '', ''
    for i, sgm in enumerate(files):
        args += ['-i', sgm]
        pre += f'[{i}:v]setsar=1,format=yuv420p[v{i}];[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}];'
        cat += f'[v{i}][a{i}]'
    n = len(files)
    hook_end = tl[0][1] / FPS
    fin_t = tl[-2][0] / FPS
    args += ['-framerate', str(FPS), '-i', os.path.join(ov, '%05d.png'),
             '-ss', f'{off:.3f}', '-t', f'{dur + 0.5:.3f}', '-i', music,
             '-filter_complex',
             pre + cat + f'concat=n={n}:v=1:a=1[b][nat];'
             f'[b]fps={FPS},setpts=N/{FPS}/TB[bb];[{n}:v]setpts=N/{FPS}/TB[o];[bb][o]overlay=format=auto,format=yuv420p[v];'
             # живой звук: громко на хуке, дальше — подложкой под музыку
             f"[nat]highpass=f=90,volume='if(lt(t,{hook_end:.2f}),1.0,0.32)':eval=frame,"
             f"acompressor=threshold=0.25:ratio=3:attack=5:release=120[natm];"
             # музыка: тише на хуке (слышно всплеск), на титре — во всю силу
             f"[{n + 1}:a]aresample=48000,aformat=channel_layouts=stereo,"
             f"volume='if(lt(t,{hook_end:.2f}),0.45,if(gt(t,{fin_t:.2f}),0.85,1.0))':eval=frame,"
             f"afade=t=in:d=0.05,afade=t=out:st={dur - 1.8:.2f}:d=1.8[mus];"
             f'[mus][natm]amix=inputs=2:duration=first:normalize=0,atrim=0:{dur:.3f},'
             f'loudnorm=I=-14:TP=-1.0:LRA=9,aresample=48000[a]',
             '-map', '[v]', '-map', '[a]', '-frames:v', str(total),
             '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '6M', '-bufsize', '12M',
             '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-c:a', 'aac', '-b:a', '192k',
             '-movflags', '+faststart', out]
    run(args)
    poster = os.path.splitext(out)[0] + '.jpg'
    run(['ffmpeg', '-y', '-v', 'error', '-ss', f"{(tl[1][0] + 20) / FPS:.2f}", '-i', out, '-frames:v', '1',
         '-vf', 'scale=720:1280', '-q:v', '3', poster])
    clip_segs = [s for s in segs]
    meta = {'duration': round(dur, 2), 'shots': len(segs) + 3,
            'photos': sum(1 for s in clip_segs if items[s[1]]['kind'] == 'photo'),
            'clips': sum(1 for s in clip_segs if items[s[1]]['kind'] == 'video'), 'candidates': len(items),
            'chapters': [c.get('title') for c in chs], 'music': os.path.basename(music),
            'authors': sorted({items[s[1]].get('author') for s in clip_segs if items[s[1]].get('author')}),
            'size': os.path.getsize(out), 'poster': poster, 'plan': {k: plan.get(k) for k in ('chapters', 'hook', 'hero', 'finale')}}
    json.dump(meta, open(os.path.splitext(out)[0] + '.json', 'w'), ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1])

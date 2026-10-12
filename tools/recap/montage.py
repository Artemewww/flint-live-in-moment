#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
АВТОМОНТАЖ ИТОГОВ СОБЫТИЯ FLINT — вертикальный ролик 1080x1920 под бит.

Вход — манифест JSON (его собирает scripts/recap/orchestrate.mts):
{
  "title": "Выезд на реку Ислочь", "dates": "9—11 ОКТЯБРЯ 2026",
  "music": "public/assets/music/leto-proshlo-gazuem.mp3",
  "seed": 0, "people": 6,
  "items": [{"path": "/tmp/a.mp4", "kind": "video", "author": 123}, ...],
  "out": "/tmp/recap.mp4"
}
Выход: out (mp4), out.jpg (обложка), out.json (сводка: длительность, сколько кадров).

Как выбирает кадры (без ИИ, бесплатно и предсказуемо):
  • у каждого видео смотрит кадры 4 раза в секунду: движение, резкость,
    экспозицию — и берёт самое живое окно, а не первые секунды;
  • выкидывает тёмное/смазанное/дубли (почти одинаковые кадры от разных людей);
  • раскладывает «день → ночь»: так выезд и проходит, а дат съёмки в
    Telegram-файлах нет (EXIF срезается);
  • режет строго по сетке битов трека.

Зависимости: ffmpeg/ffprobe, Pillow. Без numpy — чтобы запускалось где угодно.
"""
import json, math, os, random, subprocess, sys, tempfile, array
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageStat

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
W, H, FPS = 1080, 1920, 30
LIME, BLACK, WHITE = (230, 253, 58), (10, 10, 10), (255, 255, 255)

# Сетка битов известных треков клуба (измерено). Для остальных — автодетект.
# off — с какой секунды трека стартует ролик; beat0 — первый бит на таймлайне
# ролика; hit — сильная доля для появления логотипа.
TRACKS = {
    'leto-proshlo-gazuem': {'off': 16.5, 'beat': 0.5455, 'beat0': 0.22, 'intro_beats': 6},
}


def log(*a):
    print('[montage]', *a, file=sys.stderr, flush=True)


def run(cmd, capture=False):
    r = subprocess.run(cmd, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                       stderr=subprocess.PIPE)
    if r.returncode:
        raise RuntimeError(f"{cmd[0]} failed: {r.stderr.decode(errors='ignore')[-800:]}")
    return r.stdout


def probe(path):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
               'stream=width,height:stream_side_data=rotation:format=duration',
               '-of', 'json', path], capture=True)
    j = json.loads(out or b'{}')
    st = (j.get('streams') or [{}])[0]
    w, h = int(st.get('width') or 0), int(st.get('height') or 0)
    rot = 0
    for sd in st.get('side_data_list') or []:
        if 'rotation' in sd:
            rot = int(sd['rotation'])
    if abs(rot) == 90:
        w, h = h, w
    return w, h, float((j.get('format') or {}).get('duration') or 0)


# ── анализ ──────────────────────────────────────────────────────────────────

SW, SH = 72, 128  # размер кадра для анализа


def frames_of(path, fps=4):
    """Серые кадры SWxSH с частотой fps — через пайп, без временных файлов."""
    # Длинные записи (5-минутный стрим у костра) смотрим первые 120 с — дальше
    # обычно то же самое, а декодирование съедает минуты.
    raw = run(['ffmpeg', '-v', 'error', '-t', '120', '-i', path, '-vf',
               f'fps={fps},scale={SW}:{SH}:force_original_aspect_ratio=increase,crop={SW}:{SH},format=gray',
               '-f', 'rawvideo', '-'], capture=True)
    n = len(raw) // (SW * SH)
    return [Image.frombytes('L', (SW, SH), raw[i * SW * SH:(i + 1) * SW * SH]) for i in range(n)]


def sharpness(im):
    return ImageStat.Stat(im.filter(ImageFilter.FIND_EDGES)).var[0] ** 0.5


def dark_ratio(im):
    """Доля почти чёрных пикселей. Ночь у костра по средней яркости не
    отличить от дня (огонь её поднимает), а по доле темноты — легко."""
    h = im.histogram()
    return sum(h[:35]) / max(1, sum(h))


def bright_ratio(im):
    """Доля ярких пикселей: огонь, фонари, экран. Ночной кадр без них —
    просто чёрный прямоугольник, такие в ролик не берём."""
    h = im.histogram()
    return sum(h[200:]) / max(1, sum(h))


def ahash(im):
    s = im.resize((8, 8), Image.BILINEAR)
    px = list(s.tobytes()); m = sum(px) / 64
    return sum(1 << i for i, p in enumerate(px) if p > m)


def hamming(a, b):
    return bin(a ^ b).count('1')


def analyze_video(it, win):
    w, h, dur = probe(it['path'])
    it.update(w=w, h=h, dur=dur)
    if dur < 0.9:
        return []
    fr = frames_of(it['path'])
    if len(fr) < 3:
        return []
    luma = [ImageStat.Stat(f).mean[0] for f in fr]
    dark = [dark_ratio(f) for f in fr]
    hot = [bright_ratio(f) for f in fr]
    sharp = [sharpness(f) for f in fr]
    motion = [0.0] + [ImageStat.Stat(ImageChops.difference(fr[i], fr[i - 1])).mean[0] for i in range(1, len(fr))]
    step = 0.25
    k = max(1, int(round(win / step)))
    cands = []
    lo, hi = 1, len(fr) - k - 1  # края клипа — дёрганые: старт/стоп съёмки
    if hi < lo:
        lo, hi = 0, max(0, len(fr) - k)
    for i in range(lo, hi + 1):
        seg = range(i, min(len(fr), i + k))
        L = sum(luma[j] for j in seg) / len(seg)
        S = sum(sharp[j] for j in seg) / len(seg)
        M = sum(motion[j] for j in seg) / len(seg)
        # Движение хорошо до предела: тряска камеры — это тоже «движение».
        mscore = min(M, 14) / 14 - max(0, M - 28) / 28
        expo = 1.0 - min(1.0, abs(L - 115) / 115)
        score = 0.45 * mscore + 0.35 * min(S, 40) / 40 + 0.2 * expo
        D = sum(dark[j] for j in seg) / len(seg)
        Hh = sum(hot[j] for j in seg) / len(seg)
        if D > 0.42:  # ночь: ценность кадра — в огне/свете, а не в «экспозиции»
            score = 0.4 * mscore + 0.25 * min(S, 40) / 40 + 0.35 * min(Hh, 0.06) / 0.06
        cands.append((score, i * step, L, S, M, ahash(fr[i + len(seg) // 2]), D, Hh))
    if not cands:
        return []
    cands.sort(reverse=True)
    out = []
    for c in cands:  # 1–2 непересекающихся окна на клип
        if any(abs(c[1] - o['ss']) < win * 1.5 for o in out):
            continue
        out.append({'src': it, 'kind': 'video', 'ss': c[1], 'score': c[0], 'luma': c[2],
                    'sharp': c[3], 'motion': c[4], 'hash': c[5], 'dark': c[6], 'hot': c[7]})
        if len(out) >= (2 if dur > 9 else 1):
            break
    return out


def analyze_photo(it):
    im = Image.open(it['path']).convert('L')
    it.update(w=im.width, h=im.height)
    im.thumbnail((SW * 2, SH * 2))
    L = ImageStat.Stat(im).mean[0]
    S = sharpness(im)
    expo = 1.0 - min(1.0, abs(L - 115) / 115)
    return [{'src': it, 'kind': 'photo', 'ss': 0, 'score': 0.6 * min(S, 50) / 50 + 0.4 * expo,
             'luma': L, 'sharp': S, 'motion': 0, 'hash': ahash(im), 'dark': dark_ratio(im), 'hot': bright_ratio(im)}]


# ── музыка ──────────────────────────────────────────────────────────────────

def beat_grid(music):
    key = os.path.splitext(os.path.basename(music))[0]
    if key in TRACKS:
        return TRACKS[key]
    # Автодетект: огибающая громкости → темп автокорреляцией → фаза по ударам.
    raw = run(['ffmpeg', '-v', 'error', '-i', music, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture=True)
    a = array.array('h'); a.frombytes(raw)
    hop = 200; fps = 8000 / hop
    env = [math.sqrt(sum(x * x for x in a[i:i + hop:4]) / (hop / 4) + 1) for i in range(0, len(a) - hop, hop)]
    on = [max(0.0, env[i] - env[i - 1]) for i in range(1, len(env))]
    best = (120.0, -1)
    for bpm10 in range(800, 1700, 5):
        lag = 600 / (bpm10 / 10) * fps / 10 * 10 / 10
        lag = 60 / (bpm10 / 10) * fps
        s = sum(on[i] * on[int(i + lag)] for i in range(0, len(on) - int(lag) - 1, 2))
        if s > best[1]:
            best = (bpm10 / 10, s)
    period = 60 / best[0]
    # Старт: первая точка, где трек уже «играет» (≥40% от медианы громкости).
    med = sorted(env)[len(env) // 2]
    start_i = next((i for i, e in enumerate(env) if e > 0.4 * med), 0)
    off = max(0.0, start_i / fps - 0.2)
    per_f = period * fps
    base = int(off * fps)
    phase = max(range(int(per_f)), key=lambda o: sum(on[min(len(on) - 1, int(base + o + k * per_f))] for k in range(32)))
    beat0 = phase / fps
    return {'off': off, 'beat': period, 'beat0': beat0, 'intro_beats': 6}


# ── отбор и порядок ─────────────────────────────────────────────────────────

def is_night(s):
    return s['dark'] > 0.42


def select(shots, n_max, seed):
    rnd = random.Random(seed)
    # Чёрный кадр без огня (луч фонарика в лесу) не нужен; ночь с костром — нужна.
    # Резкость обязательна и для видео: «движение» без резкости — это палец у
    # объектива или камера в кармане, а не экшн.
    good = [s for s in shots if s['luma'] > 14 and s['sharp'] > (9 if s['kind'] == 'video' else 6)
            and not (is_night(s) and (s['hot'] < 0.012 or s['luma'] < 28))]
    # Небольшой шум от seed: «другая версия» берёт другие кадры из близких по качеству.
    for s in good:
        s['rank'] = s['score'] + rnd.uniform(0, 0.12 if seed else 0.0)
    chosen, per_src = [], {}

    def take(pool, limit):
        for s in sorted(pool, key=lambda s: -s['rank']):
            if limit <= 0 or len(chosen) >= n_max:
                return
            if any(hamming(s['hash'], c['hash']) <= 8 for c in chosen):
                continue  # дубль: тот же кадр от двух людей или серия фото
            src = id(s['src'])
            if per_src.get(src, 0) >= 2:
                continue
            per_src[src] = per_src.get(src, 0) + 1
            chosen.append(s); limit -= 1

    # Квоты, а не общий рейтинг: у фото нет «движения», и в общем зачёте они
    # проигрывали всегда — ролик выходил без единой фотографии. Ночь тоже
    # своей квотой: иначе дневные кадры её вытесняют, и пропадает сама история.
    photos = [s for s in good if s['kind'] == 'photo']
    vids = [s for s in good if s['kind'] == 'video']
    n_night = min(sum(1 for s in good if is_night(s)), max(3, round(n_max * 0.25)))
    take([s for s in vids if is_night(s)], max(0, n_night - 2))
    take([s for s in photos if is_night(s)], 2)
    take([s for s in photos if not is_night(s)], max(2, round(n_max * 0.3)) - sum(c['kind'] == 'photo' for c in chosen))
    take([s for s in vids if not is_night(s)], n_max)
    return chosen


def order(chosen, seed):
    rnd = random.Random(1000 + seed)
    day = [s for s in chosen if not is_night(s)]
    night = [s for s in chosen if is_night(s)]
    # Сильнейший кадр — сразу после интро (на «дроп»), дальше чередуем
    # динамику и спокойные кадры, чтобы монтаж дышал.
    def weave(lst):
        lst = sorted(lst, key=lambda s: -s['rank'])
        if not lst:
            return []
        head, rest = lst[0], lst[1:]
        rnd.shuffle(rest)
        hi = sorted([s for s in rest if s['motion'] >= 8], key=lambda s: -s['motion'])
        lo = [s for s in rest if s['motion'] < 8]
        out = [head]
        while hi or lo:
            if hi: out.append(hi.pop(0))
            if lo: out.append(lo.pop(0))
        return out
    return weave(day), weave(night)


# ── рендер шотов ────────────────────────────────────────────────────────────

GRADE_DAY = 'eq=contrast=1.07:saturation=1.12:gamma=0.98'
GRADE_NIGHT = 'eq=contrast=1.05:saturation=1.15:brightness=0.03:gamma=1.08'


def push_in(nf, amount):
    z = f"(1-{amount}*n/{nf})"
    return f"crop=w='trunc(iw*{z}/2)*2':h='trunc(ih*{z}/2)*2':x='(iw-ow)/2':y='(ih-oh)/2'"


def render_shot(shot, nf, out, grade):
    it = shot['src']
    fill = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}"
    tail = f"scale={W}:{H}:flags=lanczos,{grade},scale=out_range=tv,format=yuv420p,setsar=1"
    landscape = it.get('w', 0) > it.get('h', 1) * 1.15
    if shot['kind'] == 'photo':
        if landscape:  # горизонтальное фото — целиком на размытом фоне
            vf = (f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},split[a][b];"
                  f"[a]gblur=sigma=40,eq=brightness=-0.15[bg];[b]scale={W*2-160}:-2[fg];"
                  f"[bg][fg]overlay=(W-w)/2:(H-h)/2-120,fps={FPS},{push_in(nf, 0.06)},{tail}")
        else:
            vf = f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},fps={FPS},{push_in(nf, 0.12)},{tail}"
        inp = ['-loop', '1', '-framerate', str(FPS), '-i', it['path']]
    else:
        if landscape:
            vf = (f"fps={FPS},split[a][b];[a]{fill},gblur=sigma=30,eq=brightness=-0.15[bg];"
                  f"[b]scale={W-80}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2-60,{push_in(nf, 0.04)},{tail}")
        else:
            vf = f"fps={FPS},{fill},{push_in(nf, 0.07)},{tail}"
        inp = ['-ss', f"{shot['ss']:.2f}", '-i', it['path']]
    run(['ffmpeg', '-y', '-v', 'error', *inp, '-filter_complex', vf, '-frames:v', str(nf), '-an',
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-r', str(FPS), out])


def render_bg(path, ss, nf, out, blur, bright):
    """Фон интро/аутро: кадр-источник, размытый и притушенный под графику."""
    vf = (f"fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
          f"eq=brightness={bright}:saturation=1.15,gblur=sigma={blur},scale=out_range=tv,format=yuv420p,setsar=1")
    inp = ['-stream_loop', '-1', '-ss', f'{ss:.2f}', '-i', path] if path.lower().endswith(('.mp4', '.mov', '.m4v', '.webm')) \
        else ['-loop', '1', '-framerate', str(FPS), '-i', path]
    run(['ffmpeg', '-y', '-v', 'error', *inp, '-vf', vf, '-frames:v', str(nf), '-an',
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', str(FPS), out])


# ── графика ─────────────────────────────────────────────────────────────────

def F(name, size):
    return ImageFont.truetype(os.path.join(ASSETS, 'fonts', name), size)


HEAVY = lambda s: F('SONGER_C_Heavy.otf', s)
GUNT = lambda s: F('Gunterz-Medium.otf', s)


def clamp(x): return max(0.0, min(1.0, x))
def prog(f, a, b): return clamp((f - a) / max(1, b - a))
def out_cubic(t): return 1 - (1 - t) ** 3
def out_back(t, s=1.9): t -= 1; return t * t * ((s + 1) * t + s) + 1
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


def shadowed(im, r=14, a=0.55):
    pad = r * 2
    base = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 255)); sh.putalpha(im.getchannel('A').point(lambda v: int(v * a)))
    base.alpha_composite(sh, (pad, pad + 4)); base = base.filter(ImageFilter.GaussianBlur(r))
    base.alpha_composite(im, (pad, pad)); return base


def fit_lines(text, font_fn, max_w, sizes, max_lines=2):
    """Название события любой длины: подбираем кегль и перенос до 2 строк."""
    words = text.upper().split()
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
        if len(lines) <= max_lines and all(f.getlength(l) <= max_w for l in lines):
            return lines, f
    f = font_fn(sizes[-1])
    return [' '.join(words)[:28]], f


def pill(label, max_w=960):
    size = 36
    tl = text_img(label, GUNT(size), BLACK, 3)
    while tl.width + 96 > max_w and size > 20:  # длинная статистика — мельче, но целиком
        size -= 2; tl = text_img(label, GUNT(size), BLACK, 2)
    h = 92; w = tl.width + 96
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=LIME + (255,))
    im.alpha_composite(tl, (48, (h - tl.height) // 2)); return im


def make_vignette():
    v = Image.new('L', (W // 4, H // 4), 0); d = ImageDraw.Draw(v)
    for i in range(60):
        t = i / 60
        d.ellipse((-W // 8 + i * 2.6, -H // 10 + i * 4.2, W // 4 + W // 8 - i * 2.6, H // 4 + H // 10 - i * 4.2),
                  fill=int(110 * (1 - t) ** 2))
    v = v.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(30))
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); im.putalpha(v.point(lambda x: 110 - x if x < 110 else 0)); return im


def make_grad(h=760, a=0.6):
    g = Image.new('L', (1, h))
    for y in range(h): g.putpixel((0, y), int(255 * a * (y / h) ** 1.6))
    im = Image.new('RGBA', (W, h), (0, 0, 0, 255)); im.putalpha(g.resize((W, h))); return im


class Graphics:
    def __init__(self, m, tl, marks):
        self.tl, self.marks = tl, marks
        self.total = tl[-1][1]
        self.stone = Image.open(os.path.join(ASSETS, 'stone.png'))
        self.stack = Image.open(os.path.join(ASSETS, 'stack.png'))
        hz = Image.open(os.path.join(ASSETS, 'horiz.png'))
        self.wm = hz.resize((210, round(210 * hz.height / hz.width)), Image.LANCZOS)
        self.vign, self.grad = make_vignette(), make_grad()
        title = str(m.get('title') or 'FLINT').split(':')[0].strip()
        lines, f = fit_lines(title, HEAVY, 960, [220, 190, 160, 140, 120, 100])
        self.title = [shadowed(text_img(l, f, LIME), 18, 0.5) for l in lines]
        self.kicker = shadowed(text_img(str(m.get('kicker') or 'FLINT · ИТОГИ').upper(), GUNT(42), WHITE, 6), 10)
        self.dates = shadowed(text_img(str(m.get('dates') or '').upper(), GUNT(40), WHITE, 5), 10) if m.get('dates') else None
        stats = m.get('stats_line')
        self.stats = pill(stats.upper()) if stats else None
        self.night = shadowed(text_img('А ПОТОМ — НОЧЬ', HEAVY(140), WHITE), 16)
        self.fin_big = shadowed(text_img(str(m.get('finale') or 'СПАСИБО ВСЕМ').upper(), HEAVY(150), LIME), 16)
        self.fin_small = shadowed(text_img('КТО БЫЛ С НАМИ · ДО СЛЕДУЮЩЕГО ВЫЕЗДА', GUNT(34), WHITE, 3), 10)
        self.tag = text_img('ЖИВИ В МОМЕНТЕ', GUNT(54), WHITE, 6)
        self.cta = text_img('СЛЕДУЮЩИЙ ВЫЕЗД — В ПРИЛОЖЕНИИ FLINT', GUNT(30), (190, 190, 190), 2)

    def place_c(self, fr, im, cx, cy, scale=1.0, a=1.0):
        if a <= 0.003 or scale <= 0.01: return
        if abs(scale - 1) > 0.002:
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        fr.alpha_composite(alpha(im, a), (round(cx - im.width / 2), round(cy - im.height / 2)))

    def wipe(self, fr, im, x, y, t):
        if t <= 0: return
        vis = max(1, round(im.height * out_cubic(t)))
        fr.alpha_composite(im.crop((0, 0, im.width, vis)), (round(x), round(y + im.height - vis)))

    def flash(self, fr, color, a):  # noqa: D401 — вспышка цветом на весь кадр
        if a > 0.003: fr.alpha_composite(Image.new('RGBA', (W, H), color + (int(255 * a),)))

    def frame(self, f):
        fr = Image.new('RGBA', (W, H), (0, 0, 0, 0)); fr.alpha_composite(self.vign)
        mk = self.marks
        if f < mk['body']:
            self.flash(fr, (0, 0, 0), 1 - out_cubic(prog(f, 0, 36)) * 0.55)
            hit = mk['hit']
            if f >= hit - 1:
                t = prog(f, hit - 1, hit + 11)
                self.place_c(fr, self.stone, W / 2, 600, out_back(t) * 0.42, clamp(t * 3))
                self.flash(fr, LIME, 0.4 * (1 - prog(f, hit, hit + 5)))
            y = 980
            self.wipe(fr, self.kicker, (W - self.kicker.width) / 2, y - 50, prog(f, hit + 8, hit + 20))
            for i, im in enumerate(self.title):
                self.wipe(fr, im, (W - im.width) / 2, y + 20 + i * (im.height - 30), prog(f, hit + 12 + i * 4, hit + 26 + i * 4))
            if self.dates:
                yb = y + 40 + len(self.title) * (self.title[0].height - 30)
                self.wipe(fr, self.dates, (W - self.dates.width) / 2, yb, prog(f, hit + 22, hit + 36))
            return fr
        if f < mk['finale']:
            fr.alpha_composite(self.grad, (0, H - self.grad.height))
            fr.alpha_composite(alpha(self.wm, 0.92 * prog(f, mk['body'], mk['body'] + 10)), (60, 110))
        if f >= mk['body']:
            self.flash(fr, LIME, 0.55 * (1 - prog(f, mk['body'], mk['body'] + 5)))
        if mk.get('night') and mk['night'] <= f < mk['night'] + 46:
            a, b = mk['night'], mk['night'] + 46
            self.flash(fr, WHITE, 0.3 * (1 - prog(f, a, a + 4)))
            self.wipe(fr, alpha(self.night, 1 - prog(f, b - 8, b)), 46, 1440, prog(f, a + 2, a + 14))
        if self.stats and mk.get('stats') and mk['stats'] <= f < mk['finale']:
            a, b = mk['stats'], mk['finale'] - 2
            t_in, t_out = out_cubic(prog(f, a, a + 9)), in_cubic(prog(f, b - 8, b))
            x = 60 - (1 - t_in) * (self.stats.width + 80) - t_out * (self.stats.width + 80)
            fr.alpha_composite(self.stats, (round(x), 1560))
        if mk['finale'] <= f < mk['outro']:
            a = mk['finale'] + 6
            self.flash(fr, WHITE, 0.3 * (1 - prog(f, mk['finale'], mk['finale'] + 4)))
            self.wipe(fr, self.fin_big, (W - self.fin_big.width) / 2, 1450, prog(f, a, a + 14))
            self.wipe(fr, self.fin_small, (W - self.fin_small.width) / 2, 1450 + self.fin_big.height + 20, prog(f, a + 10, a + 24))
        if f >= mk['outro']:
            a = mk['outro']
            t = prog(f, a + 2, a + 18)
            self.place_c(fr, self.stack, W / 2, 820, 0.85 + 0.15 * out_back(t, 1.4), clamp(t * 2.5))
            self.place_c(fr, self.tag, W / 2, 1160, 1.0, prog(f, a + 16, a + 28))
            self.place_c(fr, self.cta, W / 2, 1240, 1.0, prog(f, a + 26, a + 40) * 0.9)
            self.flash(fr, (0, 0, 0), prog(f, self.total - 16, self.total - 1))
        return fr


# ── сборка ──────────────────────────────────────────────────────────────────

def main(manifest_path):
    m = json.load(open(manifest_path))
    seed = int(m.get('seed') or 0)
    music = m['music']
    out = m['out']
    grid = beat_grid(music)
    B, B0 = grid['beat'], grid['beat0']
    work = tempfile.mkdtemp(prefix='recap_')
    log('work', work, 'grid', grid)

    items = [it for it in m['items'] if os.path.exists(it['path'])]
    # Анализ параллельно: работа — в ffmpeg-подпроцессах, GIL не мешает.
    from concurrent.futures import ThreadPoolExecutor

    def one(it):
        try:
            return analyze_video(it, 2 * B) if it['kind'] == 'video' else analyze_photo(it)
        except Exception as e:  # битый файл не должен ронять весь ролик
            log('skip', it['path'], e)
            return []
    shots = []
    with ThreadPoolExecutor(max_workers=max(2, os.cpu_count() or 2)) as ex:
        for r in ex.map(one, items):
            shots += r
    log('candidates', len(shots), 'from', len(items))

    # Длина ролика от материала: 14–34 шота по 2 бита ≈ 15–37 с тела.
    n_max = max(6, min(34, int(m.get('max_shots') or 30)))
    chosen = select(shots, n_max, seed)
    if len(chosen) < 4:
        raise SystemExit('too_little_media')
    day, night = order(chosen, seed)
    # Финал — лучшее фото (часто общее), иначе лучший спокойный кадр.
    pool = day + night
    fin = max([s for s in pool if s['kind'] == 'photo'] or pool, key=lambda s: s['rank'])
    if fin in day: day.remove(fin)
    elif fin in night: night.remove(fin)
    body = [(s, 2, GRADE_DAY) for s in day] + [(s, 2, GRADE_NIGHT) for s in night]
    # Ночь в начале ночного блока — 3 бита: смене настроения нужно время.
    if night:
        i0 = len(day)
        body[i0] = (body[i0][0], 3, GRADE_NIGHT)

    intro_b = grid['intro_beats']
    plan = [('intro', intro_b)] + [(b, n) for b, n, _ in [(x[0], x[1], x[2]) for x in body]] + [('finale', 4), ('outro', 8)]
    tl, b = [], 0
    for _, nb in plan:
        t0 = 0.0 if b == 0 else B0 + b * B
        b += nb
        tl.append((round(t0 * FPS), round((B0 + b * B) * FPS)))
    marks = {
        'hit': round((B0 + 2 * B) * FPS), 'body': tl[1][0],
        'night': tl[1 + len(day)][0] if night else None,
        'stats': tl[max(1, len(body) - 2)][0] if len(body) > 4 else None,
        'finale': tl[-2][0], 'outro': tl[-1][0],
    }
    log('shots', len(body), 'day', len(day), 'night', len(night), 'frames', tl[-1][1])

    # шоты
    segs = []
    bg_src = (night[0] if night else (day[0] if day else fin))
    bgp = bg_src['src']['path']
    seg = os.path.join(work, 'intro.mp4'); render_bg(bgp, bg_src['ss'], tl[0][1] - tl[0][0], seg, 5, -0.08); segs.append(seg)
    for i, (s, _, grade) in enumerate(body):
        seg = os.path.join(work, f's{i:03d}.mp4')
        f0, f1 = tl[1 + i]
        render_shot(s, f1 - f0, seg, grade); segs.append(seg)
    seg = os.path.join(work, 'finale.mp4'); render_shot(fin, tl[-2][1] - tl[-2][0], seg, GRADE_DAY); segs.append(seg)
    seg = os.path.join(work, 'outro.mp4'); render_bg(bgp, bg_src['ss'], tl[-1][1] - tl[-1][0], seg, 18, -0.2); segs.append(seg)

    # графика
    m.setdefault('stats_line', None)
    g = Graphics(m, tl, marks)
    ov = os.path.join(work, 'ov'); os.makedirs(ov)
    for f in range(g.total):
        g.frame(f).save(os.path.join(ov, f'{f:05d}.png'), compress_level=1)

    # Склейка concat-ФИЛЬТРОМ, не copy-concat: у сегментов из фото и видео
    # разные SAR/диапазон, и copy-concat переинициализирует декодер на стыке —
    # overlay теряет синхрон, и графика пропадает на первых кадрах шотов.
    args = ['ffmpeg', '-y', '-v', 'error']
    pre, cat = '', ''
    for i, sgm in enumerate(segs):
        args += ['-i', sgm]; pre += f'[{i}:v]setsar=1,format=yuv420p[s{i}];'; cat += f'[s{i}]'
    n = len(segs)
    dur = g.total / FPS
    args += ['-framerate', str(FPS), '-i', os.path.join(ov, '%05d.png'),
             '-ss', f"{grid['off']:.3f}", '-t', f'{dur:.3f}', '-i', music,
             '-filter_complex',
             pre + cat + f'concat=n={n}:v=1:a=0,fps={FPS},setpts=N/{FPS}/TB[b];[{n}:v]setpts=N/{FPS}/TB[o];'
             f'[b][o]overlay=format=auto,format=yuv420p[v];'
             f'[{n+1}:a]afade=t=in:d=0.08,afade=t=out:st={dur-2.6:.2f}:d=2.6,loudnorm=I=-14:TP=-1.2:LRA=9,aresample=48000[a]',
             '-map', '[v]', '-map', '[a]', '-frames:v', str(g.total),
             '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-maxrate', '5M', '-bufsize', '10M',
             '-profile:v', 'high', '-r', str(FPS), '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', out]
    run(args)
    poster = os.path.splitext(out)[0] + '.jpg'
    run(['ffmpeg', '-y', '-v', 'error', '-ss', f"{(marks['hit'] + 40) / FPS:.2f}", '-i', out, '-frames:v', '1',
         '-vf', 'scale=720:1280', '-q:v', '3', poster])
    meta = {'duration': round(dur, 2), 'shots': len(body) + 1, 'photos': sum(1 for s, _, _ in body if s['kind'] == 'photo'),
            'clips': sum(1 for s, _, _ in body if s['kind'] == 'video'), 'candidates': len(shots),
            'authors': sorted({s['src'].get('author') for s, _, _ in body if s['src'].get('author')}),
            'size': os.path.getsize(out), 'poster': poster}
    json.dump(meta, open(os.path.splitext(out)[0] + '.json', 'w'))
    print(json.dumps(meta))


if __name__ == '__main__':
    main(sys.argv[1])

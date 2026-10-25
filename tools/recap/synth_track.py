#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ИНСТРУМЕНТАЛ ДЛЯ РОЛИКОВ БЕЗ ВНЕШНИХ СЕРВИСОВ — синтез на чистом Python.

Зачем: в библиотеке клуба только песни с вокалом (гимн и ещё две), а Lyria
на бесплатном ключе Gemini недоступна. Этот скрипт собирает трек без слов,
со структурой под монтаж: интро → дроп A → брейк → дроп B → финальный удар.
Темп и тональность — параметры, так что треки разные.

    python3 tools/recap/synth_track.py sport 124 A public/assets/music/sport__flint-drive.mp3

Готовый mp3 кладётся в public/assets/music — montage.py выберет его по
префиксу настроения. Зависимости: stdlib + ffmpeg (сведение и мастеринг).
"""
import array, math, os, random, subprocess, sys, tempfile, wave

SR = 44100
NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


class Track:
    def __init__(self, bpm, bars):
        self.beat = 60 / bpm
        self.n = int((bars * 4 + 8) * self.beat * SR)
        self.stems = {}

    def stem(self, name):
        if name not in self.stems:
            self.stems[name] = array.array('f', bytes(4 * self.n))
        return self.stems[name]

    def add(self, name, smp, t, gain=1.0):
        s = self.stem(name); i0 = int(t * SR)
        for i in range(min(len(smp), self.n - i0)):
            s[i0 + i] += smp[i] * gain


# ── инструменты (каждый звук считается один раз и переиспользуется) ──

def kick(dur=0.42):
    out, ph = [], 0.0
    for i in range(int(dur * SR)):
        t = i / SR
        f = 45 + 110 * math.exp(-t * 32)
        ph += 2 * math.pi * f / SR
        env = math.exp(-t * 7.5)
        click = math.exp(-t * 900) * 0.6
        out.append(math.tanh(1.6 * math.sin(ph) * env) + click * (random.random() * 2 - 1))
    return out


def noise_hit(dur, decay, hp=0.0, tone=0.0, f0=200):
    out, prev, lp = [], 0.0, 0.0
    for i in range(int(dur * SR)):
        t = i / SR
        x = random.random() * 2 - 1
        if hp:  # грубый ВЧ-фильтр: разность соседних отсчётов
            x, prev = x - prev * hp, x
        y = x * math.exp(-t * decay)
        if tone:
            y += tone * math.sin(2 * math.pi * f0 * t) * math.exp(-t * decay * 1.5)
        out.append(y)
    return out


def clap():
    base = noise_hit(0.35, 18, hp=0.85, tone=0.25, f0=190)
    out = [0.0] * len(base)
    for k, d in enumerate((0, 0.011, 0.022)):  # три «хлопка» подряд — живой клэп
        o = int(d * SR)
        for i in range(len(base) - o):
            out[i + o] += base[i] * (0.55 if k < 2 else 1.0)
    return out


def saw_voice(f, dur, detune=(-0.18, -0.09, 0, 0.09, 0.18), cutoff=3800.0, attack=0.01, release=0.15, cut_to=None):
    """Суперпила: 5 расстроенных пил + однополюсный ФНЧ (с огибающей среза)."""
    n = int(dur * SR)
    phs = [random.random() for _ in detune]
    incs = [f * 2 ** (d / 12) / SR for d in detune]
    out, lp = [], 0.0
    for i in range(n):
        x = 0.0
        for k in range(len(phs)):
            phs[k] += incs[k]
            if phs[k] >= 1: phs[k] -= 1
            x += 2 * phs[k] - 1
        x /= len(phs)
        c = cutoff if cut_to is None else cutoff + (cut_to - cutoff) * i / n
        a = 1 - math.exp(-2 * math.pi * c / SR)
        lp += a * (x - lp)
        t = i / SR
        env = min(1.0, t / attack) * (1.0 if t < dur - release else max(0.0, (dur - t) / release))
        out.append(lp * env)
    return out


def sine_bass(f, dur):
    out = []
    for i in range(int(dur * SR)):
        t = i / SR
        env = min(1.0, t / 0.005) * (1.0 if t < dur - 0.03 else max(0.0, (dur - t) / 0.03))
        x = math.sin(2 * math.pi * f * t) + 0.25 * math.sin(4 * math.pi * f * t)
        out.append(math.tanh(1.3 * x) * env)
    return out


def pluck(f, dur=0.28):
    out, lp = [], 0.0
    for i in range(int(dur * SR)):
        t = i / SR
        x = (2 * ((f * t) % 1) - 1) * 0.6 + 0.4 * math.copysign(1, math.sin(2 * math.pi * f * t))
        a = 1 - math.exp(-2 * math.pi * (600 + 5000 * math.exp(-t * 18)) / SR)
        lp += a * (x - lp)
        out.append(lp * math.exp(-t * 9))
    return out


def riser(dur):
    out, lp = [], 0.0
    for i in range(int(dur * SR)):
        p = i / (dur * SR)
        x = random.random() * 2 - 1
        a = 1 - math.exp(-2 * math.pi * (300 + 9000 * p ** 2) / SR)
        lp += a * (x - lp)
        out.append(lp * p ** 1.5 + 0.15 * math.sin(2 * math.pi * (200 + 900 * p ** 2) * i / SR) * p)
    return out


def impact(dur=2.5):
    out, ph = [], 0.0
    for i in range(int(dur * SR)):
        t = i / SR
        ph += 2 * math.pi * (38 + 60 * math.exp(-t * 6)) / SR
        out.append(0.9 * math.sin(ph) * math.exp(-t * 2.2) + 0.35 * (random.random() * 2 - 1) * math.exp(-t * 3.5))
    return out


# ── аранжировка ──

def compose(bpm=124, key='A', seed=7, bars=(4, 8, 2, 14)):
    """bars = (интро, дроп A, брейк, дроп B) в тактах. montage.py передаёт их
    из раскладки ролика — музыка пишется ПОД монтаж: дроп A на титре, брейк
    на «напряжении», дроп B на кульминации, финальный удар на логотипе."""
    random.seed(seed)
    root = 45 + NOTE[key] - 9  # A2 = 45
    # i – VI – III – VII в миноре: драйв и «полёт»
    prog = [(0, 3, 7), (-4, 0, 3), (3, 7, 10), (-2, 2, 5)]
    i_, a_, br_, b_ = (max(1, bars[0]), max(1, bars[1]), max(0, bars[2]), max(1, bars[3]))
    INTRO, DROP_A = 0, i_
    BREAK = DROP_A + a_
    DROP_B = BREAK + br_
    END = DROP_B + b_
    T = Track(bpm, END + 2)
    b = T.beat
    bar = lambda k: k * 4 * b

    K, C, HH, OH = kick(), clap(), noise_hit(0.05, 90, hp=0.97), noise_hit(0.22, 16, hp=0.97)
    CR = noise_hit(2.2, 1.6, hp=0.9)
    pads = {}
    for ci, ch in enumerate(prog):
        dur = 4 * b
        pads[ci] = [sum(v) / 3 for v in zip(*[saw_voice(hz(root + 12 + n), dur, cutoff=2600, attack=0.08, release=0.3) for n in ch])]
        pads[('lp', ci)] = [sum(v) / 3 for v in zip(*[saw_voice(hz(root + 12 + n), dur, cutoff=350, cut_to=1600, attack=0.2, release=0.3) for n in ch])]
    stab = {ci: [sum(v) / 3 for v in zip(*[saw_voice(hz(root + 24 + n), b * 0.45, cutoff=5200, release=0.12) for n in ch])] for ci, ch in enumerate(prog)}
    bass = {ci: sine_bass(hz(root - 12 + ch[0]), b * 0.42) for ci, ch in enumerate(prog)}
    plk = {}

    def pl(m):
        if m not in plk: plk[m] = pluck(hz(m))
        return plk[m]

    kicks = []
    for k in range(END):
        t0, ci = bar(k), k % 4
        ch = prog[ci]
        full = DROP_A <= k < BREAK or DROP_B <= k < END
        if k < DROP_A:  # интро: фильтр открывается, «сердцебиение»
            T.add('pad', pads[('lp', ci)], t0, 0.55)
            for q in (0, 1.5) if k < 3 else (0, 1.5, 2, 3):
                T.add('drums', K, t0 + q * b, 0.55); kicks.append(t0 + q * b)
            if k == DROP_A - 1 and k >= 0:
                T.add('fx', riser(4 * b), t0, 0.5)
                for s in range(8):  # дробь малого в конце интро
                    T.add('drums', C, t0 + 2 * b + s * b / 4, 0.18 + 0.05 * s)
        elif k < BREAK or k >= DROP_B:
            T.add('pad', pads[ci], t0, 0.28)
            for q in range(4):
                T.add('drums', K, t0 + q * b, 0.95); kicks.append(t0 + q * b)
                T.add('drums', OH, t0 + (q + 0.5) * b, 0.15)
                T.add('bass', bass[ci], t0 + (q + 0.5) * b, 0.75)
                for s in range(4):
                    T.add('drums', HH, t0 + (q + s / 4) * b, 0.06 if s % 2 else 0.10)
            for q in (1, 3):
                T.add('drums', C, t0 + q * b, 0.55)
            for q in (0, 0.75, 1.5, 2.5, 3.25):  # синкопированные аккорды-стабы
                T.add('stab', stab[ci], t0 + q * b, 0.30)
            arp = [root + 24 + ch[(i * 2) % 3] + (12 if i % 4 == 3 else 0) for i in range(16)]
            for s, m in enumerate(arp):
                T.add('lead', pl(m), t0 + s * b / 4, 0.17 if k < BREAK else 0.21)
            if br_ == 0 and k == BREAK - 1:  # брейка нет — нарастание в последнем такте дропа A
                T.add('fx', riser(4 * b), t0, 0.45)
            if k >= DROP_B and k % 2 == 1:  # во втором дропе — верхняя мелодия
                for q, deg in ((0, 2), (1, 1), (1.5, 0), (2.5, 1)):
                    T.add('lead', pl(root + 36 + ch[deg]), t0 + q * b, 0.12)
        else:  # брейк: воздух, фильтр, нарастание
            T.add('pad', pads[('lp', ci)], t0, 0.5)
            for s in range(16):
                T.add('lead', pl(root + 24 + ch[(s * 2) % 3]), t0 + s * b / 4, 0.08)
            if k == DROP_B - 1:
                T.add('fx', riser(4 * b), t0, 0.6)
                for s in range(16):
                    T.add('drums', C, t0 + s * b / 4, 0.1 + 0.03 * s)
        if k in (DROP_A, DROP_B):
            T.add('fx', impact(), t0, 0.9); T.add('drums', CR, t0, 0.35)
    # финал: удар + хвост аккорда
    t_end = bar(END)
    T.add('fx', impact(3.5), t_end, 1.0); T.add('drums', K, t_end, 1.0); T.add('drums', CR, t_end, 0.4)
    T.add('pad', [x * math.exp(-i / SR * 0.8) for i, x in enumerate(pads[0] + pads[0])], t_end, 0.4)

    # пампинг: бас, пэды и стабы «дышат» от бочки — фирменный звук танцевальных треков
    duck = array.array('f', [1.0] * T.n)
    for t in kicks:
        i0 = int(t * SR)
        for i in range(int(0.28 * SR)):
            if i0 + i < T.n:
                duck[i0 + i] = min(duck[i0 + i], 0.3 + 0.7 * (i / (0.28 * SR)) ** 0.7)
    for name in ('bass', 'pad', 'stab'):
        s = T.stem(name)
        for i in range(T.n):
            s[i] *= duck[i]
    return T, t_end + 3.0


def write_wav(path, data, gain):
    pk = max(1e-6, max(abs(x) for x in data))
    g = gain / pk
    pcm = array.array('h', (int(max(-1, min(1, x * g)) * 32000) for x in data))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


def render(out, bpm=124, key='A', bars=(4, 8, 2, 14), seed=7):
    """Трек в out (mp3) + сайдкар с точной сеткой. Возвращает путь."""
    T, length = compose(int(bpm), key, seed=seed, bars=bars)
    work = tempfile.mkdtemp(prefix='synth_')
    gains = {'drums': 0.9, 'bass': 0.75, 'pad': 0.5, 'stab': 0.45, 'lead': 0.4, 'fx': 0.6}
    ins, filt = [], []
    for i, (name, s) in enumerate(T.stems.items()):
        p = os.path.join(work, f'{name}.wav'); write_wav(p, s, gains.get(name, 0.5)); ins += ['-i', p]
        # стерео-ширина и пространство: пэды/лид — с ревербом и разносом
        if name in ('pad', 'lead', 'stab'):
            filt.append(f'[{i}:a]aecho=0.8:0.6:{60 if name == "lead" else 90}|{140 if name == "lead" else 210}:0.35|0.25,'
                        f'pan=stereo|c0=c0|c1=c0,stereotools=mlev=1:slev=1.6,volume=1.0[s{i}]')
        else:
            filt.append(f'[{i}:a]pan=stereo|c0=c0|c1=c0[s{i}]')
    mix = ''.join(f'[s{i}]' for i in range(len(T.stems)))
    graph = ';'.join(filt) + f';{mix}amix=inputs={len(T.stems)}:normalize=0,highpass=f=28,' \
        f'lowpass=f=15500,acompressor=threshold=0.3:ratio=2.5:attack=10:release=150,' \
        f'alimiter=limit=0.9,atrim=0:{length:.2f},afade=t=out:st={length - 1.5:.2f}:d=1.5,loudnorm=I=-12:TP=-1:LRA=8[a]'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *ins, '-filter_complex', graph, '-map', '[a]',
                    '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '256k', out], check=True)
    # точная сетка рядом с треком — montage.py не будет её угадывать
    import json
    i_, a_, br_, _ = bars
    json.dump({'bpm': int(bpm), 'beat0': 0.0, 'drops': [i_ * 4, (i_ + a_ + br_) * 4], 'end': sum(bars) * 4},
              open(os.path.splitext(out)[0] + '.json', 'w'))
    return out


if __name__ == '__main__':
    # python3 synth_track.py <mood> <bpm> <key> <out.mp3>
    print(render(sys.argv[4], int(sys.argv[2]), sys.argv[3], seed=sum(map(ord, "".join(sys.argv[1:4]))) % 1000))

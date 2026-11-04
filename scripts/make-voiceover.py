#!/usr/bin/env python3
"""Adds a spoken voiceover and burned-in subtitles to the demo video.

Reads the section clips that make-video.cjs leaves in media/raw/build/ and the lines in
scripts/narration.json. Each line is voiced with edge-tts (Microsoft neural voice), a section
is held on its last frame if the line runs longer than the picture, and the subtitles are
timed to the speech. Writes media/hisaab-demo-voice.mp4 and media/hisaab-demo-voice.srt.
Usage: TTS=/path/to/edge-tts python3 scripts/make-voiceover.py
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'media', 'raw', 'build')
OUT = os.path.join(ROOT, 'media')
TTS = os.environ.get('TTS', 'edge-tts')
LEAD, TAIL = 0.35, 0.6  # silence before and after each line, seconds

def run(*a): subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def dur(p): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).decode())
def ts(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'

def chunks(text, limit=70):
    """Split a line into subtitle-sized pieces at sentence, then word boundaries."""
    out, cur = [], ''
    for word in text.split():
        if cur and len(cur) + 1 + len(word) > limit:
            out.append(cur); cur = word
        else:
            cur = f'{cur} {word}'.strip()
        if cur.endswith(('.', '?', '!')) and len(cur) > 25:
            out.append(cur); cur = ''
    if cur: out.append(cur)
    return out

cfg = json.load(open(os.path.join(ROOT, 'scripts', 'narration.json')))
parts, srt, ass, t0, n = [], [], [], 0.0, 1
def at(t):
    cs = int(round(t * 100)); h, cs = divmod(cs, 360000); m, cs = divmod(cs, 6000); sec, cs = divmod(cs, 100)
    return f'{h}:{m:02}:{sec:02}.{cs:02}'
for i, p in enumerate(cfg['parts']):
    clip = os.path.join(BUILD, p['clip'])
    mp3 = os.path.join(BUILD, f'vo-{i}.mp3')
    run(TTS, '--voice', cfg['voice'], f"--rate={cfg['rate']}", '--text', p['text'], '--write-media', mp3)
    a, v = dur(mp3), dur(clip)
    target = max(v, LEAD + a + TAIL)
    part = os.path.join(BUILD, f'vo-part-{i}.mp4')
    run('ffmpeg', '-y', '-i', clip, '-i', mp3, '-filter_complex',
        f'[0:v]tpad=stop_mode=clone:stop_duration={target - v + 0.05:.3f},trim=duration={target:.3f},setpts=PTS-STARTPTS[v];'
        f'[1:a]adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},apad,atrim=duration={target:.3f},asetpts=PTS-STARTPTS[a]',
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', part)
    parts.append(part)
    # Subtitles: share the speech time across chunks by length.
    pieces = chunks(p['text']); total = sum(len(c) for c in pieces); s = t0 + LEAD
    for c in pieces:
        e = s + a * len(c) / total
        srt.append(f'{n}\n{ts(s)} --> {ts(e)}\n{c}\n'); n += 1
        # App scenes already carry a caption bar at the bottom, so their subtitles go on top.
        ass.append(f"Dialogue: 0,{at(s)},{at(e)},{'Top' if p['clip'].startswith('seg-') else 'Bottom'},,0,0,0,,{c}")
        s = e
    t0 += target
    print(f'{p["clip"]:18} picture {v:5.1f}s  voice {a:5.1f}s  -> {target:5.1f}s', file=sys.stderr)

lst = os.path.join(BUILD, 'vo-list.txt')
open(lst, 'w').write('\n'.join(f"file '{p}'" for p in parts))
joined = os.path.join(BUILD, 'vo-joined.mp4')
run('ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined)
srt_path = os.path.join(OUT, 'hisaab-demo-voice.srt')
open(srt_path, 'w').write('\n'.join(srt))
ass_path = os.path.join(BUILD, 'vo.ass')
st = 'DejaVu Sans,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB4141414,-1,0,0,0,100,100,0,0,3,10,0,{al},40,40,{mv},1'
open(ass_path, 'w').write(f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 800

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Bottom,{st.format(al=2, mv=26)}
Style: Top,{st.format(al=8, mv=14)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + '\n'.join(ass) + '\n')
final = os.path.join(OUT, 'hisaab-demo-voice.mp4')
run('ffmpeg', '-y', '-i', joined, '-vf', f"ass={ass_path}", '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', final)
print(f'{final} · {dur(final):.1f} s · subtitles {srt_path}')

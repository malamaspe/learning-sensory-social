#!/usr/bin/env python3
"""Από μια εγκεκριμένη παρτίδα → αρχεία στο repo (media/<ΕΕΕΕ-ΜΜ>/LS/) + εγγραφές στο queue.json.

    python3 make_queue.py <φάκελος παρτίδας> <φάκελος repo>

Τρέχει ΜΟΝΟ μετά την έγκριση της υπεύθυνης του κέντρου. Δομή παρτίδας:
  <παρτίδα>/LS/<ΕΕΕΕ-ΜΜ-ΗΗ>_post_01.jpg …    εικόνες post (2+ = carousel)
  <παρτίδα>/LS/<ΕΕΕΕ-ΜΜ-ΗΗ>_reel.mp4           reel (στη θέση του post της ημέρας) + προαιρετικά _reel_cover.jpg
  <παρτίδα>/LS/<ΕΕΕΕ-ΜΜ-ΗΗ>_story_01.jpg       story (+ προαιρετικά ίδιο όνομα .mp4 με μουσική από story_video.py)
  <παρτίδα>/captions.json                       'LS|<ημ/νία>' = λεζάντα post/reel
                                                'LS|<ημ/νία>|reel' = {"story": false} αν το reel > 60″
  <παρτίδα>/privacy_manifest.json               από privacy_check.py verify + mark

ΦΡΑΓΜΟΣ: κάθε αρχείο πρέπει να είναι «ok» στο privacy_manifest.json (οπτικά ελεγμένο, χωρίς metadata, ίδιο
sha256). Αλλιώς σταματάει και δεν γράφει τίποτα.
Ώρες (απόφαση 22/11/2026, από το Meta): post/reel 22:00 (Δευ, Τετ, Παρ, Κυρ), story 10:00 κάθε μέρα.
"""
import glob, json, os, shutil, sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from privacy_check import cleared, metadata_problems  # noqa: E402

ATH = ZoneInfo('Europe/Athens')
REPO_RAW = 'https://raw.githubusercontent.com/malamaspe/learning-sensory-social/main/'
ACC = 'LS'
POST_TIME, STORY_TIME = '22:00', '10:00'   # απόφαση 22/11/2026: ώρες μεγαλύτερης δραστηριότητας κοινού (Meta)
POST_DAYS = {0, 2, 4, 6}   # Δευτέρα, Τετάρτη, Παρασκευή, Κυριακή
BANNED = ['συμβεβλημ']     # δεν υπάρχει σύμβαση με τον ΕΟΠΥΥ· γράφουμε «Εξυπηρετούμε γνωματεύσεις ΕΟΠΥΥ»
IG_CAPTION_MAX = 2200


def at(d, hm):
    """Ώρα Αθήνας με τη σωστή μετατόπιση (χειμερινή/θερινή ώρα)."""
    return datetime.fromisoformat(f'{d}T{hm}:00').replace(tzinfo=ATH).isoformat()


def check_caption(cap, where):
    assert cap and cap.strip(), f'{where}: λείπει λεζάντα'
    assert len(cap) <= IG_CAPTION_MAX, f'{where}: λεζάντα {len(cap)} χαρακτήρες (όριο {IG_CAPTION_MAX})'
    low = cap.lower()
    for b in BANNED:
        assert b not in low, f'{where}: απαγορευμένη διατύπωση «{b}…» (δεν υπάρχει σύμβαση ΕΟΠΥΥ)'
    assert cap.count('#') <= 8, f'{where}: πάνω από 8 hashtags'


def build(batch, repo):
    caps = json.load(open(f'{batch}/captions.json', encoding='utf-8'))
    src = f'{batch}/{ACC}'
    files = sorted(glob.glob(f'{src}/*.jpg') + glob.glob(f'{src}/*.mp4'))
    bad = [f for f in files if not cleared(batch, f)]
    if bad:
        sys.exit('ΣΤΑΜΑΤΗΣΑ: αρχεία χωρίς έγκριση απορρήτου (privacy_check.py verify + mark ok):\n  ' +
                 '\n  '.join(os.path.relpath(f, batch) for f in bad))
    meta = [(f, metadata_problems(f)) for f in files]
    meta = [(f, m) for f, m in meta if m]
    if meta:
        sys.exit('ΣΤΑΜΑΤΗΣΑ: metadata σε ' + ', '.join(f'{os.path.basename(f)} ({m})' for f, m in meta))

    items, copies = [], []
    for d in sorted({os.path.basename(f)[:10] for f in files}):
        day = date.fromisoformat(d)
        month = d[:7]
        dst = f'{repo}/media/{month}/{ACC}'
        url = lambda f: f'{REPO_RAW}media/{month}/{ACC}/{os.path.basename(f)}'
        reel = f'{src}/{d}_reel.mp4'
        posts = sorted(glob.glob(f'{src}/{d}_post_*.jpg'))
        stories = sorted(glob.glob(f'{src}/{d}_story_*.jpg'))
        if (os.path.exists(reel) or posts) and day.weekday() not in POST_DAYS:
            print(f'Προσοχή: post στις {d} ({["Δευ","Τρι","Τετ","Πεμ","Παρ","Σαβ","Κυρ"][day.weekday()]}), εκτός Δευ/Τετ/Παρ/Κυρ')
        if os.path.exists(reel):
            check_caption(caps.get(f'{ACC}|{d}'), f'{ACC}|{d}')
            m = caps.get(f'{ACC}|{d}|reel') or {}
            it = {'id': f'{ACC}-{d}-post', 'account': ACC, 'type': 'REEL', 'publish_at': at(d, POST_TIME),
                  'video': url(reel), 'caption': caps[f'{ACC}|{d}']}
            if m.get('story') is False:
                it['story'] = False
            copies.append((reel, dst))
            cover = f'{src}/{d}_reel_cover.jpg'
            if os.path.exists(cover):
                copies.append((cover, dst)); it['cover'] = url(cover)
            items.append(it)
        elif posts:
            check_caption(caps.get(f'{ACC}|{d}'), f'{ACC}|{d}')
            assert len(posts) <= 10, f'{d}: carousel με {len(posts)} εικόνες (όριο 10)'
            copies += [(p, dst) for p in posts]
            items.append({'id': f'{ACC}-{d}-post', 'account': ACC, 'type': 'CAROUSEL' if len(posts) > 1 else 'IMAGE',
                          'publish_at': at(d, POST_TIME), 'images': [url(p) for p in posts], 'caption': caps[f'{ACC}|{d}']})
        for i, s in enumerate(stories):
            it = {'id': f'{ACC}-{d}-story' + (f'-{i + 1}' if i else ''), 'account': ACC, 'type': 'STORY',
                  'publish_at': at(d, STORY_TIME if not i else f'{9 + i * 3:02d}:30'), 'images': [url(s)]}
            copies.append((s, dst))
            mp4 = s[:-4] + '.mp4'
            if os.path.exists(mp4):
                copies.append((mp4, dst)); it['video'] = url(mp4)
            items.append(it)
    # Αν η έγκριση ήρθε αργά: ό,τι έχει ήδη περάσει (ή είναι σε < 20′) ΔΕΝ μπαίνει, ούτε τα αρχεία του.
    soon = datetime.now(ATH) + timedelta(minutes=20)
    late = [i for i in items if datetime.fromisoformat(i['publish_at']) < soon]
    if late:
        print('Παραλείπονται (η ώρα τους πέρασε):', ', '.join(i['id'] for i in late))
    items = [i for i in items if i not in late]
    used = {u.rsplit('/', 1)[-1] for i in items for u in (i.get('images') or []) + [i[k] for k in ('video', 'cover') if i.get(k)]}
    for f, dst in copies:
        if os.path.basename(f) in used:
            os.makedirs(dst, exist_ok=True)
            shutil.copy(f, dst)
    return items


if __name__ == '__main__':
    batch, repo = sys.argv[1], sys.argv[2]
    qpath = f'{repo}/queue.json'
    q = json.load(open(qpath, encoding='utf-8')) if os.path.exists(qpath) else {'version': 1, 'timezone': 'Europe/Athens', 'items': []}
    new = build(batch, repo)
    ids = {i['id'] for i in new}
    q['items'] = [i for i in q['items'] if i['id'] not in ids] + new
    q['items'].sort(key=lambda i: i['publish_at'])
    json.dump(q, open(qpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(len(new), 'εγγραφές προστέθηκαν ·', len(q['items']), 'συνολικά στην ουρά')

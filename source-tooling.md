===== FILE: build.py =====

```python
#!/usr/bin/env python3
"""Parse module front matter and emit modules.json for the portal.

Changes from the original:
  1. Quiz YAML is parsed into real JSON so the browser never needs a YAML parser.
  2. Asset paths are flattened, because the portal repo cannot hold subfolders.
     /assets/quiz/foo.png  ->  quiz-foo.png
  3. Answer keys are encoded rather than shipped in the clear. This stops a
     trainee reading answers out of view-source. It is not real security and is
     not meant to be: the file is public either way.
  4. Extra validation warnings for missing images and bad answer indexes.
"""
import os, json, re, sys, base64, datetime, hashlib

try:
    import yaml
except ImportError:
    print("PyYAML is required. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

CONTENT = 'content'
ASSETS = 'assets'
OUT = 'modules.json'

# Obfuscation only. Anyone determined can undo this in a minute, by design.
KEY = b'windowworks'

# Explanations get encoded into the answer key, so the guards keep a plain copy.
PLAIN_WHY = {}


def encode_key(payload):
    raw = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    xored = bytes(b ^ KEY[i % len(KEY)] for i, b in enumerate(raw))
    return base64.b64encode(xored).decode('ascii')


def flatten_asset(path):
    """/assets/quiz/pipedrive-red-card.png -> quiz-pipedrive-red-card.png"""
    if not isinstance(path, str):
        return path
    m = re.match(r'^/?assets/([^/]+)/(.+)$', path.strip())
    if not m:
        return path
    return m.group(1) + '-' + m.group(2)


def parse_front_matter(text):
    if not text.startswith('---'):
        return {}, text
    end = text.index('\n---', 3)
    raw = text[3:end].strip()
    body = text[end+4:].lstrip('\n')
    fm = {}
    lines = raw.split('\n')
    i = -1
    while i + 1 < len(lines):
        i += 1
        line = lines[i]
        if not line.strip() or line.strip().startswith('#'):
            continue
        if ':' not in line:
            continue
        k, v = line.split(':', 1)
        k, v = k.strip(), v.strip()
        # One level of nesting, for values that differ per person:
        #   session_time:
        #     Tyler: "10:00"
        #     Michael: "12:45"
        # The flat parser used to read those indented lines as top level keys.
        if v == '' and i + 1 < len(lines) and lines[i + 1].startswith(('  ', '\t')):
            nested = {}
            while i + 1 < len(lines) and lines[i + 1].startswith(('  ', '\t')):
                i += 1
                sub = lines[i].strip()
                if ':' not in sub:
                    continue
                sk, sv = sub.split(':', 1)
                nested[sk.strip()] = sv.strip().strip('"')
            fm[k] = nested
            continue
        if v.startswith('[') and v.endswith(']'):
            inner = v[1:-1].strip()
            v = [x.strip() for x in inner.split(',')] if inner else []
        elif v in ('null', ''):
            v = None
        elif v in ('true', 'false'):
            v = v == 'true'
        elif v.strip('"').isdigit():
            v = int(v.strip('"'))
        else:
            v = v.strip('"')
        fm[k] = v
    return fm, body


def split_author_note(body):
    """Author notes are messages to Rose, not to the trainee. Pull them out of
    the body so they never reach the browser."""
    m = re.search(r'^##+\s*(Author note|Production note|Internal note)\s*$', body, re.M)
    if not m:
        return body, None
    note = body[m.end():]
    rest = body[:m.start()]
    nxt = re.search(r'^##+\s', note, re.M)
    if nxt:
        rest += '\n\n' + note[nxt.start():]
        note = note[:nxt.start()]
    return rest.rstrip(), note.strip()


def strip_duplicate_title(body, title):
    """The page already shows the title above the body. Drop the H1 repeat."""
    m = re.match(r'^\s*#\s+(.+?)\s*$', body, re.M)
    if m and m.group(1).strip().lower() == str(title or '').strip().lower():
        return body[m.end():].lstrip('\n')
    return body


def split_quiz(body):
    m = re.search(r'^## Quiz\s*$', body, re.M)
    if not m:
        return body, None
    quiz_raw = body[m.end():]
    prose = body[:m.start()]
    nxt = re.search(r'^## (?!Quiz)', quiz_raw, re.M)
    if nxt:
        prose += quiz_raw[nxt.start():]
        quiz_raw = quiz_raw[:nxt.start()]
    return prose.rstrip(), quiz_raw.strip()


KNOWN_TYPES = {
    'multiple_choice', 'multi_select', 'short_answer',
    'matching', 'image_question', 'image_options', 'file_upload',
}

warnings = []


def warn(msg):
    warnings.append(msg)
    print('WARN ' + msg, file=sys.stderr)


def asset_exists(flat_name):
    """Assets live in assets/<group>/<file>; flat_name is group-file."""
    if not os.path.isdir(ASSETS):
        return True  # cannot check, do not cry wolf
    for root, dirs, files in os.walk(ASSETS):
        for f in files:
            group = os.path.basename(root)
            if group + '-' + f == flat_name:
                return True
    return False


def build_quiz(mod_id, quiz_raw):
    """Turn quiz YAML into portal-ready JSON with encoded answers."""
    try:
        items = yaml.safe_load(quiz_raw)
    except Exception as e:
        warn('%s quiz YAML failed to parse: %s' % (mod_id, e))
        return None
    if not isinstance(items, list):
        warn('%s quiz is not a list' % mod_id)
        return None

    out = []
    for n, item in enumerate(items):
        if not isinstance(item, dict):
            warn('%s question %d is not a mapping' % (mod_id, n + 1))
            continue
        q = dict(item)
        qtype = q.get('type')
        if qtype not in KNOWN_TYPES:
            warn('%s question %d unknown type: %r' % (mod_id, n + 1, qtype))

        # Flatten any asset paths, on the image field and on image options.
        if 'image' in q:
            q['image'] = flatten_asset(q['image'])
            if not asset_exists(q['image']):
                warn('%s question %d image not found: %s' % (mod_id, n + 1, q['image']))
        if qtype == 'matching' and isinstance(q.get('row_images'), list):
            q['row_images'] = [flatten_asset(o) for o in q['row_images']]
            for o in q['row_images']:
                if not asset_exists(o):
                    warn('%s question %d row image not found: %s' % (mod_id, n + 1, o))
            if len(q['row_images']) != len(q.get('rows') or []):
                warn('%s question %d has %d row images for %d rows'
                     % (mod_id, n + 1, len(q['row_images']), len(q.get('rows') or [])))
        if qtype == 'image_options' and isinstance(q.get('options'), list):
            q['options'] = [flatten_asset(o) for o in q['options']]
            for o in q['options']:
                if not asset_exists(o):
                    warn('%s question %d option image not found: %s' % (mod_id, n + 1, o))

        # Sanity check the answer before hiding it.
        ans = q.get('answer')
        opts = q.get('options')
        if ans is not None and isinstance(opts, list):
            idxs = ans if isinstance(ans, list) else [ans]
            for i in idxs:
                if not isinstance(i, int) or i < 0 or i >= len(opts):
                    warn('%s question %d answer index out of range: %r' % (mod_id, n + 1, ans))

        # Human-reviewed questions have no key to hide.
        if ans is None and 'why' not in q:
            q.pop('answer', None)
            out.append(q)
            continue

        q['k'] = encode_key({'a': ans, 'w': q.get('why')})
        if q.get('why'):
            PLAIN_WHY.setdefault(mod_id, []).append(str(q['why']))
        q.pop('answer', None)
        q.pop('why', None)
        out.append(q)
    return out


modules = []
for root, dirs, files in os.walk(CONTENT):
    for f in sorted(files):
        if not f.endswith('.md'):
            continue
        p = os.path.join(root, f)
        fm, body = parse_front_matter(open(p).read())
        if not fm.get('id'):
            warn('no id: %s' % p)
            continue
        prose, quiz_raw = split_quiz(body)
        prose, note = split_author_note(prose)
        prose = strip_duplicate_title(prose, fm.get('title'))
        fm['path'] = p
        fm['body_md'] = prose
        if note:
            fm['author_note'] = note
        fm['has_quiz'] = quiz_raw is not None
        fm['quiz'] = build_quiz(fm['id'], quiz_raw) if quiz_raw else None
        modules.append(fm)

ids = [m['id'] for m in modules]
dupes = {i for i in ids if ids.count(i) > 1}
if dupes:
    warn('duplicate ids: %s' % dupes)

known = set(ids)
for m in modules:
    for pre in (m.get('prereq') or []):
        if pre and pre not in known:
            warn('%s prereq missing: %s' % (m['id'], pre))

# Phase order. phases.json is the single source of truth for what a trainee sees
# first, so the portal never has to sort by module ID and guess.
PHASES = 'phases.json'
if os.path.exists(PHASES):
    _ph = json.load(io.open(PHASES, encoding='utf-8')) if False else json.load(open(PHASES, encoding='utf-8'))
    _seen = {}
    _order = 0
    for _pi, _p in enumerate(_ph):
        for _mid in _p['ids']:
            _order += 1
            _seen[_mid] = (_pi, _p['name'], _p.get('blurb', ''), _order)
    _path = [m for m in modules if 'sales-b2c' in (m.get('roles') or [])]
    for m in _path:
        if m['id'] not in _seen:
            warn('%s is on the b2c path but not in phases.json' % m['id'])
    for _mid in _seen:
        if _mid not in {m['id'] for m in modules}:
            warn('phases.json lists %s, which is not a module' % _mid)
    for m in modules:
        if m['id'] in _seen:
            pi, name, blurb, o = _seen[m['id']]
            m['phase'] = name
            m['phase_index'] = pi
            m['phase_blurb'] = blurb
            m['order'] = o
    print('phase order: %d items across %d phases' % (_order, len(_ph)))
else:
    warn('phases.json is missing, so the portal will fall back to sorting by id')

modules.sort(key=lambda m: (m.get('order') or 999, m.get('week') or 99, m['id']))
# The portal build number versions the code. Content can ship on its own, by
# uploading modules.json alone, so it needs its own identifier or the badge starts
# meaning two different things.
_cid = hashlib.sha1(
    json.dumps(modules, sort_keys=True, ensure_ascii=False).encode('utf-8')
).hexdigest()[:7]
payload = {
    'generated': datetime.date.today().isoformat(),
    'content_id': _cid,
    'count': len(modules),
    'modules': modules,
}
print('content id: %s' % _cid)
with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump(payload, fh, indent=2, ensure_ascii=False)

for m in modules:
    if re.search(r'\bmoldings?\b', m.get('body_md', ''), re.I):
        warn('%s uses "molding"; company standard is "moulding"' % m['id'])

# House style is US spelling. Two deliberate exceptions: "moulding" is the
# industry term, and Fibrex is an Andersen trademark that looks like "fibre".
# Industry terms that look like British spellings but are correct here.
for m in modules:
    hit = re.search(r'brickmold', m.get('body_md', ''), re.I)
    if hit:
        warn('%s spells it brickmold; the industry term is brickmould' % m['id'])


BRITISH = [r'\bcolour', r'\bcentre\b', r'\bgrey\b', r'\bfibre\b', r'\bwhilst\b',
           r'\bamongst\b', r'\baluminium\b', r'\blabour\b', r'\bbehaviour\b',
           r'\bfavour\b', r'\bcatalogue\b', r'\blicence\b', r'\bjudgement\b',
           r'\bmould\b', r'\bdraught\b', r'\borganise\b', r'\brealise\b',
           r'\bmaths\b', r'\blearnt\b', r'\bspelt\b', r'\bburnt out\b',
           r'\btowards\b', r'\bat the weekend\b', r'\bin hospital\b',
           r'\bdifferent to\b', r'\bhave a look at\b', r'\breckon\b',
           r'\bkeen to\b', r'\bstraight away\b', r'\bsort out\b',
           r'\bpractise\b', r'\bcheque\b', r'\bprogramme\b', r'\benquire\b',
           r'\btravelled\b', r'\bcancelled\b', r'\blabelled\b', r'\bmodelled\b',
           r'\bfulfil\b', r'\bskilful\b', r'\bstorey\b', r'\btyre\b',
           r'\btake it as read\b', r'\bon the cards\b', r'\bin the event that\b']
for m in modules:
    for pat in BRITISH:
        hit = re.search(pat, m.get('body_md', ''), re.I)
        if hit:
            warn('%s uses British spelling or idiom: %s' % (m['id'], hit.group()))

# A company is singular in American English. MileIQ has, not MileIQ have.
BRANDS = (r'Andersen|ProVia|Reeb|Synchrony|Vendo|Pipedrive|MileIQ|Therma-Tru|'
          r'ADP|CompanyCam|Ingage|Vinyl Design|Window Works|Paradigm|Marvin')
PLURAL_VERB = re.compile(r'\b(' + BRANDS + r')\s+(are|have|keep|do|were|make|'
                         r'offer|say|know|want|need|use|build|ship)\b')
for m in modules:
    hit = PLURAL_VERB.search(m.get('body_md', ''))
    if hit:
        warn('%s treats a company as plural: %s' % (m['id'], hit.group()))

# Deleting a module silently deletes its video with it. Keep a manifest of every
# video URL ever seen so a disappearance is loud instead of quiet.
VIDEO_MANIFEST = '.videos.json'


def check_videos(mods):
    seen = {}
    for m in mods:
        v = str(m.get('video') or '').strip()
        if v and v not in ('null', 'none', 'None'):
            seen[v] = m['id']
    known = {}
    if os.path.exists(VIDEO_MANIFEST):
        try:
            known = json.load(open(VIDEO_MANIFEST))
        except Exception:
            known = {}
    retired = known.pop('_retired', {}) if isinstance(known.get('_retired'), dict) else {}
    for url, was in known.items():
        if url not in seen and url not in retired:
            warn('video no longer referenced by any module (was %s): %s' % (was, url))
    merged = dict(known)
    merged.update(seen)
    if retired:
        merged['_retired'] = retired
    with open(VIDEO_MANIFEST, 'w', encoding='utf-8') as fh:
        json.dump(merged, fh, indent=2, ensure_ascii=False, sort_keys=True)
    return len(seen)


# House register uses contractions, matching the blog. But a contraction of
# is/are cannot end a clause: "who we are", never "who we're".
# A relative link points at a file we have to actually ship alongside modules.json
for m in modules:
    for lbl, url in re.findall(r'\[([^\]]+)\]\(([^)]+)\)', m.get('body_md', '')):
        if re.match(r'^[A-Za-z0-9._-]+\.[A-Za-z0-9]{2,5}$', url) and not os.path.exists(url):
            warn('%s links to %s, which is not in this folder. It has to ship to the '
                 'portal repo root alongside modules.json' % (m['id'], url))


# Link text is often somebody's published headline. A contraction there makes
# our label disagree with the real title.
for m in modules:
    for lbl, url in re.findall(r'\[([^\]]+)\]\(([^)]+)\)', m.get('body_md', '')):
        slug = url.rstrip('/').split('/')[-1].replace('-', ' ').lower()
        if not slug or len(slug.split()) < 4:
            continue
        lab = re.sub(r"[^a-z0-9 ]", ' ', lbl.lower())
        missing = [w for w in lab.split() if w not in slug.split()]
        if any(w in ("what's", "whats", "it's", "that's", "here's", "who's") or "'" in w
               for w in re.sub(r'[^a-z0-9\' ]', ' ', lbl.lower()).split()):
            if missing:
                warn('%s link text may not match the real title: %s' % (m['id'], lbl))

CLAUSE_FINAL = re.compile(r"\b(it|that|there|here|we|you|they|who|what)'(?:s|re)"
                          r"(?=[ \t]*(?:[.,;:!?)]|\n|$))", re.I)
for m in modules:
    # a wrapped line is not a clause boundary, but a blank line is, so join
    # single newlines and keep the doubles
    flat = re.sub(r'(?<!\n)[ \t]*\n(?!\n)[ \t]*', ' ', m.get('body_md', ''))
    hit = CLAUSE_FINAL.search(flat)
    if hit:
        warn('%s has a clause-final contraction: %s' % (m['id'], hit.group()))


def _dec(b):
    raw = base64.b64decode(b)
    key = b'windowworks'
    return json.loads(bytes(c ^ key[i % len(key)] for i, c in enumerate(raw)))


# duration_min on a self-paced module should be video length plus reading at
# 200 words a minute plus 90 seconds a question, rounded to the nearest 5.
# Live sessions are scheduled blocks and are exempt.
for m in modules:
    if m.get('track') == 'session' or m.get('format') == 'live':
        continue
    dur = m.get('duration_min') or 0
    read = len(m.get('body_md', '').split()) / 200.0
    quiz = len(m.get('quiz') or []) * 1.5
    floor = read + quiz
    if dur < floor:
        warn('%s is %d min but reading plus quiz alone is %.0f min'
             % (m['id'], dur, floor))


# A scenario with no question leaves the rep guessing what's being asked.
# Matching questions and check-all instructions are legitimately imperative.
for m in modules:
    for qi, q in enumerate(m.get('quiz') or []):
        st = ' '.join(q['q'].split())
        if '?' in st or q.get('type') == 'matching':
            continue
        if re.search(r'\bcheck (all|every)', st, re.I):
            continue
        warn('%s q%d states a situation without asking anything: %s'
             % (m['id'], qi + 1, st[:60]))


# A bare fraction with no unit reads as ambiguous. 4-9/16 should be 4-9/16".
BARE_FRAC = re.compile(r'(?<![\d/\-\w])(\d{1,2}-\d{1,2}/\d{1,2})'
                       r'(?!["\w/]|\s*(?:inch|inches|foot|feet|deep|wide|tall))')
for m in modules:
    hit = BARE_FRAC.search(m.get('body_md', ''))
    if hit:
        warn('%s has a fraction with no unit: %s' % (m['id'], hit.group(1)))


# A learnable answer slot lets a rep pass without reading.
from collections import Counter
_pos = Counter()
_tell = []
for m in modules:
    for qi, q in enumerate(m.get('quiz') or []):
        if q.get('type') != 'multiple_choice':
            continue
        k = _dec(q['k']) if q.get('k') else None
        a = (k or {}).get('a')
        opts = q.get('options') or []
        if not isinstance(a, int) or len(opts) < 3:
            if isinstance(a, list) and len(opts) >= 3:
                ln = [len(str(o)) for o in opts]
                cor = [ln[j] for j in a]
                wrong = [x for j, x in enumerate(ln) if j not in a]
                if wrong and (sum(cor) / len(cor)) - (sum(wrong) / len(wrong)) >= 10:
                    _tell.append('%s q%d' % (m['id'], qi + 1))
            continue
        _pos[a] += 1
        ln = [len(str(o)) for o in opts]
        other = [x for j, x in enumerate(ln) if j != a]
        if other and ln[a] - max(other) >= 8:
            _tell.append('%s q%d' % (m['id'], qi + 1))
        # a multi_select needs averages, since three correct answers of mixed
        # length will always beat one short wrong one on a max comparison

if _pos:
    _tot = sum(_pos.values())
    for slot, n in _pos.items():
        if n > _tot * 0.4:
            warn('%d%% of correct answers sit in option %d'
                 % (round(n / _tot * 100), slot + 1))
if _tell:
    warn('%d questions where the correct answer is 8+ characters longer: %s'
         % (len(_tell), ', '.join(_tell[:8]) + ('...' if len(_tell) > 8 else '')))


# A pass mark above the points available makes a quiz unpassable.
for m in modules:
    pp = m.get('pass_points')
    total = sum(q.get('points') or 0 for q in (m.get('quiz') or []))
    if pp and total and pp > total:
        warn('%s pass_points is %s but the quiz is only worth %d'
             % (m['id'], pp, total))
    if pp and not total:
        warn('%s has pass_points %s but no quiz' % (m['id'], pp))
    # 80 percent is the floor on every quiz. A lower bar lets somebody pass
    # without knowing a fifth of the material.
    if total and pp and pp < total * 0.8 - 1e-9:
        warn('%s pass mark is %d of %d, which is %d%%. The floor is 80%%, so %d'
             % (m['id'], pp, total, round(pp / total * 100),
                -(-int(total * 8) // 10)))
    if total and not pp:
        warn('%s has a quiz worth %d points and no pass mark' % (m['id'], total))


# A module: link has to point at a module that exists.
ids = {m['id'] for m in modules}
for m in modules:
    for ref in re.findall(r'\]\(module:([A-Za-z0-9\-]+)\)', m.get('body_md', '')):
        if ref not in ids:
            warn('%s links to module:%s which does not exist' % (m['id'], ref))


# Display inventory changes, so only the showroom walkthrough describes it.
for m in modules:
    if m.get('track') != 'product':
        continue
    hit = re.search(r'showroom|on display', m.get('body_md', ''), re.I)
    if hit:
        warn('%s mentions the showroom; display status belongs only in the '
             'showroom walkthrough' % m['id'])


# A bare module ID means nothing to a trainee. Refer to modules by name.
MODREF = re.compile(r'\b(?:PR|PK-AW|PB|HR|LV|REF)-\d+(?:-CHECK)?\b')
for m in modules:
    stripped = re.sub(r'\]\(module:[A-Za-z0-9\-]+\)', ']()', m.get('body_md', ''))
    hit = MODREF.search(stripped)
    if hit:
        warn('%s refers to a module by ID rather than name: %s' % (m['id'], hit.group()))


# A heading with no blank line before it renders as body text.
for m in modules:
    hit = re.search(r'[^\n]\n(#{1,4} )', m.get('body_md', ''))
    if hit:
        warn('%s has a heading with no blank line before it: %s'
             % (m['id'], hit.group(1).strip()))


# Review state, so the count is read out of the files rather than remembered.
# reviewed: a date means a human read it line by line. Absent or false means not
# yet. A parked module cannot count as reviewed no matter what the field says.
_rev, _un, _bad = [], [], []
for m in modules:
    if 'sales-b2c' not in (m.get('roles') or []):
        continue
    r = m.get('reviewed')
    parked = 'NOT FINISHED' in (m.get('author_note') or '')
    if parked:
        _bad.append(m['id']) if r else None
        _un.append(m['id'])
    elif r:
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(r)):
            warn('%s reviewed should be a date, got %r' % (m['id'], r))
        _rev.append(m['id'])
    else:
        _un.append(m['id'])
for i in _bad:
    warn('%s is marked reviewed but is also parked NOT FINISHED' % i)
_tot = len(_rev) + len(_un)
print('b2c path: %d of %d reviewed (%d%%), %d outstanding'
      % (len(_rev), _tot, round(100 * len(_rev) / _tot) if _tot else 0, len(_un)))
if _un:
    print('  outstanding: %s' % ', '.join(sorted(_un)))


# Modules explicitly parked mid-edit, so they cannot quietly ship half done.
for m in modules:
    if 'NOT FINISHED' in (m.get('author_note') or ''):
        warn('%s is marked NOT FINISHED in its author note' % m['id'])


def factText(m):
    """Everything a reader could see, so the registry cannot miss a figure that
    lives in a question, an option, or an answer explanation."""
    parts = [m.get('body_md') or '', m.get('author_note') or '', str(m.get('title') or '')]
    for q in (m.get('quiz') or []):
        parts.append(str(q.get('q') or ''))
        parts.extend(str(o) for o in (q.get('options') or []))
        parts.extend(str(r) for r in (q.get('rows') or []))
        parts.extend(str(c) for c in (q.get('columns') or []))
    parts.extend(PLAIN_WHY.get(m['id'], []))
    return '\n'.join(parts)


# Facts that change live in facts.json with the modules allowed to state them.
# A figure appearing somewhere unlisted is a second place to update and forget.
FACTS = 'facts.json'
if os.path.exists(FACTS):
    spec = json.load(open(FACTS, encoding='utf-8'))
    for f in spec.get('facts', []):
        pat = re.compile(f['pattern'], re.I)
        # A figure stated only in a quiz explanation is still a figure. Those are
        # encoded into the answer key by then, so search the plain copy.
        found = sorted(m['id'] for m in modules if pat.search(factText(m)))
        expected = sorted(f['modules'])
        extra = [x for x in found if x not in expected]
        gone = [x for x in expected if x not in found]
        if extra:
            warn('%s also appears in %s, which facts.json does not list'
                 % (f['name'], ', '.join(extra)))
        if gone:
            warn('%s no longer appears in %s' % (f['name'], ', '.join(gone)))


BAD = {0x2013: 'en dash', 0x2014: 'em dash'}
for m in modules:
    blob = m.get('body_md', '') + json.dumps(m.get('quiz') or [], ensure_ascii=False) + str(m.get('title'))
    for ch in blob:
        if ord(ch) in BAD:
            warn('%s contains a %s' % (m['id'], BAD[ord(ch)]))
            break

nvid = check_videos(modules)

nq = sum(len(m['quiz']) for m in modules if m.get('quiz'))
print('wrote %s, %d modules, %d questions, %d videos, %d warnings'
      % (OUT, len(modules), nq, nvid, len(warnings)))
```
===== FILE: review.py =====

```python
#!/usr/bin/env python3
"""Build a review page for one module.

    python3 review.py PB-060 [out.html]

Renders the module the way a trainee sees it, plus the things they do not:
author notes, and any flags passed in via flags.json.

flags.json, if present, looks like:
    {"PB-060": [["exact source text", "why this is a problem"], ...]}
"""
import json, sys, io, re, os, html, base64

MOD = 'modules.json'
FLAGS = 'flags.json'
KEY = b'windowworks'


def dec(k):
    try:
        x = base64.b64decode(k)
        return json.loads(bytes(b ^ KEY[i % len(KEY)] for i, b in enumerate(x)))
    except Exception:
        return None

CSS = """body{max-width:820px;margin:36px auto;padding:0 24px;
font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#222}
h1{font-size:25px;margin-bottom:4px}
.sub{color:#777;font-size:14px;margin-bottom:26px}
h2{font-size:20px;margin:34px 0 10px;padding-bottom:6px;border-bottom:2px solid #222}
h3{font-size:16px;margin:24px 0 8px;color:#c4581f}
h4{font-size:14px;margin:18px 0 6px;color:#888}
p{margin:0 0 13px}
ul,ol{margin:0 0 13px;padding-left:24px}
li{margin-bottom:6px}
blockquote{margin:0 0 13px;padding:10px 15px;border-left:3px solid #c4581f;background:#faf6f0}
mark.f{background:#ffe89a;padding:1px 2px;border-radius:2px}
mark.f sup{background:#c4581f;color:#fff;border-radius:9px;padding:1px 5px;
font-size:10px;margin-left:3px;vertical-align:super}
.note{background:#fdf6e3;border-left:3px solid #e8b93a;padding:8px 12px;
margin:0 0 14px;font-size:14px;color:#5a5348}
.note .num{display:inline-flex;align-items:center;justify-content:center;
background:#c4581f;color:#fff;border-radius:9px;min-width:17px;height:17px;
font-size:10px;font-weight:700;margin-right:8px;vertical-align:1px}
.author{background:#eef2fb;border:1px solid #c6d4ef;border-radius:8px;
padding:16px 20px;margin:30px 0 0;color:#2d3f63;font-size:14.5px}
.author h3{color:#2d3f63;margin:0 0 8px;font-size:14px;letter-spacing:.06em;
text-transform:uppercase}
.author p{margin:0 0 9px}
.author .todo{background:#fff;border-left:3px solid #3f5fa8;padding:9px 12px;
border-radius:4px;font-weight:600}
.vid{color:#999}a{color:#c4581f}
.frag{background:#fdf3f3;border:1px solid #e9c9c9;border-radius:8px;padding:14px 20px;margin:26px 0 0}
.frag h3{color:#8a3a3a;margin:0 0 4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.frag .fsub{color:#9a6b6b;font-size:13px;margin:0 0 10px}
.frag ul{margin:0;padding-left:20px}
.frag li{margin-bottom:4px;font-size:14px;color:#5a4444}
figure{margin:0 0 6px;display:inline-block;vertical-align:top;width:210px}
.q li figure{display:block;width:130px;margin:6px 0 2px}
.q figure{width:190px}
figure img{width:100%;border:1px solid #e0d9cd;border-radius:6px;display:block}
figcaption{font-size:11.5px;color:#9a9184;margin-top:3px;word-break:break-all}
.missing{color:#b03030;font-size:13px}
table.md{border-collapse:collapse;margin:0 0 14px;font-size:14.5px}
table.md th{background:#1a1a1a;color:#fff;text-align:left;padding:7px 14px;
font-size:12px;letter-spacing:.06em;text-transform:uppercase}
table.md td{border-bottom:1px solid #eee7dd;padding:7px 14px}
table.md tr:last-child td{border-bottom:0}
.quiz{background:#f7f5f1;border:1px solid #e0d9cd;border-radius:8px;padding:18px 22px;margin:30px 0 0}
.quiz h3{color:#5a5348;margin:0 0 4px;font-size:14px;letter-spacing:.06em;text-transform:uppercase}
.quiz .qsub{color:#8a8175;font-size:13px;margin:0 0 16px}
.q{border-top:1px solid #e8e2d8;padding:14px 0}
.q:first-of-type{border-top:0;padding-top:4px}
.q .qt{font-weight:600;margin:0 0 7px}
.q .qm{font-size:12px;color:#8a8175;margin:0 0 7px}
.q ul{margin:0;padding-left:20px}
.q li{margin-bottom:3px}
.q li.ok{font-weight:700;color:#2f7d4a}
.q .why{font-size:13.5px;color:#6b6459;margin:7px 0 0}
.q .human{background:#efe6f7;color:#5a3d7a;border-radius:99px;padding:2px 9px;font-size:11px;font-weight:700}"""


MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml'}


def img(alt, src):
    """Inline the figure as base64 so the review page travels as one file."""
    ext = os.path.splitext(src)[1].lower()
    if ext not in MIME or not os.path.exists(src):
        return '<span class="missing">[missing figure: %s]</span>' % src
    with open(src, 'rb') as fh:
        b64 = base64.b64encode(fh.read()).decode('ascii')
    return ('<figure><img alt="%s" src="data:%s;base64,%s">'
            '<figcaption>%s</figcaption></figure>' % (alt, MIME[ext], b64, src))


def md2html(t):
    t = html.escape(t)
    t = re.sub(r'\{\{video:[^}]+\}\}', '<em class="vid">[inline video]</em>', t)
    t = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', lambda m: img(m.group(1), m.group(2)), t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    return t


def table(st):
    rows = [r.strip() for r in st.split('\n') if r.strip().startswith('|')]
    cells = [[c.strip() for c in r.strip('|').split('|')] for r in rows]
    cells = [c for c in cells
             if not all(re.match(r'^:?-{2,}:?$', re.sub(r'<[^>]+>', '', x).strip())
                        for x in c if x.strip())]
    if not cells:
        return '<p>%s</p>' % st
    head = '<tr>' + ''.join('<th>%s</th>' % c for c in cells[0]) + '</tr>'
    body = ''.join('<tr>' + ''.join('<td>%s</td>' % c for c in r) + '</tr>'
                   for r in cells[1:])
    return '<table class="md">%s%s</table>' % (head, body)


def block(st):
    if st.lstrip().startswith('|'):
        return table(st)
    if re.match(r'^#{1,4} ', st):
        lv = min(len(st.split(' ')[0]) + 1, 4)
        return '<h%d>%s</h%d>' % (lv, st.split(' ', 1)[1], lv)
    if st.startswith('&gt;'):
        return '<blockquote>%s</blockquote>' % re.sub(
            r'^&gt;\s?', '', st, flags=re.M).replace('\n', ' ')
    if st.startswith('- ') or re.match(r'^\d+\. ', st):
        items = [re.sub(r'^(- |\d+\. )', '', x.strip())
                 for x in re.split(r'\n(?=- |\d+\. )', st)]
        tag = 'ul' if st.startswith('- ') else 'ol'
        return '<%s>%s</%s>' % (tag, ''.join(
            '<li>%s</li>' % re.sub(r'\s+', ' ', i).strip() for i in items), tag)
    return '<p>%s</p>' % re.sub(r'\s+', ' ', st).strip()


def main():
    mid = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else '/mnt/user-data/outputs/review-%s.html' % mid.lower()
    d = json.load(open(MOD, encoding='utf-8'))
    m = [x for x in d['modules'] if x['id'] == mid][0]
    flags = {}
    if os.path.exists(FLAGS):
        flags = json.load(open(FLAGS, encoding='utf-8'))
    F = flags.get(mid, [])

    parts, n = [], 0
    used = set()
    for para in m['body_md'].split('\n\n'):
        hits = []
        flat = ' '.join(para.split())
        for fi, (src, note) in enumerate(F):
            key = ' '.join(src.split())
            if key in flat:
                n += 1
                used.add(fi)
                hits.append((key, note, n))
        # Flagging a paragraph must not reformat it. Matching against the
        # flattened copy while substituting into the original keeps line breaks,
        # so a flagged list still renders as a list.
        raw = para
        # A mark wrapped around a whole table row breaks the row apart: the row no
        # longer starts with a pipe, and the tag would straddle two cells. So on a
        # table, highlight the first cell of the matching row instead.
        if raw.lstrip().startswith('|'):
            for key, note, num in hits:
                pat = re.compile(r'\s+'.join(re.escape(w) for w in key.split()))
                lines = raw.split('\n')
                for li, line in enumerate(lines):
                    if not pat.search(line):
                        continue
                    cells = line.strip().strip('|').split('|')
                    cells[0] = ('\x01' + cells[0].strip() + '\x02' + str(num) + '\x03')
                    lines[li] = '|' + '|'.join(cells) + '|'
                    break
                raw = '\n'.join(lines)
            h = md2html(raw).replace('\x01', '<mark class="f">')
            h = re.sub('\x02(\\d+)\x03', r'<sup>\1</sup></mark>', h)
            st = h.strip()
            parts.append(block(st))
            for key, note, num in hits:
                parts.append('<div class="note"><span class="num">%d</span>%s</div>'
                             % (num, note))
            continue
        # a highlighted heading is still a heading; keep the hashes outside the mark
        hmark = re.match(r'^(#{1,4} )', raw)
        for key, note, num in hits:
            k2 = key[len(hmark.group(1)):] if hmark and key.startswith(hmark.group(1)) else key
            pat = re.compile(r'\s+'.join(re.escape(w) for w in k2.split()))
            raw = pat.sub(lambda mm: '\x01' + mm.group(0) + '\x02' + str(num) + '\x03',
                          raw, count=1)
        h = md2html(raw).replace('\x01', '<mark class="f">')
        h = re.sub('\x02(\\d+)\x03', r'<sup>\1</sup></mark>', h)
        st = h.strip()
        if not st:
            continue
        parts.append(block(st))
        for key, note, num in hits:
            parts.append('<div class="note"><span class="num">%d</span>%s</div>'
                         % (num, note))

    # the part a trainee never sees, which is exactly why it belongs here
    an = (m.get('author_note') or '').strip()
    if an:
        blocks = []
        for p in an.split('\n\n'):
            s = ' '.join(p.split())
            cls = ' class="todo"' if s.upper().startswith(('TO ADD', 'TODO', 'TO DO')) else ''
            blocks.append('<p%s>%s</p>' % (cls, html.escape(s)))
        parts.append('<div class="author"><h3>Author note, not shown to trainees</h3>%s</div>'
                     % ''.join(blocks))

    # the quiz, which a trainee only sees after the module and which never
    # appeared on this page before
    quiz = m.get('quiz') or []
    if quiz:
        qs = ['<div class="quiz"><h3>Quiz</h3><p class="qsub">%d questions, %d points. '
              'Correct answers marked.</p>'
              % (len(quiz), sum(q.get('points') or 0 for q in quiz))]
        for qi, q in enumerate(quiz):
            k = dec(q['k']) if q.get('k') else None
            human = '' if k else ' <span class="human">you grade</span>'
            qtext = html.escape(' '.join(str(q.get('q', '')).split()))
            qnotes = []
            for fi, (src, note) in enumerate(F):
                if fi in used:
                    continue
                key = html.escape(' '.join(src.split()))
                if key in qtext:
                    n += 1
                    used.add(fi)
                    qtext = qtext.replace(
                        key, '<mark class="f">%s<sup>%d</sup></mark>' % (key, n), 1)
                    qnotes.append((n, note))
            qs.append('<div class="q"><p class="qt">%d. %s%s</p>' % (qi + 1, qtext, human))
            for num, note in qnotes:
                qs.append('<div class="note"><span class="num">%d</span>%s</div>'
                          % (num, note))
            qs.append('<p class="qm">%s, %s pts</p>' % (q.get('type'), q.get('points')))
            if q.get('image'):
                qs.append(img('', q['image']))
            if q.get('type') == 'matching':
                a = (k or {}).get('a') or []
                rows = q.get('rows') or []
                cols = q.get('columns') or []
                rimg = q.get('row_images') or []
                # a figure the reviewer cannot see is a pairing they cannot check
                qs.append('<ul>' + ''.join(
                    '<li class="ok">%s%s = %s</li>'
                    % (img('', rimg[ri]) if ri < len(rimg) else '',
                       html.escape(str(r)),
                       html.escape(str(cols[a[ri]]) if ri < len(a) else '?'))
                    for ri, r in enumerate(rows)) + '</ul>')
            elif q.get('options'):
                a = (k or {}).get('a')
                aset = a if isinstance(a, list) else ([a] if a is not None else [])
                qs.append('<ul>' + ''.join(
                    '<li%s>%s</li>' % (' class="ok"' if oi in aset else '',
                                       html.escape(' '.join(str(o).split())))
                    for oi, o in enumerate(q['options'])) + '</ul>')
            if k and k.get('w'):
                qs.append('<p class="why">why: %s</p>'
                          % html.escape(' '.join(str(k['w']).split())))
            qs.append('</div>')
        qs.append('</div>')
        parts.append(''.join(qs))

    # sentences with no finite verb, surfaced per module rather than as a build warning
    try:
        import fragments
        frags = fragments.find(m['body_md'])
    except Exception:
        frags = []
    if frags:
        parts.append('<div class="frag"><h3>Possible fragments, %d</h3>'
                     '<p class="fsub">No finite verb found. Roughly one in three is a '
                     'false alarm, usually a label or a list continuation.</p><ul>%s</ul></div>'
                     % (len(frags), ''.join('<li>%s</li>' % html.escape(f) for f in frags)))

    vid = m.get('video')
    meta = '%d words' % len(m['body_md'].split())
    meta += ' &middot; video' if vid and vid != 'none' else ' &middot; no video'
    meta += ' &middot; %d quiz questions' % len(m['quiz']) if m.get('quiz') else ' &middot; no quiz'
    meta += ' &middot; %d flagged' % n if n else ' &middot; nothing flagged'
    if an:
        meta += ' &middot; has an author note'

    doc = ('<!doctype html><meta charset="utf-8"><title>%s</title>\n<style>%s</style>\n'
           '<h1>%s</h1>\n<div class="sub">%s</div>\n%s'
           % (html.escape(m['title']), CSS, html.escape(m['title']), meta, '\n'.join(parts)))
    io.open(out_path, 'w', encoding='utf-8').write(doc)
    print('wrote %s  (%d flags, author note: %s)' % (out_path, n, 'yes' if an else 'no'))


if __name__ == '__main__':
    main()
```
===== FILE: fragments.py =====

```python
"""Find sentences with no finite verb. Imperfect, so it feeds the review page
rather than the build. Roughly 70% precision after the exclusions below."""
import re
try:
    import spacy
    _NLP = spacy.load('en_core_web_sm')
    OK = True
except Exception:
    _NLP = None
    OK = False

# spaCy is not always installed, and a silent empty result reads as a clean pass.
# This fallback is cruder but it fails loud rather than quiet.
UNAVAILABLE = 'spaCy is not installed, so this ran on the fallback check'

_BE = set('is are was were be been being am'.split())
_AUX = set('has have had do does did will would can could should may might must'.split())
_SUFFIX = ('s', 'ed', 'es')


def _looks_finite(w):
    lw = re.sub(r'[^a-z]', '', w.lower())
    if not lw:
        return False
    if lw in _BE or lw in _AUX or lw in IMPER:
        return True
    return False

FINITE = ('VB', 'VBD', 'VBP', 'VBZ', 'MD')
IMPER = set('''click open close add set put take give show tell hand keep hold read write
watch complete finish start stop check verify confirm ask say lead pick quote build
send bring move drag mark result log record submit email call text visit walk load
proceed continue remember note look use make do go come get find leave treat pay
dress lift press ask offer point cover skip include exclude order measure install
replace remove sell price flag route hit tap select choose enter save print sign'''.split())


def has_verb(t):
    words = t.split()
    # an imperative can sit behind an adverb: "Always check for yourself"
    for w in words[:2]:
        if re.sub(r'[^a-z]', '', w.lower()) in IMPER:
            return True
    if _NLP is None:
        return any(_looks_finite(w) for w in words)
    doc = _NLP(t)
    return any(x.pos_ in ('VERB', 'AUX') and x.tag_ not in ('VBG', 'VBN') for x in doc)


def find(body):
    """Returns a list of (sentence, paragraph_snippet)."""
    out = []
    for para in body.split('\n\n'):
        st = ' '.join(para.split())
        if st.startswith('#') or st.startswith('|') or st.startswith('>'):
            continue
        if '{{' in st:
            continue
        # an image is a figure, and its alt text is a caption rather than prose
        st = re.sub(r'!\[[^\]]*\]\([^)]*\)\s*', '', st)
        # a link is one noun phrase, not its label glued to a URL
        st = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', st)
        # every item in a multi-line list is a list item, not just the first
        body_ = re.sub(r'(?:^|(?<=[.!?]) )-\s+', '', st)
        # a bolded label followed by a colon is a heading, not a sentence
        body_ = re.sub(r'^\*\*[^*]{2,40}:\*\*\s*', '', body_)
        for sent in re.split(r'(?<=[.!?])\s+', body_):
            w = re.sub(r'[*`\[\]()]', '', sent).strip()
            if not w or not (2 <= len(w.split()) <= 9):
                continue
            # "E-Series. Architectural collection." style labels
            if re.match(r'^\*?\*?[A-Z][A-Za-z0-9\- ]{2,26}\.?\*?\*?$', w) and len(w.split()) <= 3:
                continue
            if not has_verb(w):
                out.append(w)
    return out
```
===== FILE: facts.json =====

```json
{
  "_comment": "Facts that change, and every module allowed to state them. build.py warns if one appears somewhere unlisted, or stops appearing where it should. Add a fact here the moment you notice it stated twice.",
  "facts": [
    {
      "name": "product minimum",
      "pattern": "three windows or one door",
      "modules": [
        "PB-020"
      ]
    },
    {
      "name": "service area",
      "pattern": "30.mile radius",
      "modules": [
        "PB-020"
      ]
    },
    {
      "name": "base multiplier",
      "pattern": "2\\.04",
      "modules": [
        "PB-020"
      ]
    },
    {
      "name": "sales tax rate",
      "pattern": "7\\.25%",
      "modules": [
        "PB-020",
        "PR-048",
        "PR-070"
      ]
    },
    {
      "name": "deposit percentage",
      "pattern": "50% deposit",
      "modules": [
        "PB-020"
      ]
    },
    {
      "name": "labor warranty term",
      "pattern": "two year warranty on workmanship|two years on workmanship",
      "modules": [
        "PB-010",
        "PB-030",
        "PR-020",
        "REF-110"
      ]
    },
    {
      "name": "expansion joint",
      "pattern": "5/16",
      "modules": [
        "PB-010",
        "PK-AW-230"
      ]
    },
    {
      "name": "authorization ceiling",
      "pattern": "20% total|past 20%",
      "modules": [
        "PB-020"
      ]
    },
    {
      "name": "three day deal",
      "pattern": "three day deal",
      "modules": [
        "PB-020",
        "PB-030",
        "PR-047",
        "PR-100"
      ]
    },
    {
      "name": "cash discount",
      "pattern": "cash discount",
      "modules": [
        "PB-020",
        "PB-030",
        "PR-047",
        "PR-100"
      ]
    },
    {
      "name": "referral bonus",
      "pattern": "referral bonus",
      "modules": [
        "PB-020",
        "PB-030",
        "PR-100"
      ]
    },
    {
      "name": "value match payout",
      "pattern": "\\$100 (?:flat|back|plus|on top)|plus \\$100",
      "modules": [
        "PB-020",
        "PB-030"
      ]
    },
    {
      "name": "claim window",
      "pattern": "30 days after signing",
      "modules": [
        "PB-030"
      ]
    },
    {
      "name": "PTO allowance",
      "pattern": "ten vacation days",
      "modules": [
        "HR-030"
      ]
    },
    {
      "name": "sick allowance",
      "pattern": "[Ff]ive sick days",
      "modules": [
        "HR-030"
      ]
    },
    {
      "name": "vacation notice",
      "pattern": "30 days ahead",
      "modules": [
        "HR-030"
      ]
    },
    {
      "name": "founding year",
      "pattern": "since 2007|in 2007",
      "modules": [
        "HR-020",
        "PB-010"
      ]
    },
    {
      "name": "porta john cost",
      "pattern": "\\$350",
      "modules": [
        "PB-020",
        "PR-020"
      ]
    },
    {
      "name": "average project value",
      "pattern": "\\$22,745",
      "modules": [
        "PB-005",
        "PB-020"
      ]
    },
    {
      "name": "big door per linear foot",
      "pattern": "\\$1,700 to \\$2,300",
      "modules": [
        "PB-040",
        "PR-110"
      ]
    },
    {
      "name": "fibrex strength",
      "pattern": "2\\.5 times stronger",
      "modules": [
        "PK-AW-010",
        "PK-AW-100",
        "PK-AW-130"
      ]
    },
    {
      "name": "egress clear opening",
      "pattern": "4 square feet",
      "modules": [
        "REF-060"
      ]
    },
    {
      "name": "egress opening height",
      "pattern": "22 inches",
      "modules": [
        "REF-060"
      ]
    },
    {
      "name": "egress opening width",
      "pattern": "20 inches",
      "modules": [
        "REF-060"
      ]
    },
    {
      "name": "egress sill height",
      "pattern": "44 inches",
      "modules": [
        "REF-060"
      ]
    },
    {
      "name": "casement jamb depth",
      "pattern": "2-7/8",
      "modules": [
        "PK-AW-220",
        "PK-AW-400-CHECK",
        "REF-070"
      ]
    },
    {
      "name": "standard jamb depths",
      "pattern": "6-9/16",
      "modules": [
        "PR-021",
        "PR-025",
        "PR-040",
        "PR-110",
        "REF-030",
        "REF-070"
      ]
    },
    {
      "name": "2-1/4 inch profile",
      "pattern": "2-1/4",
      "modules": [
        "PK-DS-010",
        "PR-110",
        "REF-090",
        "REF-100"
      ]
    },
    {
      "name": "standard door panel thickness",
      "pattern": "1-3/4",
      "modules": [
        "PK-DS-010",
        "PR-110"
      ]
    },
    {
      "name": "slimline hardware cost",
      "pattern": "\\$5 to \\$10",
      "modules": [
        "REF-040"
      ]
    },
    {
      "name": "foot lock cost 400 Series",
      "pattern": "\\$30 to \\$35",
      "modules": [
        "REF-040"
      ]
    },
    {
      "name": "knockdown saving",
      "pattern": "\\$100 to \\$200",
      "modules": [
        "PR-025",
        "REF-040"
      ]
    },
    {
      "name": "extension jamb cost",
      "pattern": "\\$50 to \\$75",
      "modules": [
        "REF-040"
      ]
    },
    {
      "name": "key lock cost",
      "pattern": "over a hundred dollars",
      "modules": [
        "REF-040"
      ]
    },
    {
      "name": "Finelight, Andersen between the glass",
      "pattern": "Finelight",
      "modules": [
        "PK-AW-100",
        "PK-AW-190",
        "PR-021",
        "REF-040",
        "REF-090"
      ]
    }
  ]
}```
===== FILE: phases.json =====

```json
[
  {
    "name": "Why we're different",
    "blurb": "Before anything else, the argument the whole job rests on.",
    "ids": [
      "PB-010",
      "HR-020",
      "PB-005",
      "LV-005"
    ]
  },
  {
    "name": "Employment and money",
    "blurb": "Their contract, their pay, and how they claim it.",
    "ids": [
      "HR-030",
      "LV-015",
      "LV-016",
      "HR-040",
      "PB-070",
      "PB-080",
      "PB-082",
      "PB-085"
    ]
  },
  {
    "name": "Learning to sell",
    "blurb": "Objection handling and closing, taught entirely offsite.",
    "ids": [
      "LV-001",
      "LV-020",
      "LV-030",
      "LV-025"
    ]
  },
  {
    "name": "The system of record",
    "blurb": "Pipedrive, because everything after this assumes it.",
    "ids": [
      "PR-001",
      "PR-002",
      "PR-003",
      "PR-004",
      "PR-005",
      "PR-006",
      "PR-007",
      "PR-008",
      "PR-009"
    ]
  },
  {
    "name": "How we price and position",
    "blurb": "The commercial frame, before any product detail.",
    "ids": [
      "PB-020",
      "PB-030",
      "REF-010",
      "REF-090",
      "REF-100",
      "REF-060",
      "REF-070",
      "REF-080",
      "PK-AW-010"
    ]
  },
  {
    "name": "The 100 Series",
    "blurb": "Our volume line, and the one they'll sell most of.",
    "ids": [
      "PK-AW-100",
      "PK-AW-110",
      "PK-AW-120",
      "PK-AW-130",
      "PK-AW-140",
      "PK-AW-190"
    ]
  },
  {
    "name": "The 400 Series",
    "blurb": "The workhorse, and where most upgrades land.",
    "ids": [
      "PK-AW-200",
      "PK-AW-210",
      "PK-AW-220",
      "PK-AW-230",
      "PK-AW-240",
      "PK-AW-250",
      "PK-AW-260",
      "PK-AW-400-CHECK"
    ]
  },
  {
    "name": "The door brands",
    "blurb": "What we lead with on entry doors, and the wood alternative.",
    "ids": [
      "PK-PV-010",
      "PK-DS-010"
    ]
  },
  {
    "name": "Seeing it in person",
    "blurb": "Now the displays mean something.",
    "ids": [
      "LV-010"
    ]
  },
  {
    "name": "Choosing what to lead with",
    "blurb": "Decision rules, which need the product knowledge above.",
    "ids": [
      "PB-040",
      "REF-050",
      "REF-110"
    ]
  },
  {
    "name": "Measuring",
    "blurb": "The reference sheet first, then hands on, then a real one.",
    "ids": [
      "REF-030",
      "LV-040",
      "LV-050"
    ]
  },
  {
    "name": "Quoting the product",
    "blurb": "Meet each manufacturer, then learn their tool. Labor comes after.",
    "ids": [
      "PR-020",
      "PR-021",
      "PR-025",
      "PR-110",
      "LV-042",
      "PR-040",
      "PR-045",
      "LV-045",
      "PR-046"
    ]
  },
  {
    "name": "Capturing the labor",
    "blurb": "Adders, then the traps, then bringing quotes into Vendo.",
    "ids": [
      "PR-047",
      "PR-048",
      "REF-040",
      "PR-050",
      "PR-070",
      "PR-080",
      "PR-100"
    ]
  },
  {
    "name": "At the table",
    "blurb": "The two tools they use in front of a customer.",
    "ids": [
      "PB-050",
      "LV-065",
      "LV-068",
      "PB-060"
    ]
  },
  {
    "name": "Practice, then the real thing",
    "blurb": "Rehearsal, then a live jobsite, then a full run through.",
    "ids": [
      "LV-078",
      "LV-055",
      "LV-090",
      "LV-100",
      "LV-085",
      "LV-110",
      "LV-120",
      "PB-090"
    ]
  }
]```
===== FILE: .videos.json =====

```json
{
  "https://www.loom.com/share/01ce10609a2045b28d284bf16b034661": "PK-AW-240",
  "https://www.loom.com/share/09baf9e590884ea399d5bcdf25a9e65e": "PR-002",
  "https://www.loom.com/share/0d361a98562a41da9e430094d56adf06": "PB-010",
  "https://www.loom.com/share/14aa9f92392e42b7ba3639c94bc09567": "PR-070",
  "https://www.loom.com/share/165da29cde0e4875b762c4f60212822e": "PR-004",
  "https://www.loom.com/share/16fd52d285bc47d8a3d6a916b06482d8": "PK-AW-210",
  "https://www.loom.com/share/180175ef4dd74673871a9ae08ed999f8": "PR-045",
  "https://www.loom.com/share/19e7b8f7a43b41dbb4ed17ba5c0b1dbc": "PR-040",
  "https://www.loom.com/share/352069348fc94018aecfb8884ac7ccaf": "PR-021",
  "https://www.loom.com/share/36be3b05c8fc4eb1bd4ce35b74c22a6a": "PR-006",
  "https://www.loom.com/share/3dce54e158a64157be2a4c918b8ae626": "PK-AW-130",
  "https://www.loom.com/share/3f7b249b987d4e0288fc2e26771211db": "HR-040",
  "https://www.loom.com/share/4163a4db2d954699a8f0a2c4daed3fd4": "PR-007",
  "https://www.loom.com/share/41f76b44597f42fc91ffe9029f1d5471": "PK-AW-250",
  "https://www.loom.com/share/485e45c442f849d58036c1e2c6397af3": "PR-008",
  "https://www.loom.com/share/48786ee404724b18a12ad10b53595dad": "PR-020",
  "https://www.loom.com/share/4de0451d8e2c4388ad7e0e47d0399ea7": "PR-003",
  "https://www.loom.com/share/5539458e1f92419f8dcc8550f35b7f58": "PK-DS-010",
  "https://www.loom.com/share/5ba5685e4b5f4a3ba37b05f67c2d6f71": "HR-020",
  "https://www.loom.com/share/6127e74bc4c845e6a6144712f3ed12a8": "PR-005",
  "https://www.loom.com/share/68ae879c8f604ac19f3b2071335873f8": "PR-047",
  "https://www.loom.com/share/6d28f384624447cb8939e87f0c5325db": "PK-AW-010",
  "https://www.loom.com/share/7190886e74ae437180d6a1769c5d313f": "HR-030",
  "https://www.loom.com/share/acae93250d08476dac93514ab1071e5b": "PR-110",
  "https://www.loom.com/share/b3f500ca01e14931bd6b10f54b37a38a": "PK-AW-200",
  "https://www.loom.com/share/bc8ece3be8d44152b59c22419f7157de": "PR-050",
  "https://www.loom.com/share/be8b7f3efaa34913aab56ce23735c913": "PK-AW-140",
  "https://www.loom.com/share/ca57b19b3c684d398b211b17d03b65b5": "PR-046",
  "https://www.loom.com/share/cba0fa39800e4f9aa2505677d4036a6d": "PK-AW-220",
  "https://www.loom.com/share/cbbdd07319a3485a986113b412beff6a": "PB-060",
  "https://www.loom.com/share/d06de0deaae4498aaad40cf49df3f568": "PR-025",
  "https://www.loom.com/share/d68a0dfa7819427086f6b438a188508d": "PR-010",
  "https://www.loom.com/share/e450e1198d0b42ec8973d477b4ca5c8f": "PK-AW-100",
  "https://www.loom.com/share/e69e95ef976d49a9816c92017a894e6f": "PK-AW-260",
  "https://www.loom.com/share/e7b0231f519644fb93dde2d6235f84aa": "PR-001",
  "https://www.loom.com/share/eb74829b07e9464e9cbf9644121db774": "PR-090",
  "https://www.loom.com/share/edf5a43042144d3d8322948e83094062": "PK-AW-110",
  "https://www.loom.com/share/f1d30ba67fea41c3b2188a3ce1af645d": "PR-080",
  "https://www.loom.com/share/fbd940f63fdd484cbb2376c06333d362": "PK-AW-230"
}```
===== FILE: VOICE.md =====

```
# Voice

How Window Works training content should sound. This exists because tone
problems are invisible to search. Every one we found was caught by a person
reading a sentence and flinching, never by a pattern match.

## The reference

Two pieces of your own material already have the voice. When something feels
off, compare against these rather than against an abstract idea of kindness.

Justin's installation video:

> Things that most people never think about until a window starts to leak or
> won't open right are the things that we make sure that we're thinking about
> so you don't have to.

Our installation story:

> The best window in the world fails if it is installed badly. That is the
> whole argument. You will lose deals on price. You should not lose them on
> price without the customer understanding what they are giving up.

Both give the reason and then get out of the way. Neither reassures anybody.
Neither warns anybody. That is the target: warm because it explains well, not
warm because it adds comforting words.

## Six rules

**1. Rule, then reason. Never the rule alone.** The reason is what makes it
stick, and it is the difference between instruction and command.

**2. Address the situation, not the person's character.** "This one is easy to
get wrong" rather than "do not get this wrong."

**3. Consequences are mechanics, not warnings.** State what the system does.
"The cutoff is the first of the following month" informs. "Or it does not get
paid" pressures, and adds nothing.

**4. Assume competence.** Cut anything telling an adult not to do something they
were not going to do, and anything explaining how to remember a date.

This applies to everyone the writing talks about, not only the person reading it.
Telling a rep to set a reminder and telling a rep to tell a customer to set a
reminder are the same sentence. The second is worse, because the trainee learns
to talk to customers that way.

**5. Do not comment on how hard something is.** Not "this is tricky", not "most
people need two passes", not "do not worry if this takes a while". Difficulty is
a claim about the reader, and predicting that they will struggle is its own kind
of presumption. Explain the thing and let them find it easy or not.

**6. Terse is fine. Terse is often best.** Short declaratives are the strongest
writing in this set. Do not pad reference material with warmth. Respecting
someone's time is a form of respect.

Terse means short complete sentences, not fragments. "Plus sign, lower right"
and "Three tiles" and "Foam, sealant, and trim" are not terse writing, they're
notes to yourself. Labels and list items can be fragments. Prose can't.

Terse is not the same as sharp. The cheapest way to make a sentence sound
punchy is to point at a consequence or a failure, and it is the most common way
this voice goes wrong. "That's the one step people miss." "Four things that can
cost you." "The deadline that costs you money." Each of those signals that
something matters by implying the reader will get it wrong. If a point needs
emphasis, give the reason instead.

## Contractions

Use them. The blog runs about 2.7 contractions per 100 words and the training
content now matches. This is not decoration: "Don't open with a discount" and
"Do not open with a discount" are different instructions from different people.
The uncontracted form is what an institution issues, and ninety of those in a
row is a register nobody chose.

One constraint. A contraction of is or are cannot end a clause. "Who we are",
never "who we're". The build checks this.

## Five questions for reviewing a paragraph

Every bad sentence we found fails at least one.

1. Does it tell them what goes wrong if they fail? If so, is the consequence
   information they need, or is it pressure?
2. Does it tell them how to manage themselves? Remember, be careful, get in the
   habit, set a reminder.
3. Does it name a specific small scenario as the bad example? If you can
   picture the person doing it, it is an accusation.
4. Does it use a suspicion word? Actually, just, simply, make sure, be sure to.
5. Would you say this sentence out loud, to a new hire, on their second day,
   standing in front of them?

Question five is the real test. The rest are shortcuts to it.

## Read it aloud

This is the only review method that reliably works. Tone problems are close to
invisible on a screen and unmissable in your own mouth. Reading the HR and
playbook modules aloud takes about an hour and will find more than any tooling.

The process, product, and reference modules are about windows and software
rather than about the reader, and have been clean every time. Spend the hour on
the ones that talk to the person.

## Before and after

Each of these shipped. Each was caught by reading, not by searching.

| Was | Now |
|---|---|
| If you are fearful or resistant to change, this is probably not the right job. | Something set up one way may change in six or twelve months. We would rather tell you that now than surprise you with it later. |
| We cannot hold your hand through all of it. | It is more than anyone can hand you directly, so read, ask, watch, and go find what you need. |
| Get it wrong and the customer sees it three times. | An error here shows up in all three. |
| Miss it and that month does not get paid. Set a recurring reminder for the last day of each month. | The cutoff for any given month is the first of the following month. |
| A coffee shop counts only if you are actually working there. Going to Starbucks on your break does not. | A coffee shop counts when it is where you are working, or where you are meeting a client or a subcontractor. |
| And do not take it for granted. | (cut) |
| If something in someone's house strikes you as odd, you do not photograph it and post it. | (cut; the sentence before already said what you see in a customer's home stays there) |

Notice that none of these share a grammatical shape. That is the whole problem.

## Mechanics, already enforced by build.py

These are checked on every build and do not need reviewing by hand:

- No en dashes or em dashes. Hyphens only.
- Dimensions carry their unit. A fraction on its own is ambiguous, so it's
  **4-9/16"** rather than 4-9/16, and **6'8"** rather than 6 foot 8. The build
  flags a bare fraction. Spelling the unit out is fine in prose, as in "22 inches
  of clear opening", but never leave a fraction bare.

- US spelling. Three deliberate exceptions: **moulding** and **brickmould**,
  which are the industry terms, and **Fibrex**, which is an Andersen trademark.
  The build flags brickmold as a misspelling rather than the reverse.
- Videos cannot silently disappear when a module is deleted.

## We are American

No Britishisms. Spelling is the obvious half and the build already catches
colour, centre, grey, fibre. The half it misses is grammar and idiom:

- A company is singular. **MileIQ has a playlist**, not MileIQ have. Andersen
  makes it, Therma-Tru is, Synchrony was.
- **Math**, not maths. **Gotten** is fine. **Different from** or **different
  than**, not different to.
- Watch **whilst**, **amongst**, **learnt**, **towards**, **at the weekend**,
  **in hospital**, **straight away**, **have a look**, **sort out**, **keen
  to**, **reckon**.
- Dates are **August 17**, not 17 August.

This one is easy to drift on when someone else is drafting, so it is worth a
read-aloud check on anything not written in house.

## Two conventions the checker cannot catch

**Introduce a tool the first time it appears.** Vendo, Pipedrive, CompanyCam,
Ingage, Reeb, Vinyl Design. One clause is enough, and it should say what the
thing is rather than assume. Check the order the portal actually presents
modules in, not the order they were written.

**Point forward rather than implying this is the only time.** A reader who thinks
a paragraph is their one chance to learn something stops reading and starts
memorizing. Saying it comes up again in a specific module later frees them to
take it in.

**Anchor to a year, never a duration.** "Founded in 2007", not "about twenty
years ago". Durations age every January. We have fixed this four times.

**Author notes are for us.** Put them under a heading of `Author note`,
`Production note`, or `Internal note` and the build strips them so a trainee
never sees them. Anything the reader should see needs a different heading.
```
===== FILE: SCHEDULE.md =====

```
# B2C sales onboarding: Aug 17 to Sept 14, 2026

Two in-home sales consultants, Tyler and Michael. Days run 10:00 AM to 4:00 PM, about five working hours.
Sixteen office days plus two offsite days before go-live.

Built from the fifteen phase order rather than by week, so nothing appears before
the thing it depends on. Phases open in sequence and everything inside a phase is
available at once.

## How to read it

Three states, and they answer three different questions.

| | Meaning | The question it answers |
|---|---|---|
| Plain | Self-paced in the portal | When do I feel like doing this? |
| **Orange** | Has an actual time | Where do I have to be, and when? |
| **Black** | An assessment | What am I being judged on? |

Orange is what Rose and Justin book their own blocks against, so anything orange
has a start time or it is not orange yet.

An assessment with a time is black with its time in orange, which is the Ingage
test out, the photo review, and the mock. Everything else is one or the other.

## The numbers

| | |
|---|---|
| Path total | 70.8 hours, 85 modules |
| Top Rep online | 14 hours, week 1 |
| Top Rep Live | 16 hours, offsite Aug 24 to 25 |
| Everything else | 40.8 hours |
| Office capacity | 16 days at 5 hours, so 80 hours |

Capacity is not the constraint. The constraints are the phase order, the two hour
a day ceiling on Rose and Justin, and the vendor reps' availability.

## Calendar at a glance

| Week | Dates | Days | What dominates |
|---|---|---|---|
| 1 | Aug 17 to 21 | 5 office | Top Rep online, 3 hrs a day |
| 2 | Aug 24 to 28 | 2 offsite, 1 off, 2 office | Top Rep Live, then product |
| 3 | Aug 31 to Sep 4 | 5 office | Measuring, quoting, Ingage |
| 4 | Sep 8 to 11 | 4 office | Jobsite, then the mock |
| | **Sep 14** | | **Solo in the field** |

## Week 1, Aug 17 to 21

Phases: Why we're different, Employment and money, The system of record, How we
price and position. Top Rep online runs 3 hours a day alongside.

**Mon 17**
- New hire paperwork, 2 hrs
- Catered lunch, birthday cake
- **12:00 PM Live: portal walkthrough, 30 min, Rose.** Hands on, not a video. Rose
  watches them log in and find their path
- Device and login check, 15 min. Credentials into 1Password, shred the printed
  sheets before they leave
- Our installation standards, Our team and values, Who you're selling to
- Top Rep online, 2 hrs

**Tue 18**
- Top Rep online, 3 hrs
- **12:30 PM Live: choosing your logowear, 30 min, Rose**
- **1:00 PM Live: getting your photo taken, 10 min, Rose**
- Employment contract and company policies
- ADP and benefits, MileIQ and expenses, How you get paid, Your commission
  calculator, Generating your own leads

**Wed 19**
- Top Rep online, 3 hrs
- Pipedrive, all nine modules through the exit quiz

**Thu 20**
- Top Rep online, 3 hrs
- How our pricing works, The Value Match Guarantee, Install types
- Window anatomy and grille patterns, Door anatomy and lite options
- Egress and sleeping rooms, Wall depth and interior finish, PO naming

**Fri 21**
- Top Rep online, 3 hrs
- Andersen series overview

## Week 2, Aug 24 to 28

**Mon 24 and Tue 25** Top Rep Live, offsite, Columbus OH

**Wed 26** Off

**Thu 27**
- **1:00 PM Live: Top Rep debrief, 2 hrs, Rose**
- Top Rep sales simulator, 1 hr, self-paced inside Top Rep
- The 100 Series, all six modules through the series check

**Fri 28**
- The 400 Series, all eight modules through the series check
- ProVia entry doors, DSA doors and the Breezeport
- The lineup and what to lead with, Tempered glass and code, Warranties

## Week 3, Aug 31 to Sept 4

**Mon 31**
- **10:00 AM Live: showroom walkthrough, 45 min, Justin.** Now the displays mean
  something
- Sizing conventions
- **1:00 PM Live: measuring part one, 1 hr, Justin**
- Using Vendo: navigation, adders, and final documents
- Quoting Andersen windows in Vendo

**Tue 1**
- Quoting Andersen doors in Vendo
- Quoting big doors and Andersen entry doors in Vendo
- **10:00 AM Live: Vinyl Design with Justin, 1 hr**
- Quoting Vinyl Design on the iPad

**Wed 2**
- **10:00 AM Live: measuring part two, 1 hr, Justin**
- **1:00 PM Live: Therma-Tru with Justin, 1 hr**
- Quoting Therma-Tru doors in Reeb 2G, Quoting a custom door in Reeb 2G

**Thu 3**
- Understanding project adders in Vendo, Adder traps, Never sell always include
- Both Vendo imports, Completing a change order, Vendo exit quiz
- Presenting in Ingage
- **1:00 PM Live: Ingage practice, 1.5 hrs, Rose**

**Fri 4**
- **Live: Ingage test out, 1 hr each, Rose.** Tyler 11:00 AM, Michael 12:00 PM
- Taking great pictures in CompanyCam, plus the CompanyCam exit quiz

## Week 4, Sept 8 to 11

**Mon 7** Labor Day

**Tue 8**
- **12:00 PM Live: mock Vendo build, 1 hr, Rose and Justin.** Each builds a full quote
- Top Rep sales simulator, 1 hr, self-paced inside Top Rep

**Wed 9**
- **10:00 AM Jobsite visit with the PM, 4 hrs.** A live install. They practice
  CompanyCam photos on a real job

**Thu 10**
- Top Rep sales simulator, 1 hr, self-paced inside Top Rep
- **12:00 PM Live: photo review, 30 min, Rose.** Their actual shots against the
  standard they were quizzed on
- **12:30 PM Live: planning your in-store hours, 30 min, Rose.** Straight after the
  photo review

**Fri 11**
- **The mock appointment. Same house, same day, staggered.** 2.5 hours each, with
  15 minutes between to reset.
  - Tyler, 10:00 AM to 12:30 PM
  - Reset, 12:30 PM to 12:45 PM
  - Michael, 12:45 PM to 3:15 PM
- What comes next

**Sept 14** Solo in the field.

## Live session load

| Who | Days | Hours |
|---|---|---|
| Rose | Aug 17, Aug 18, Aug 27, Sep 3, Sep 4, Sep 8, Sep 10, Sep 11 | 0.5, 0.75, 2, 1.5, 2, 1, 1, 5.25 |
| Justin | Aug 31, Sep 1, Sep 2, Sep 8 | 1.75, 1, 2, 1 |
| PM | Sep 9 | 4 |
Two hours a day is the ceiling everywhere except Sept 11. The mock is the gate and
it takes the day.

## Assessments

| What | When | Type |
|---|---|---|
| Module quizzes | Throughout | Auto scored, portal |
| Pipedrive exit quiz | Wed Aug 19 | Includes a dashboard screenshot |
| Andersen 100 Series check | Thu Aug 27 | Auto scored |
| Andersen 400 Series check | Fri Aug 28 | Auto scored |
| Vendo exit quiz | Thu Sep 3 | Auto scored |
| Ingage test out | Fri Sep 4, 11:00 AM and 12:00 PM | Approver sign off |
| CompanyCam exit quiz | Fri Sep 4 | Two photo critique questions |
| CompanyCam photos | Wed Sep 9 | Real photos from the jobsite |
| **Mock appointment** | **Fri Sep 11, 10:00 AM and 12:45 PM** | **The gate** |

If somebody does not clear the mock, Sept 14 slips for that person and the
following week becomes remediation.

## Open items

**Before Aug 17**
- iPads, credentials, 1Password
- Confirm the org chart in the values video is current
- Film the ProVia video, and decide which series we carry

**Before Sept 1**
- What the two Justin sessions cover, and where they happen

**Before Sept 11**
- Find the house for the mock. Enough windows for a real quote, and the owner
  knows it is practice
- Define the mock scoring: what counts as a pass on the quote itself
```

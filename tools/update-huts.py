#!/usr/bin/env python3
"""Refresh data/huts.json from OpenStreetMap.

Overpass is slow and often busy, so the site ships a snapshot instead of
querying it from every visitor's phone. Run this now and then (huts rarely
move) and commit the result:  python3 tools/update-huts.py

Each hut becomes a short array to keep the file small:
  [lat, lng, name, kind, operator, ele, beds, website, dntKey, osmRef]
kind: s staffed, e self-service, n no-service (DNT classes),
      m other mountain hut, w wilderness hut, b basic hut or shelter.
"""
import json, os, sys, time, urllib.parse, urllib.request

# The same areas as REGIONS in js/steepness.js (south, west, north, east).
AREAS = {'Norway': (57.5, 3.0, 71.5, 32.0), 'The Alps': (43.4, 4.3, 48.6, 16.6)}
# overpass-api.de sometimes refuses scripts (HTTP 406), so it comes last.
SERVERS = ['https://overpass.private.coffee/api/interpreter',
           'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
           'https://overpass-api.de/api/interpreter']
UA = 'bratthet hut snapshot (+https://github.com/mkerrn/bratthet)'
DNT_KIND = {'betjent': 's', 'selvbetjent': 'e', 'ubetjent': 'n'}
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'huts.json')


def overpass(bbox):
    b = ','.join(map(str, bbox))
    q = ('[out:json][timeout:180];('
         f'nwr["tourism"~"^(alpine_hut|wilderness_hut)$"]({b});'
         f'nwr["amenity"="shelter"]["shelter_type"="basic_hut"]["name"]({b});'
         ');out center tags;')
    for url in SERVERS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(url + '?' + urllib.parse.urlencode({'data': q}),
                                             headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.load(r)['elements']
            except Exception as e:
                print(f'  {url}: {e}', file=sys.stderr)
                if getattr(e, 'code', 500) < 500:
                    break      # refused, not busy: waiting won't help
                time.sleep(10)
    sys.exit('every Overpass server failed, try again later')


def kind(t):
    if t.get('dnt:classification') in DNT_KIND:
        return DNT_KIND[t['dnt:classification']]
    if t.get('tourism') == 'alpine_hut':
        return 'm'
    if t.get('tourism') == 'wilderness_hut':
        return 'w'
    return 'b'


def num(v):
    try:
        return round(float(v.replace(',', '.').split()[0]))
    except (AttributeError, ValueError, IndexError):
        return None


huts = {}
for area, bbox in AREAS.items():
    print(f'{area}…', file=sys.stderr)
    for e in overpass(bbox):
        t = e.get('tags', {})
        if t.get('access') in ('private', 'no') or t.get('disused') == 'yes':
            continue
        c = e.get('center', e)
        ref = e['type'][0] + str(e['id'])
        huts[ref] = [round(c['lat'], 5), round(c['lon'], 5), t.get('name', ''), kind(t),
                     t.get('operator', ''), num(t.get('ele')), num(t.get('capacity') or t.get('beds')),
                     t.get('website') or t.get('url') or '', 1 if t.get('dnt:lock') == 'yes' else 0, ref]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('{"date":"' + time.strftime('%Y-%m-%d') + '","huts":[\n')
    f.write(',\n'.join(json.dumps(h, ensure_ascii=False, separators=(',', ':')) for h in huts.values()))
    f.write('\n]}\n')
print(f'{len(huts)} huts written to data/huts.json', file=sys.stderr)

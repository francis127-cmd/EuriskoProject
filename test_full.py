import urllib.request, json, os, tempfile, time

BASE = 'http://localhost:3000'
TMP = tempfile.gettempdir()
RUN = str(int(time.time()))
fails = []

def req(m, p, t=None, b=None):
    data = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=data, method=m)
    if t: r.add_header('Authorization', 'Bearer ' + t)
    if data: r.add_header('Content-Type', 'application/json')
    try:
        resp = urllib.request.urlopen(r)
        raw = resp.read()
        try: body = json.loads(raw.decode() or 'null')
        except Exception: body = raw
        return resp.status, body
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: body = json.loads(raw.decode() or 'null')
        except Exception: body = raw
        return e.code, body
    except Exception as e:
        return -1, str(e)

def tok(eid, role):
    s, j = req('POST', '/auth/token', b={'employeeId': eid, 'role': role})
    assert s == 201, ('token status', s, j)
    return j['accessToken']

def check(name, cond, extra=''):
    print(('PASS' if cond else 'FAIL') + ' - ' + name + ('' if cond else '  >> ' + str(extra)))
    if not cond: fails.append(name)

# 1 token issuance
t1 = tok('emp1', 'STANDARD')

# 2 create -> PENDING
s, j = req('POST', '/requests', t1, {'title': 'T', 'catalogItem': 'pay_slip'})
check('create -> 201 PENDING', s == 201 and j.get('state') == 'PENDING', (s, j))
rid = j['id']

# 3 cross-user 403
t2 = tok('emp2', 'STANDARD')
s, j = req('GET', '/requests/%s' % rid, t2)
check('cross-user GET -> 403', s == 403, (s, j))

# 4 employee PATCH state -> 403
s, j = req('PATCH', '/requests/%s' % rid, t1, {'state': 'IN_PROGRESS'})
check('employee PATCH state -> 403', s == 403, (s, j))

# 5 employee cancel PENDING -> 200 CANCELED
s, j = req('POST', '/requests/%s/cancel' % rid, t1, {})
check('owner cancel PENDING -> 200 CANCELED', s == 200 and j.get('state') == 'CANCELED', (s, j))

# 6 cancel non-PENDING -> 400
t3 = tok('emp3', 'STANDARD')
s, j = req('POST', '/requests', t3, {'title': 'T2', 'catalogItem': 'pay_slip'})
rid3 = j['id']
hr = tok('admin1', 'HR')
s, j = req('PATCH', '/requests/%s' % rid3, hr, {'state': 'IN_PROGRESS'})
s, j = req('PATCH', '/requests/%s' % rid3, hr, {'state': 'COMPLETED', 'hrNote': 'done'})
s, j = req('POST', '/requests/%s/cancel' % rid3, t3, {})
check('cancel COMPLETED -> 400', s == 400, (s, j))

# 7 upload .mp4 -> 400 ; 8 upload .pdf -> 201
t4 = tok('emp4', 'STANDARD')
s, j = req('POST', '/requests', t4, {'title': 'T3', 'catalogItem': 'pay_slip'})
rid4 = j['id']
def upload(t, rid, fn, content=b'x'):
    b = os.path.join(TMP, fn); open(b,'wb').write(content); fb = open(b,'rb').read()
    bd = (b'--B\r\nContent-Disposition: form-data; name="file"; filename="'+fn.encode()+b'"\r\nContent-Type: application/octet-stream\r\n\r\n'+fb+b'\r\n--B--\r\n')
    r = urllib.request.Request(BASE+'/requests/%s/document'%rid, data=bd, method='POST')
    r.add_header('Authorization','Bearer '+t); r.add_header('Content-Type','multipart/form-data; boundary=B')
    try:
        resp = urllib.request.urlopen(r); return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
s, _ = upload(t4, rid4, 'bad.mp4', b'%PDF')
check('upload .mp4 -> 400', s == 400, s)
s, _ = upload(t4, rid4, 'ok.pdf', b'%PDF')
check('upload .pdf -> 201', s == 201, s)

# 9 HR COMPLETED w/o file|note (REQUIRED_NOTE) -> 400 ; 10 with note -> 200
t5 = tok('emp5', 'STANDARD')
s, j = req('POST', '/requests', hr, {'title': 'T4', 'catalogItem': 'leave_certificate', 'employeeId': 'emp5', 'docRequirement': 'REQUIRED_NOTE'})
rid5 = j['id']
s, j = req('PATCH', '/requests/%s' % rid5, hr, {'state': 'COMPLETED'})
check('HR COMPLETED no note (REQUIRED_NOTE) -> 400', s == 400, (s, j))
s, j = req('PATCH', '/requests/%s' % rid5, hr, {'state': 'COMPLETED', 'hrNote': 'approved'})
check('HR COMPLETED w/ note -> 200', s == 200 and j.get('state') == 'COMPLETED', (s, j))

# 11 owner download -> 200
s, _ = req('GET', '/requests/%s/document' % rid4, t4)
check('owner download -> 200', s == 200, s)

# 12 priority sorting (isolated employee + unique titles to avoid cross-run noise)
t6 = tok('emp6_' + RUN, 'STANDARD')
tags = {'p5': 5, 'p1': 1, 'p3': 3}
for name, pr in tags.items():
    s, j = req('POST', '/requests', t6, {'title': name + '_' + RUN, 'catalogItem': 'pay_slip', 'priority': pr})
    print('   create %s -> %s' % (name, s))
s, j = req('GET', '/requests', t6)
print('   list status', s, 'titles', [r.get('title') for r in j])
owner = [r['priority'] for r in j if r['title'].endswith('_' + RUN)]
check('priority ascending sort', owner == [1,3,5], owner)

# 13 rate limit 429 (fresh token, 6 quick list calls)
tl = tok('empL', 'STANDARD')
codes = [req('GET', '/requests', tl)[0] for _ in range(6)]
check('rate limit 6th -> 429', codes[-1] == 429, codes)

# 14 optimistic concurrency 409 (dedicated HR token so it isn't throttled by earlier reuse)
hr2 = tok('admin2_' + RUN, 'HR')
tc = tok('empC_' + RUN, 'STANDARD')
s, j = req('POST', '/requests', tc, {'title': 'cc', 'catalogItem': 'pay_slip'})
print('   create tc ->', s, j if s != 201 else '')
ridc = j['id']; ver = j['version']
s, j = req('PATCH', '/requests/%s' % ridc, hr2, {'state': 'IN_PROGRESS'})
print('   in_progress ->', s)
s, j = req('PATCH', '/requests/%s' % ridc, hr2, {'state': 'COMPLETED', 'hrNote': 'x', 'version': ver})
check('stale version PATCH -> 409', s == 409, (s, j))

# 15 HR delete doc -> 200, GET -> 404
s, _ = req('DELETE', '/requests/%s/document' % rid4, hr)
check('HR delete doc -> 200', s == 200, s)
s, _ = req('GET', '/requests/%s/document' % rid4, t4)
check('deleted doc GET -> 404', s == 404, s)

print('\n' + ('ALL PASSED' if not fails else 'FAILURES: ' + str(fails)))

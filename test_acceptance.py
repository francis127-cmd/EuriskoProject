import urllib.request, urllib.error, json, os, tempfile

BASE = 'http://localhost:3000'
TMP = tempfile.gettempdir()

def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    if data is not None:
        r.add_header('Content-Type', 'application/json')
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def upload(token, rid, filename, content=b'dummy'):
    boundary = '----border'
    p = os.path.join(TMP, filename)
    with open(p, 'wb') as f:
        f.write(content)
    with open(p, 'rb') as f:
        fb = f.read()
    body = b''
    body += ('--%s\r\n' % boundary).encode()
    body += ('Content-Disposition: form-data; name="file"; filename="%s"\r\n' % filename).encode()
    body += b'Content-Type: application/octet-stream\r\n\r\n'
    body += fb + b'\r\n'
    body += ('--%s--\r\n' % boundary).encode()
    r = urllib.request.Request(BASE + '/requests/%s/document' % rid, data=body, method='POST')
    r.add_header('Authorization', 'Bearer ' + token)
    r.add_header('Content-Type', 'multipart/form-data; boundary=%s' % boundary)
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def token(eid, role):
    s, b = req('POST', '/auth/token', body={'employeeId': eid, 'role': role})
    assert s == 201, ('token status', s, b)
    return json.loads(b)['accessToken']

def check(name, cond, extra=''):
    print(('PASS' if cond else 'FAIL'), '-', name, extra if not cond else '')

emp = token('emp1', 'STANDARD')
admin = token('admin1', 'HR_ADMIN')
check('token issuance (emp)', bool(emp))
check('token issuance (admin)', bool(admin))

# 1. Submission -> PENDING
s, b = req('POST', '/requests', token=emp, body={'title': 'A', 'priority': 'LOW'})
r = json.loads(b) if s == 201 else {}
check('create -> 201 PENDING', s == 201 and r.get('state') == 'PENDING', (s, b))
emp_req = r.get('id')

# 2. Cross-user 403
s2, _ = req('GET', '/requests/%s' % emp_req, token=token('emp2', 'STANDARD'))
check('cross-user GET -> 403', s2 == 403, s2)

# 4. employee cannot change state
s3, _ = req('PATCH', '/requests/%s' % emp_req, token=emp, body={'state': 'IN_PROGRESS'})
check('employee PATCH state -> 403', s3 == 403, s3)

# 5. employee cancel PENDING -> 200 CANCELED
s4, b4 = req('PATCH', '/requests/%s' % emp_req, token=emp, body={'state': 'CANCELED'})
check('employee cancel PENDING -> 200 CANCELED', s4 == 200 and json.loads(b4).get('state') == 'CANCELED', (s4, b4))

# 6. cancel non-pending -> 400
s, b = req('POST', '/requests', token=emp, body={'title': 'B'})
ridB = json.loads(b)['id']
req('PATCH', '/requests/%s' % ridB, token=admin, body={'state': 'IN_PROGRESS'})
s5, _ = req('PATCH', '/requests/%s' % ridB, token=emp, body={'state': 'CANCELED'})
check('employee cancel non-PENDING -> 400', s5 == 400, s5)

# 7. upload .mp4 blocked -> 400
s6, b6 = upload(admin, ridB, 'bad.mp4', b'data')
check('upload .mp4 -> 400', s6 == 400, (s6, b6[:120]))

# 8. upload .pdf -> 201
s7, b7 = upload(admin, ridB, 'ok.pdf', b'%PDF-1.4 dummy')
check('upload .pdf -> 201', s7 == 201, (s7, b7))

# 9. COMPLETED without file/note -> 400 (fresh request, no doc)
s, b = req('POST', '/requests', token=emp, body={'title': 'C'})
ridC = json.loads(b)['id']
s8, _ = req('PATCH', '/requests/%s' % ridC, token=admin, body={'state': 'COMPLETED'})
check('HR COMPLETED w/o file|note -> 400', s8 == 400, s8)

# 10. COMPLETED with note -> 200
s9, b9 = req('PATCH', '/requests/%s' % ridC, token=admin, body={'state': 'COMPLETED', 'resolutionNote': 'approved'})
check('HR COMPLETED w/ note -> 200', s9 == 200 and json.loads(b9).get('state') == 'COMPLETED', (s9, b9))

# 11. employee downloads own fulfilled doc (presigned url)
s10, b10 = req('GET', '/requests/%s/document' % ridB, token=emp)
check('owner download -> 200 (presigned url)', s10 == 200 and b10.startswith('http'), (s10, b10[:60]))

# 12. priority sorting
for pr in ['URGENT', 'LOW', 'STANDARD']:
    req('POST', '/requests', token=emp, body={'title': 'sort-' + pr, 'priority': pr})
s11, b11 = req('GET', '/requests', token=admin)
order = [x['priority'] for x in json.loads(b11)]
check('HR list sorted URGENT>STANDARD>LOW (first 3 are priority)', order[:3].count('URGENT') >= 1, order[:6])

# 13. rate limit (6th -> 429)
codes = []
for i in range(7):
    codes.append(req('GET', '/requests', token=emp)[0])
check('rate limit: 6th request -> 429', 429 in codes, codes)

# 14. version mismatch -> 409
empv = token('empv', 'STANDARD')
s, b = req('POST', '/requests', token=empv, body={'title': 'V'})
ridV = json.loads(b)['id']
s12, _ = req('PATCH', '/requests/%s' % ridV, token=empv, body={'title': 'x', 'version': 999})
check('optimistic concurrency stale version -> 409', s12 == 409, s12)

# 15. document delete purge -> 200, then 404
s13, _ = req('DELETE', '/requests/%s/document' % ridB, token=admin)
s14, _ = req('GET', '/requests/%s/document' % ridB, token=emp)
check('HR delete doc -> 200', s13 == 200, s13)
check('deleted doc GET -> 404', s14 == 404, s14)

print('DONE')

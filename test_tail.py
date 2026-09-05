import urllib.request, urllib.error, json, os, tempfile
BASE='http://localhost:3000'; TMP=tempfile.gettempdir()
def req(m,p,token=None,body=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+p,data=data,method=m)
    if token: r.add_header('Authorization','Bearer '+token)
    if data is not None: r.add_header('Content-Type','application/json')
    try:
        x=urllib.request.urlopen(r); return x.status, x.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
def token(e,role):
    s,b=req('POST','/auth/token',body={'employeeId':e,'role':role}); assert s==201,(s,b); return json.loads(b)['accessToken']
def upload(t,rid,fn,content=b'x'):
    b=os.path.join(TMP,fn); open(b,'wb').write(content); fb=open(b,'rb').read()
    bd=(b'--B\r\nContent-Disposition: form-data; name="file"; filename="'+fn.encode()+b'"\r\nContent-Type: application/octet-stream\r\n\r\n'+fb+b'\r\n--B--\r\n')
    r=urllib.request.Request(BASE+'/requests/%s/document'%rid,data=bd,method='POST'); r.add_header('Authorization','Bearer '+t); r.add_header('Content-Type','multipart/form-data; boundary=B')
    try: x=urllib.request.urlopen(r); return x.status,x.read().decode()
    except urllib.error.HTTPError as e: return e.code,e.read().decode()
def check(n,c,e=''): print(('PASS' if c else 'FAIL'),'-',n,e)

empv=token('empv','STANDARD'); admin=token('admin1','HR_ADMIN')
s,b=req('POST','/requests',token=empv,body={'title':'V'}); ridV=json.loads(b)['id']
s12,_=req('PATCH','/requests/%s'%ridV,token=empv,body={'title':'x','version':999})
check('optimistic concurrency stale version -> 409', s12==409, s12)

s,b=req('POST','/requests',token=empv,body={'title':'D'}); ridD=json.loads(b)['id']
req('PATCH','/requests/%s'%ridD,token=admin,body={'state':'IN_PROGRESS'})
upload(admin,ridD,'ok.pdf',b'%PDF')
s13,_=req('DELETE','/requests/%s/document'%ridD,token=admin)
s14,_=req('GET','/requests/%s/document'%ridD,token=empv)
check('HR delete doc -> 200', s13==200, s13)
check('deleted doc GET -> 404', s14==404, s14)
print('DONE')

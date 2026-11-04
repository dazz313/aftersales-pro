import urllib.request
try:
    r = urllib.request.urlopen('http://127.0.0.1:20128/api/health')
    print('health:', r.status, r.read().decode())
except Exception as e:
    print('ERR:', e)

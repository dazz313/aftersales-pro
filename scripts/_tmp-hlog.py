import os
import glob
base = '/opt/data/logs'
for root, dirs, files in os.walk(base):
    for f in files:
        p = os.path.join(root, f)
        print(p)
        try:
            with open(p) as fh:
                lines = fh.readlines()
            print('--- last 15 lines ---')
            for l in lines[-15:]:
                print(l.rstrip())
        except Exception as e:
            print('err', e)
        print('====')

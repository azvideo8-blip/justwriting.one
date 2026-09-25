import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("         tokens     = coalesce(public.ai_global_daily.tokens, 0) + $3::int\n","")
open(p,'w').write(s)

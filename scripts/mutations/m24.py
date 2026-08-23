import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""    .flatMap(e => [e.slice(0, -1), ...(e.length >= 6 ? [e.slice(0, -2)] : [])])
    .filter(stem => stem.length >= 3);""","""    .map(e => e.slice(0, -1))
    .filter(stem => stem.length >= 3);""")
open(p,'w').write(s)

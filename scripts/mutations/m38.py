import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""  res.on('close', () => {
    clientGone = true;
    controller.abort();
  });""","")
open(p,'w').write(s)

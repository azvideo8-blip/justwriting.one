import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""  res.on('close', () => {
    controller.abort();
    void settlement.settle('closed').catch((e) => console.error('[chat] settle on close', e));
  });""","")
open(p,'w').write(s)

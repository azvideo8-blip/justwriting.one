import sys
p=sys.argv[1]; s=open(p).read()
# 3.8 (0.10.3): оба обработчика close начинаются с clientClosed = true,
# во втором ещё clearTimeout(deadlineId) — шаблон держит обе ветки.
s=s.replace("""  res.on('close', () => {
    clientClosed = true;
    controller.abort();
    void settlement.settle('closed').catch((e) => console.error('[chat] settle on close', safeErrorShape(e)));
  });""","")
s=s.replace("""  res.on('close', () => {
    clientClosed = true;
    clearTimeout(deadlineId);
    controller.abort();
    void settlement.settle('closed').catch((e) => console.error('[chat] settle on close', safeErrorShape(e)));
  });""","")
open(p,'w').write(s)

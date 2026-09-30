import sys
p=sys.argv[1]; s=open(p).read()
# L-10 (R4-071): якорь `[uid, chargedDay, kind],` встречается в файле дважды —
# и в refundDailyLimit, и в refundBulkLimit. Мутация обязана трогать только
# refundDailyLimit, поэтому якорь — с хвостом до её console.error, и несовпадение
# числа вхождений ломает прогон, а не оставляет защиту на месте.
old = """      [uid, chargedDay, kind],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundDailyLimit error', e);"""
new = """      [uid, today(), kind],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundDailyLimit error', e);"""
n = s.count(old)
assert n == 1, f"anchor matches {n} times in {p} — anchor must be unique"
open(p,'w').write(s.replace(old, new))

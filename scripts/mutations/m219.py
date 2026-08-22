import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""    // Refund целится в день СПИСАНИЯ. Раньше здесь был today() на момент
    // неудачи: запрос, списавший квоту в 23:58 и упавший после полуночи,
    // возвращал единицу в пустую строку — юзер терял её навсегда.
    const date = chargedDay ?? today();""","""    const date = today();""")
open(p,'w').write(s)

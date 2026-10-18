// Должен быть ПЕРВЫМ импортом main.tsx. zod 4 решает «можно ли eval» при
// создании схемы (проба `new Function("")`), а схемы создаются на верхнем уровне
// модулей — ещё до тела main.tsx. Наш CSP (script-src без unsafe-eval) пробу
// блокирует и шлёт отчёт о нарушении с каждой страницы; вызов `z.config` в теле
// main.tsx приходил поздно (0.10.1: проба в vendor-ai на /login, /, /privacy).
import { config } from 'zod';

config({ jitless: true });

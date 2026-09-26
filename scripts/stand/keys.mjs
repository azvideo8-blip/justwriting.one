// Ключи стенда: новый JWT-секрет и anon/service ключи на каждый подъём.
import { createHmac, randomBytes } from 'node:crypto';
const secret = randomBytes(32).toString('hex');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = p => { const h = b64({ alg: 'HS256', typ: 'JWT' }), b = b64(p); return `${h}.${b}.${createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`; };
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
console.log(`JWT_SECRET=${secret}\nANON_KEY=${sign({ role: 'anon', iss: 'supabase', exp })}\nSERVICE_KEY=${sign({ role: 'service_role', iss: 'supabase', exp })}`);

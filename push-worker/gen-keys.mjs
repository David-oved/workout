// יוצר מפתחות VAPID (ECDSA P-256) פעם אחת. המפתח הפרטי נכתב רק ל-.dev.vars (לא נכנס ל-git), הציבורי מודפס.
import { webcrypto as c } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const out = new URL('./.dev.vars', import.meta.url);
if (existsSync(out)) { console.log('.dev.vars כבר קיים, לא יוצר מפתחות חדשים'); process.exit(0); }
const kp = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = await c.subtle.exportKey('jwk', kp.privateKey);
const pub = new Uint8Array(await c.subtle.exportKey('raw', kp.publicKey));
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
writeFileSync(out, `VAPID_PRIVATE_JWK='${JSON.stringify(priv)}'\n`);
console.log('PUBLIC=' + b64u(pub));

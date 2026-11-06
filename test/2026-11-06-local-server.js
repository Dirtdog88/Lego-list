// Local preview: `npm run preview`, then open http://localhost:8788 (and /admin).
// Uses a fake database with sample sets, a small catalog (the sets in helpers.js) and the
// Turnstile bypass, so it works with no Cloudflare account and no network.
import { createServer } from 'node:http';
import { handle } from '../src/2026-11-06-index.js';
import { makeEnv, fakeNet, insertSet, RB_SETS } from './2026-11-06-helpers.js';

const PORT = Number(process.env.PORT ?? 8788);
const env = makeEnv({
  DEV_BYPASS: 'yes-local-only',
  DEV_BYPASS_EMAIL: 'admin@example.com',
  TURNSTILE_BYPASS: 'yes-local-only',
  TURNSTILE_SITE_KEY: 'local-preview',
});

const SAMPLE = [
  ['42143-1', 'Ferrari Daytona SP3', 'Technic', 'owned', 2022, 3778],
  ['60337-1', 'Express Passenger Train', 'City', 'owned', 2022, 764],
  ['31120-1', 'Medieval Castle', 'Creator', 'owned', 2021, 1426],
  ['75192-1', 'Millennium Falcon', 'Star Wars', 'wishlist', 2017, 7541],
  ['10305-1', "Lion Knights' Castle", 'Icons', 'wishlist', 2022, 4514],
  ['71411-1', 'The Mighty Bowser', 'Super Mario', 'claimed', 2022, 2807],
  ['21330-1', 'Home Alone', 'Ideas', 'wishlist', 2021, 3955],
];
for (const [set_num, name, theme, status, year, pieces] of SAMPLE) {
  const id = await insertSet(env, { set_num, name, theme, status });
  await env.DB.prepare('UPDATE sets SET year = ?, pieces = ? WHERE id = ?').bind(year, pieces, id).run();
}

const net = fakeNet();
createServer(async (nodeReq, nodeRes) => {
  const chunks = [];
  for await (const c of nodeReq) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${PORT}${nodeReq.url}`, {
    method: nodeReq.method,
    headers: Object.fromEntries(Object.entries(nodeReq.headers).filter(([, v]) => typeof v === 'string')),
    body: nodeReq.method === 'GET' || nodeReq.method === 'HEAD' ? undefined : body,
  });
  const res = await handle(request, env, { fetch: net });
  nodeRes.writeHead(res.status, Object.fromEntries(res.headers));
  nodeRes.end(Buffer.from(await res.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`Lego list preview: http://localhost:${PORT}  (admin: /admin)`);
  console.log(`The sample catalog knows: ${Object.keys(RB_SETS).join(', ')}`);
});

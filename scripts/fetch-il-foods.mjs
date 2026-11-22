import { writeFileSync } from 'node:fs';
const RES = 'c3cb0630-0650-46c1-a068-82d575c094b2';
const fields = 'Code,shmmitzrach,protein,total_fat,carbohydrates,food_energy,makor,english_name,edible';
const out = [];
for (let off = 0; ; off += 1000) {
  const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${RES}&limit=1000&offset=${off}&fields=${fields}`;
  const r = await fetch(url);
  const j = await r.json();
  const recs = j.result.records;
  out.push(...recs);
  console.log(off, recs.length, j.result.total);
  if (recs.length < 1000) break;
}
writeFileSync(new URL('./il-raw.json', import.meta.url), JSON.stringify(out));
console.log('total', out.length);

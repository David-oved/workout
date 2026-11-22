// הופך את הקובץ הגולמי ממאגר משרד הבריאות (data.gov.il, "צמרת") לקובץ קומפקטי שהאפליקציה טוענת בעצלתיים.
// שימוש: node scripts/fetch-il-foods.mjs  (יוצר il-raw.json לצד הסקריפט)  ואז  node scripts/build-il-foods.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync(new URL('./il-raw.json', import.meta.url), 'utf8'));
const r1 = (n) => Math.round(Number(n) * 10) / 10;
const rows = raw
  .filter((x) => x.shmmitzrach && x.food_energy != null)
  .map((x) => [x.Code, String(x.shmmitzrach).replace(/\s+/g, ' ').trim(), Math.round(x.food_energy), r1(x.protein), r1(x.carbohydrates), r1(x.total_fat)]);
writeFileSync(new URL('../src/data/il-foods.json', import.meta.url), JSON.stringify(rows));
console.log('rows', rows.length);

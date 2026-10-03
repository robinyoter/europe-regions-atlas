import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
export async function checkPopulation(){
  const [geo,data]=await Promise.all(['regions.geojson','population.json'].map(async file=>JSON.parse(await fs.readFile(new URL('../public/data/'+file,import.meta.url),'utf8'))));
  const ids=geo.features.map(f=>f.properties.id);
  assert.equal(ids.length,456);
  assert.deepEqual(Object.keys(data.records).sort(),ids.slice().sort(),'Population must cover exactly the selectable regions');
  const years={};
  for(const [id,p]of Object.entries(data.records)){
    assert.ok(Number.isSafeInteger(p.value)&&p.value>0,`${id}: invalid population`);
    assert.ok(Number.isInteger(p.year)&&p.year>=2011&&p.year<=2025,`${id}: invalid reference year`);
    assert.ok(data.sources[p.source],`${id}: missing source`);
    if(p.referenceDate){assert.match(p.referenceDate,/^\d{4}-\d{2}-\d{2}$/);assert.equal(Number(p.referenceDate.slice(0,4)),p.year);assert.ok(Number.isFinite(Date.parse(p.referenceDate)));}
    if(p.coverage){assert.ok(['partial','approximate'].includes(p.coverage));assert.ok(p.note?.length>30,`${id}: explain incomplete coverage`);}
    if(p.rounding)assert.equal(p.value%p.rounding,0,`${id}: rounding`);
    years[p.year]=(years[p.year]??0)+1;
  }
  for(const s of Object.values(data.sources))assert.equal(new URL(s.url).protocol,'https:');
  const total=country=>geo.features.filter(f=>f.properties.countryCode===country).reduce((n,f)=>n+data.records[f.properties.id].value,0);
  // Independent published totals detect missing/duplicated municipalities and
  // double counting of Russia's nested autonomous okrugs.
  for(const [country,expected]of Object.entries({RUS:143659377,BLR:9109280,MLT:574250,LIE:41228,AND:89058,SMR:34059,ALB:2363314,IRL:5149139,ISL:389444,PRT:11424031,HRV:3874350,HUN:9539502,SRB:6567783,BGR:6437360,CZE:10909500,ROU:19053815}))assert.equal(total(country),expected,`${country}: published population total`);
  // Romania uses the 2021 census; Czech historical totals use 2025 municipalities.
  for(const f of geo.features.filter(f=>['ROU','CZE'].includes(f.properties.countryCode))){const p=data.records[f.properties.id];assert.equal(p.year,f.properties.countryCode==='ROU'?2021:2025);assert.equal(p.coverage,'approximate');}
  const iso=code=>data.records[geo.features.find(f=>f.properties.isoCode===code).properties.id];
  assert.equal(iso('RU-ARK').value,947528);assert.equal(iso('RU-TYU').value,1626809);
  assert.equal(data.records['GBR-ENG-CITY-OF-LONDON'].year,2025);
  assert.equal(data.records['GBR-ENG-DURHAM'].year,2024);
  assert.equal(data.records['GBR-ENG-NORTH-YORKSHIRE'].year,2024);
  assert.equal(data.records['MDA-REST'].coverage,'partial');
  assert.equal(data.records['CYP-SOUTH'].value,983000);assert.equal(data.records['CYP-SOUTH'].coverage,'partial');
  assert.equal(data.records['CYP-NORTH'].value,489308);assert.equal(data.records['CYP-NORTH'].year,2024);
  assert.equal(data.records['CYP-NORTH'].referenceDate,'2024-12-31');
  assert.match(data.sources.northCyprus.url,/ISTATIISTIK_YILLIK_2024_1\.pdf$/);
  return {regions:ids.length,sources:Object.keys(data.sources).length,years,limitedCoverage:Object.values(data.records).filter(p=>p.coverage).length};
}
if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop()))console.log(JSON.stringify(await checkPopulation(),null,2));

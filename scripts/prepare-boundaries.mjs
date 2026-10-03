import fs from 'node:fs/promises';
import path from 'node:path';
import ms from 'mapshaper';

const cache = path.resolve(process.env.ATLAS_BOUNDARY_CACHE || '.sites-runtime/boundary-cache');
let metadata;
if(process.env.ATLAS_METADATA_FILE){
  metadata=JSON.parse(await fs.readFile(process.env.ATLAS_METADATA_FILE,'utf8'));
}else{
  const response=await fetch('https://www.geoboundaries.org/api/current/gbOpen/ALL/ALL/');
  if(!response.ok)throw new Error(`Metadata HTTP ${response.status}`);
  metadata=await response.json();
}
const specs = [
  ['ALB','Албания'],['AND','Андорра'],['AUT','Австрия'],
  ['BEL','Бельгия'],['BGR','Болгария'],
  ['BIH','Босния и Герцеговина'],['BLR','Беларусь'],['CHE','Швейцария'],
  ['CYP','Кипр'],['CZE','Чехия'],['DEU','Германия'],['DNK','Дания'],
  ['ESP','Испания'],['EST','Эстония'],['FIN','Финляндия'],['FRA','Франция'],
  ['GBR','Великобритания'],['GRC','Греция','ADM2'],
  ['HRV','Хорватия'],['HUN','Венгрия'],['IRL','Ирландия'],['ISL','Исландия'],
  ['ITA','Италия','ADM2'],['LIE','Лихтенштейн'],['LTU','Литва'],
  ['LUX','Люксембург'],['LVA','Латвия'],['MCO','Монако'],['MDA','Молдова'],
  ['MKD','Северная Македония'],['MLT','Мальта'],['MNE','Черногория'],
  ['NLD','Нидерланды'],['NOR','Норвегия'],['POL','Польша'],['PRT','Португалия'],
  ['ROU','Румыния'],['RUS','Россия'],['SMR','Сан-Марино'],['SRB','Сербия'],
  ['SVK','Словакия'],['SVN','Словения','ADM2'],['SWE','Швеция'],
  ['UKR','Украина'],['VAT','Ватикан','ADM0'],['XKX','Косово','ADM2'],
];
await fs.mkdir(cache,{recursive:true});
await fs.mkdir('public/data',{recursive:true});

async function downloadFile(url, filename) {
  const target=path.join(cache,filename);
  try{await fs.access(target);return target;}catch{}
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url.replace('https://github.com/wmgeolab/geoBoundaries/raw/', 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/'),{signal:AbortSignal.timeout(300000)});
      if(!response.ok)throw new Error(`${response.status} ${url}`);
      await fs.writeFile(target,Buffer.from(await response.arrayBuffer()));
      return target;
    }catch(error){console.log(`${filename}: download attempt ${attempt+1} failed (${error.message})`);if(attempt===2)throw new Error(`Download failed: ${filename}`,{cause:error});}
  }
}

let cursor=0;
const results=[];
await Promise.all(Array.from({length:6},async()=>{
  while(cursor<specs.length){
    const [iso,country,level='ADM1']=specs[cursor++];
    const meta=metadata.find(m=>m.boundaryISO===iso&&m.boundaryType===level);
    if(!meta)throw new Error(`Missing source: ${iso} ${level}`);
    const file=await downloadFile(meta.gjDownloadURL,`${iso}-${level}-full.geojson`);
    results.push({iso,country,meta,file});
    console.log(`${iso}: detailed source ready`);
  }
}));

const regions=[];
const sources=[];
for(const result of results.sort((a,b)=>a.iso.localeCompare(b.iso))){
  const {iso,country,meta,file}=result;
  const prepared=path.join(cache,`${iso}-${meta.boundaryType}-detail100.geojson`);
  try{await fs.access(prepared);}catch{
    const contents=await fs.readFile(file,'utf8');
    const output=await ms.applyCommands('-i input.geojson -simplify dp interval=100 keep-shapes -o output.geojson format=geojson precision=0.000001',{'input.geojson':contents});
    await fs.writeFile(prepared,output['output.geojson']);
  }
  const geo=JSON.parse(await fs.readFile(prepared,'utf8'));
  if(!geo.features?.length)throw new Error(`Empty source: ${iso}`);
  sources.push({iso,country,source:meta.boundarySource,url:meta.boundarySourceURL,download:meta.gjDownloadURL,license:meta.boundaryLicense,licenseUrl:meta.licenseSource,year:meta.boundaryYearRepresented,level:meta.boundaryType,units:geo.features.length});
  for(const feature of geo.features){
    if(!feature.geometry||!['Polygon','MultiPolygon'].includes(feature.geometry.type))throw new Error(`Invalid polygon ${iso}`);
    const p=feature.properties;
    const name=p.shapeName||p.name||country;
    const id=`${iso}-${p.shapeID||p.shapeISO||String(regions.length)}`;
    regions.push({type:'Feature',id,properties:{id,name,country,countryCode:iso,sourceLevel:meta.boundaryType,sourceYear:meta.boundaryYearRepresented,sourceId:p.shapeID??null,isoCode:p.shapeISO??null},geometry:feature.geometry});
  }
}
await fs.writeFile('public/data/regions.raw.geojson',JSON.stringify({type:'FeatureCollection',features:regions}));
await fs.writeFile('public/data/sources.json',JSON.stringify({generated:'2026-10-02',scope:'European countries. Turkey, Armenia, Azerbaijan and Georgia are excluded. Overseas territories are excluded from the initial viewport.',sources},null,2));
const world=JSON.parse(await fs.readFile(await downloadFile('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson','world-10m.geojson'),'utf8'));
await fs.writeFile('public/data/world.geojson',JSON.stringify({type:'FeatureCollection',features:world.features.filter(f=>!specs.some(s=>s[0]===({KOS:'XKX'}[f.properties.ADM0_A3]||f.properties.ADM0_A3))).map(f=>({type:'Feature',properties:{name:f.properties.ADMIN},geometry:f.geometry}))}));
console.log(`Complete: ${regions.length} regions / ${results.length} countries`);

import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';

export async function prepareFlags(){
  const root=new URL('../',import.meta.url);
  const catalog=JSON.parse(await fs.readFile(new URL('data/flags/catalog.json',root),'utf8'));
  const geo=JSON.parse(await fs.readFile(new URL('public/data/regions.geojson',root),'utf8'));
  const keys=new Set(geo.features.map(f=>f.properties.isoCode&&/^[A-Z]{2}-[A-Z0-9]+$/.test(f.properties.isoCode)?f.properties.isoCode:f.properties.id));
  const records={};
  const paintCache=new URL('.sites-runtime/flag-paint-cache/',root);
  await fs.mkdir(paintCache,{recursive:true});
  for(const [key,entry]of Object.entries(catalog.records)){
    if(!keys.has(key))throw Error(`Flag has no matching region: ${key}`);
    const file=path.posix.normalize(entry.file);
    if(!file.startsWith('flags/')||file.includes('..')||!/[.](svg|png)$/.test(file))throw Error(`Invalid local flag path: ${key}`);
    const bytes=await fs.readFile(new URL('public/'+file,root));
    if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error(`Flag integrity mismatch: ${key}`);
    const isSvg=file.endsWith('.svg');
    if(isSvg){
      const svg=bytes.toString('utf8');
      if(!/<svg[\s>]/i.test(svg)||/<(?:script|foreignObject|image)\b|\bon\w+\s*=|(?:href|url)\s*[=(]\s*["']?(?:https?:|\/\/)/i.test(svg))throw Error(`Flag must be self-contained vector artwork: ${key}`);
    }else if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error(`Invalid PNG flag: ${key}`);
    const {sha256,file:localFile,...metadata}=entry;
    // SVG images are re-rasterized during SVG zoom in Chromium. A fixed-resolution
    // paint copy avoids that work; cards and attribution retain the source SVG.
    let mapImage;
    if(isSvg){
      const cached=new URL(`${key}-${sha256}-1024.png`,paintCache);
      let paint;try{paint=await fs.readFile(cached);}catch{}
      if(!paint){
        paint=await sharp(bytes).resize({width:1024}).png().toBuffer();
        await fs.writeFile(cached,paint);
      }
      if(paint.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error(`Invalid flag paint cache: ${key}`);
      mapImage='data:image/png;base64,'+paint.toString('base64');
    }
    records[key]={...metadata,image:`data:image/${isSvg?'svg+xml':'png'};base64,`+bytes.toString('base64'),...(mapImage?{mapImage}:{})};
  }
  const colors=catalog.colors??{};
  for(const [key,entry]of Object.entries(colors)){
    if(!keys.has(key)||records[key])throw Error(`Invalid or conflicting region color: ${key}`);
    if(!/^#[0-9a-f]{6}$/i.test(entry.color))throw Error(`Invalid color: ${key}`);
  }
  const result={updated:catalog.updated,description:catalog.description,records,colors};
  const json=JSON.stringify(result);
  const destination=new URL('public/data/flags.json',root);
  let before;try{before=await fs.readFile(destination,'utf8');}catch{}
  if(before!==json)await fs.writeFile(destination,json);
  console.log(JSON.stringify({flags:Object.keys(records).length,colors:Object.keys(colors).length,bytes:Buffer.byteLength(json)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepareFlags();

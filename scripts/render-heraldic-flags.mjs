import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=new URL('../',import.meta.url);
const designs=JSON.parse(await fs.readFile(new URL('data/flags/heraldic-designs.json',root),'utf8'));
const catalog=JSON.parse(await fs.readFile(new URL('data/flags/catalog.json',root),'utf8'));
for(const [key,design]of Object.entries(designs)){
 const components=[];
 for(const part of design.components){
  const bytes=await fs.readFile(new URL(part.file,root));
  if(createHash('sha256').update(bytes).digest('hex')!==part.sha256)throw Error('Heraldic source changed '+key);
  let artwork=bytes;
  if(part.file.endsWith('.svg')){
   let svg=bytes.toString('utf8');
   // Some historical source files omit editor metadata namespaces. Declaring
   // these prefixes repairs XML parsing without changing any drawing geometry.
   for(const [prefix,uri]of Object.entries({sodipodi:'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',inkscape:'http://www.inkscape.org/namespaces/inkscape'}))if(svg.includes(prefix+':')&&!svg.includes('xmlns:'+prefix+'='))svg=svg.replace('<svg','<svg xmlns:'+prefix+'="'+uri+'"');
   artwork=Buffer.from(svg);
  }
  const rendered=await sharp(artwork).resize({width:part.box[2],height:part.box[3],fit:'inside'}).png().toBuffer();
  const meta=await sharp(rendered).metadata();
  components.push({input:rendered,left:part.box[0]+Math.round((part.box[2]-meta.width)/2),top:part.box[1]+Math.round((part.box[3]-meta.height)/2)});
 }
 const bytes=await sharp({create:{width:1200,height:800,channels:4,background:design.background}}).composite(components).png().toBuffer();
 const entry=catalog.records[key];
 entry.file=design.output??'flags/ro/'+key+'.png';entry.width=1200;entry.height=800;entry.format='png';
 entry.sha256=createHash('sha256').update(bytes).digest('hex');entry.variant=design.variant??'Неофициальный геральдический флаг · создан для карты';
 entry.processing=design.processing??'Полотнище создано для карты на основе исторических гербов; фон и композиция являются проектным вариантом.';
 entry.components=design.components.map(({box,file,...metadata})=>metadata);
 await fs.writeFile(new URL('public/'+entry.file,root),bytes);
}
await fs.writeFile(new URL('data/flags/catalog.json',root),JSON.stringify(catalog,null,2));
console.log('Rendered '+Object.keys(designs).length+' unofficial heraldic flags.');

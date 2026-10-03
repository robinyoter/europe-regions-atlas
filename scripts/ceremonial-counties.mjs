import fs from 'node:fs/promises';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import ms from 'mapshaper';

export const countiesDocumentation='https://docs.os.uk/os-downloads/products/areas-and-zones-portfolio/boundary-line/boundary-line-downloads';
// Names follow the Ordnance Survey guide; aliases normalize the shapefile labels.
export const ceremonialCountyNames=[
  'Bedfordshire','Berkshire','Bristol','Buckinghamshire','Cambridgeshire','Cheshire',
  'City of London','Cornwall','Cumbria','Derbyshire','Devon','Dorset','Durham',
  'East Riding of Yorkshire','East Sussex','Essex','Gloucestershire','Greater London',
  'Greater Manchester','Hampshire','Herefordshire','Hertfordshire','Isle of Wight',
  'Kent','Lancashire','Leicestershire','Lincolnshire','Merseyside','Norfolk',
  'North Yorkshire','Northamptonshire','Northumberland','Nottinghamshire','Oxfordshire',
  'Rutland','Shropshire','Somerset','South Yorkshire','Staffordshire','Suffolk','Surrey',
  'Tyne and Wear','Warwickshire','West Midlands','West Sussex','West Yorkshire',
  'Wiltshire','Worcestershire',
];
const aliases={'City and County of the City of London':'City of London','Tyne & Wear':'Tyne and Wear'};

// Read ZIP members into memory: no archive paths are written to the filesystem.
function shapefileMembers(zip){
  let eocd=zip.length-22;
  while(eocd>=0&&zip.readUInt32LE(eocd)!==0x06054b50)eocd--;
  if(eocd<0)throw Error('Invalid Ordnance Survey ZIP');
  const files={};let cursor=zip.readUInt32LE(eocd+16);
  while(cursor<eocd&&zip.readUInt32LE(cursor)===0x02014b50){
    const nameLength=zip.readUInt16LE(cursor+28),extraLength=zip.readUInt16LE(cursor+30),commentLength=zip.readUInt16LE(cursor+32);
    const name=zip.subarray(cursor+46,cursor+46+nameLength).toString();
    if(/\.(shp|shx|dbf|prj)$/i.test(name)){
      const method=zip.readUInt16LE(cursor+10),size=zip.readUInt32LE(cursor+20),local=zip.readUInt32LE(cursor+42);
      const offset=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
      if(method!==0&&method!==8)throw Error('Unsupported ZIP compression');
      const compressed=zip.subarray(offset,offset+size),basename=path.posix.basename(name);
      if(files[basename])throw Error(`Duplicate ZIP member ${basename}`);
      files[basename]=method===8?inflateRawSync(compressed):compressed;
    }
    cursor+=46+nameLength+extraLength+commentLength;
  }
  return files;
}

export async function prepareCeremonialCounties(cache){
  const target=path.join(cache,'britain-ceremonial-100m.geojson');
  try{await fs.access(target);return;}catch{}
  const zipPath=path.join(cache,'england-ceremonial-os.zip');
  try{await fs.access(zipPath);}catch{
    const page=await fetch(countiesDocumentation,{headers:{accept:'text/html'},signal:AbortSignal.timeout(90000)});
    if(!page.ok)throw Error(`OS documentation HTTP ${page.status}`);
    const html=await page.text();
    const url=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(value=>value.includes('boundary-line-ceremonial-counties-shp.zip'));
    if(!url)throw Error('OS ceremonial county download link missing');
    const response=await fetch(url,{signal:AbortSignal.timeout(90000)});
    if(!response.ok)throw Error(`OS counties HTTP ${response.status}`);
    await fs.writeFile(zipPath,Buffer.from(await response.arrayBuffer()));
  }
  const members=shapefileMembers(await fs.readFile(zipPath));
  const shp=Object.keys(members).find(name=>name.endsWith('.shp'));
  if(!shp)throw Error('OS archive has no shapefile');
  const output=await ms.applyCommands(`-i ${shp} -proj wgs84 -o counties.geojson format=geojson`,members);
  let geo=JSON.parse(output['counties.geojson']);
  for(const feature of geo.features)feature.properties.NAME=aliases[feature.properties.NAME]??feature.properties.NAME;
  const expected=new Set(ceremonialCountyNames);
  const english=geo.features.filter(feature=>expected.has(feature.properties.NAME));
  if(english.length!==48||new Set(english.map(f=>f.properties.NAME)).size!==48||geo.features.length!==91)throw Error('Expected 48 English counties and 91 British ceremonial areas');
  // Preserve shared county edges, while reducing the full-resolution OS coastline.
  const simplified=await ms.applyCommands('-i input.geojson -simplify dp interval=100 keep-shapes -o counties.geojson format=geojson precision=0.000001',{'input.geojson':JSON.stringify(geo)});
  await fs.writeFile(target,simplified['counties.geojson']);
  console.log('Britain: detailed OS outlines, including 48 English ceremonial counties');
}

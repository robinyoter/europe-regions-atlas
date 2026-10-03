import fs from 'node:fs/promises';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {prepareCeremonialCounties} from './ceremonial-counties.mjs';
import {prepareLandCoastline} from './land-coastline.mjs';
const cache=path.resolve(process.env.ATLAS_BOUNDARY_CACHE || '.sites-runtime/boundary-cache');
await fs.mkdir(cache,{recursive:true});
const files=[
  ['ireland-cso.geojson','https://cdn.cso.ie/static/map/en/ie_county_31_2019.json'],
  ['malta-riu.geojson','https://services-eu1.arcgis.com/IR9ryIcXWG5koVHs/ArcGIS/rest/services/Malta_LAU2/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson'],
  ['iceland-lmi.geojson','https://gis.lmi.is/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=IS_50V:mork_sveitarf_svaedi&outputFormat=application/json&srsName=EPSG:4326'],
  ['nuts3.geojson','https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2024_4326_LEVL_3.geojson'],
];
await Promise.all(files.map(async([name,url])=>{
  try{await fs.access(path.join(cache,name));return;}catch{}
  const response=await fetch(url,{signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);
  const json=await response.json();if(!json.features?.length)throw Error(`${name}: no features`);
  await fs.writeFile(path.join(cache,name),JSON.stringify(json));
}));
for(const iso of ['ISL']){
  const name=`${iso}-ADM2.geojson`;try{await fs.access(path.join(cache,name));continue;}catch{}
  const metadata=await(await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/ADM2/`)).json();
  const url=metadata.simplifiedGeometryGeoJSON.replace('https://github.com/wmgeolab/geoBoundaries/raw/','https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/');
  const json=await(await fetch(url)).json();await fs.writeFile(path.join(cache,name),JSON.stringify(json));
}
try{await fs.access(path.join(cache,'norway.geojson'));}catch{
  const url='https://testnedlasting.geonorge.no/geonorge/Basisdata/Fylker/GeoJSON/Basisdata_0000_Norge_4258_Fylker_GeoJSON.zip';
  const response=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error(`Norway HTTP ${response.status}`);
  const zip=Buffer.from(await response.arrayBuffer());
  let eocd=zip.length-22;while(eocd>=0&&zip.readUInt32LE(eocd)!==0x06054b50)eocd--;
  if(eocd<0)throw Error('Invalid Norway ZIP');
  let cursor=zip.readUInt32LE(eocd+16),found=false;
  while(cursor<eocd&&zip.readUInt32LE(cursor)===0x02014b50){
    const nameLength=zip.readUInt16LE(cursor+28),extraLength=zip.readUInt16LE(cursor+30),commentLength=zip.readUInt16LE(cursor+32);
    const name=zip.subarray(cursor+46,cursor+46+nameLength).toString();
    if(name.endsWith('.geojson')){
      const method=zip.readUInt16LE(cursor+10),size=zip.readUInt32LE(cursor+20),local=zip.readUInt32LE(cursor+42);
      const dataOffset=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
      const compressed=zip.subarray(dataOffset,dataOffset+size);
      if(method!==0&&method!==8)throw Error('Unsupported ZIP compression');
      await fs.writeFile(path.join(cache,'norway.geojson'),method===8?inflateRawSync(compressed):compressed);found=true;break;
    }
    cursor+=46+nameLength+extraLength+commentLength;
  }
  if(!found)throw Error('Norway archive contains no GeoJSON');
}
await prepareCeremonialCounties(cache);
await prepareLandCoastline(cache);
console.log('Supplemental national boundaries are ready.');

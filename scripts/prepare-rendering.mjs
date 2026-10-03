import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import ms from 'mapshaper';
import {geoArea,geoAzimuthalEqualArea,geoGraticule10,geoPath} from 'd3';

const intervals=[3000,1000,300,0];
const config={version:1,width:1200,height:920,rotate:[-18,-54],scale:1010,clipAngle:85,precision:.15,intervals};
function orient(geo){
  for(const f of geo.features){
    if(!f.geometry)continue;
    const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const coordinates of polygons)if(geoArea({type:'Polygon',coordinates})>2*Math.PI)coordinates.forEach(r=>r.reverse());
  }
  return geo;
}
export async function prepareRendering(){
  const buffers=await Promise.all(['regions','world'].map(name=>fs.readFile(`public/data/${name}.geojson`)));
  const inputHash=createHash('sha256').update(JSON.stringify(config)).update(buffers[0]).update(buffers[1]).digest('hex');
  try{
    const metadata=JSON.parse(await fs.readFile('public/data/map-render-meta.json','utf8'));
    if(metadata.inputHash===inputHash){await fs.access('public/data/map-render.json');return;}
  }catch{}
  const projection=geoAzimuthalEqualArea().rotate(config.rotate).clipAngle(config.clipAngle).translate([600,460]).scale(config.scale).precision(config.precision);
  const path=geoPath(projection);
  const safeBounds=feature=>{
    const bounds=path.bounds(feature);
    return bounds.flat().every(Number.isFinite)?bounds:null;
  };
  const regional=JSON.parse(buffers[0]),world=JSON.parse(buffers[1]);
  for(const [index,feature]of world.features.entries())feature.properties.renderId=String(index);
  const originalRegions=orient(structuredClone(regional));
  const originalWorld=orient(structuredClone(world));
  const regions=originalRegions.features.map(feature=>({properties:feature.properties,bounds:safeBounds(feature),point:path.centroid(feature),area:path.area(feature),paths:[]}));
  const background=originalWorld.features.map(feature=>({bounds:safeBounds(feature),paths:[]}));
  const vertices=[];
  for(const interval of intervals){
    const simplify=async geo=>{
      if(!interval)return orient(structuredClone(geo));
      const result=await ms.applyCommands(`-i input.geojson -simplify dp interval=${interval} keep-shapes -o out.geojson format=geojson precision=0.000001`,{'input.geojson':JSON.stringify(geo)});
      return orient(JSON.parse(result['out.geojson']));
    };
    const [levelRegions,levelWorld]=await Promise.all([simplify(regional),simplify(world)]);
    const regionById=new Map(levelRegions.features.map(f=>[f.properties.id,f]));
    const worldById=new Map(levelWorld.features.map(f=>[f.properties.renderId,f]));
    for(const [index,item]of regions.entries()){
      const feature=regionById.get(item.properties.id);
      item.paths.push(path(feature?.geometry?feature:originalRegions.features[index])??'');
    }
    for(const [index,item]of background.entries()){
      const feature=worldById.get(String(index));
      item.paths.push(path(feature?.geometry?feature:originalWorld.features[index])??'');
    }
    vertices.push({interval,characters:regions.reduce((n,r)=>n+r.paths.at(-1).length,0)+background.reduce((n,r)=>n+r.paths.at(-1).length,0)});
  }
  const data={regions,world:background,graticule:path(geoGraticule10()),config};
  await fs.writeFile('public/data/map-render.json',JSON.stringify(data));
  await fs.writeFile('public/data/map-render-meta.json',JSON.stringify({inputHash,regions:regions.length,levels:vertices},null,2));
  console.log(JSON.stringify({prepared:regions.length,levels:vertices},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepareRendering();

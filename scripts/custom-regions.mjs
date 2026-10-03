import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import ms from 'mapshaper';
import {geoArea,geoCentroid,geoDistance} from 'd3';

const base=new URL('../data/region-layouts/',import.meta.url);
const read=async file=>JSON.parse(await fs.readFile(new URL(file,base),'utf8'));
const fc=features=>({type:'FeatureCollection',features});
export function orient(feature){
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  for(const coordinates of polygons)if(geoArea({type:'Polygon',coordinates})>2*Math.PI)coordinates.forEach(r=>r.reverse());
  return feature;
}
export async function command(input,commands){
  const result=await ms.applyCommands(`-i input.geojson ${commands} -o output.geojson format=geojson precision=0.000001`,{'input.geojson':JSON.stringify(input)});
  return JSON.parse(result['output.geojson']);
}

// Keep the existing country outline. Source masks determine the interior;
// reconcile discrepancies at the coast without moving the national edge.
export async function partition(country,masks){
  const outline=await command(country,'-dissolve countryCode');
  outline.features[0].properties={key:'__COUNTRY__'};
  const vertices=masks.features.flatMap(f=>{
    const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    return polygons.flatMap(p=>p[0].map(point=>({key:f.properties.key,point})));
  });
  const nearest=point=>{
    let key=null,distance=Infinity;
    for(const vertex of vertices){const d=geoDistance(point,vertex.point);if(d<distance){distance=d;key=vertex.key;}}
    return key;
  };
  const tiles=await command(fc([...masks.features,...outline.features]),'-mosaic calc="keys=collect(key)" -filter "!!keys&&keys.indexOf(\'__COUNTRY__\')>=0" -explode');
  tiles.features=tiles.features.filter(f=>f.geometry);
  let assignedArea=0,overlapArea=0;
  for(const tile of tiles.features){
    orient(tile);
    const keys=tile.properties.keys.filter(key=>key!=='__COUNTRY__');
    if(!keys.length)assignedArea+=geoArea(tile)*6371.0088**2;
    if(keys.length>1)overlapArea+=geoArea(tile)*6371.0088**2;
    tile.properties={key:keys.length===1?keys[0]:nearest(geoCentroid(tile))};
  }
  const result=await command(tiles,'-dissolve key');
  // Overlay slivers may collapse when coordinates are rounded to six decimals.
  result.features=result.features.filter(f=>f.geometry);
  result.features.forEach(orient);
  const area=geoArea(orient(outline.features[0]))*6371.0088**2;
  const mergedArea=result.features.reduce((sum,f)=>sum+geoArea(f)*6371.0088**2,0);
  if(Math.abs(mergedArea-area)>.5)throw Error('Region partition changed national area');
  console.log(JSON.stringify({partition:masks.features[0].properties.countryCode,regions:result.features.length,edgeReconciliationKm2:Math.round(assignedArea),sourceOverlapKm2:Math.round(overlapArea),nationalAreaDifferenceKm2:mergedArea-area}));
  return result;
}

export async function applyCustomRegions(regions,sources,population){
  const [layouts,historical,statistics]=await Promise.all(['layouts.json','historical-masks.geojson','population.json'].map(read));
  for(const layout of layouts){
    const old=regions.features.filter(f=>f.properties.countryCode===layout.iso);
    if(!old.length)throw Error(`Missing country ${layout.iso}`);
    // Applying newly added layouts must not dissolve countries already grouped.
    if(old.length===layout.groups.length&&old.every(f=>layout.groups.some(g=>g.key===f.properties.sourceId)))continue;
    const source=sources.sources.find(s=>s.iso===layout.iso);
    let grouped;
    if(layout.historical||layout.masked){
      grouped=await partition(fc(old),fc(historical.features.filter(f=>f.properties.countryCode===layout.iso)));
    }else{
      const input=structuredClone(old);
      for(const f of input){
        const matches=layout.groups.filter(g=>g.members.includes(f.properties[layout.memberField??'sourceId']));
        if(matches.length!==1)throw Error(`${layout.iso}: unmapped administrative unit ${f.properties.name}`);
        f.properties.key=matches[0].key;
      }
      grouped=await command(fc(input),'-dissolve key');
    }
    if(grouped.features.length!==layout.groups.length)throw Error(`${layout.iso}: region count`);
    const replacement=grouped.features.map(f=>{
      const g=layout.groups.find(g=>g.key===f.properties.key);
      const id=`${layout.iso}-${g.key}`;
      return {type:'Feature',id,properties:{id,name:g.name,country:source.country,countryCode:layout.iso,sourceLevel:layout.level,sourceYear:layout.year,sourceId:g.key,isoCode:null,...(layout.description?{description:layout.description}:{}),...(layout.wholeCountry?{displayMode:'whole-country'}:{})},geometry:f.geometry};
    });
    regions.features=regions.features.filter(f=>f.properties.countryCode!==layout.iso).concat(replacement);
    Object.assign(source,layout.source,{units:layout.groups.length,level:layout.level,year:layout.year});
    if(population){
      for(const id of Object.keys(population.records))if(id.startsWith(layout.iso+'-'))delete population.records[id];
      for(const f of replacement){
        const record=statistics.records[f.properties.id];
        if(!record)throw Error(`${f.properties.id}: population missing`);
        population.records[f.properties.id]=record;
      }
    }
  }
  if(population){Object.assign(population.sources,statistics.sources);population.updated=statistics.updated??'2026-10-02';}
  sources.display.wholeCountries=[...new Set([...sources.display.wholeCountries,...layouts.filter(l=>l.wholeCountry).map(l=>l.iso)])];
  sources.display.customRegions=Object.fromEntries(layouts.map(l=>[l.iso,{regions:l.groups.map(g=>g.name),note:l.source.note}]));
  regions.features.sort((a,b)=>a.properties.id.localeCompare(b.properties.id));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const files=['regions.geojson','sources.json','population.json'];
  const [regions,sources,population]=await Promise.all(files.map(async file=>JSON.parse(await fs.readFile(`public/data/${file}`,'utf8'))));
  const layouts=await read('layouts.json');
  const alreadyApplied=layouts.every(l=>regions.features.filter(f=>f.properties.countryCode===l.iso).length===l.groups.length&&regions.features.filter(f=>f.properties.countryCode===l.iso).every(f=>l.groups.some(g=>f.properties.sourceId===g.key)));
  if(alreadyApplied){console.log('Custom region layouts are already applied.');process.exit(0);}
  await applyCustomRegions(regions,sources,population);
  for(const [i,file]of files.entries())await fs.writeFile(`public/data/${file}`,JSON.stringify([regions,sources,population][i],null,file.endsWith('.json')?2:0));
  console.log(JSON.stringify({regions:regions.features.length,countries:sources.sources.length,populationRecords:Object.keys(population.records).length}));
}

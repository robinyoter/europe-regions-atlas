import fs from 'node:fs/promises';
import path from 'node:path';
import ms from 'mapshaper';
import {geoArea,geoCentroid,geoContains} from 'd3';
import {ceremonialCountyNames,countiesDocumentation} from './ceremonial-counties.mjs';

const cache=path.resolve(process.env.ATLAS_BOUNDARY_CACHE || '.sites-runtime/boundary-cache');
const read=async file=>JSON.parse((await fs.readFile(`${cache}/${file}`,'utf8')).replace(/^\uFEFF/,''));
const collection=features=>({type:'FeatureCollection',features});
const regions=JSON.parse(await fs.readFile('public/data/regions.raw.geojson','utf8'));
const sources=JSON.parse(await fs.readFile('public/data/sources.json','utf8'));
async function command(geo,commands,extra={}){
  const output=await ms.applyCommands(`-i input.geojson ${commands} -o output.geojson format=geojson precision=0.000001`,{'input.geojson':JSON.stringify(geo),...extra});
  return JSON.parse(output['output.geojson']);
}
function replace(iso,geo,source,name,id){
  const old=sources.sources.find(x=>x.iso===iso);
  regions.features=regions.features.filter(f=>f.properties.countryCode!==iso);
  for(const [index,f] of geo.features.entries()){
    const regionId=`${iso}-${id(f.properties,index)}`;
    regions.features.push({type:'Feature',id:regionId,properties:{id:regionId,name:name(f.properties),country:old.country,countryCode:iso,sourceLevel:'ADM1',sourceYear:source.year,sourceId:regionId,isoCode:null},geometry:f.geometry});
  }
  Object.assign(old,source,{units:geo.features.length,level:'ADM1'});
}

const ireland=await command(await read('ireland-cso.geojson'),'-proj from="+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +units=m +no_defs" wgs84');
const northernIreland=ireland.features.find(f=>f.properties.AREA_NAME==='Northern Ireland');
ireland.features=ireland.features.filter(f=>f.properties.AREA_NAME!=='Northern Ireland');
const provinceCounties={
  Leinster:['CW','DC','DR','FL','SD','KE','KK','LS','LD','LH','MH','OY','WH','WX','WW'],
  Connacht:['GC','GY','LM','MO','RN','SO'],
  Munster:['CE','CC','CK','KY','LK','TY','WD'],
  Ulster:['CN','DL','MN'],
};
for(const feature of ireland.features){
  const memberships=Object.entries(provinceCounties).filter(([,codes])=>codes.includes(feature.properties.COUNTY_31));
  if(memberships.length!==1)throw Error(`Irish county mapping missing or duplicated: ${feature.properties.AREA_NAME}`);
  feature.properties.province=memberships[0][0];
}
const provinces=await command(ireland,'-dissolve province');
replace('IRL',provinces,{source:'Central Statistics Office, Ireland — county boundaries grouped into historical provinces; Ulster: Donegal, Cavan, Monaghan only',year:'2019',license:'CC BY 4.0',download:'https://cdn.cso.ie/static/map/en/ie_county_31_2019.json',url:'https://geojson.cso.ie/'},p=>p.province,p=>p.province.toUpperCase());
for(const feature of regions.features.filter(f=>f.properties.countryCode==='IRL')){
  feature.properties.sourceLevel='HISTORICAL';
  feature.properties.description='Историческая провинция';
}
Object.assign(sources.sources.find(item=>item.iso==='IRL'),{level:'historical',note:'Four historical provinces within the Republic of Ireland; Northern Ireland unchanged'});

let norway=await read('norway.geojson');
norway.features=norway.features.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type));
const norwayCoast=await read('NOR-ADM1-detail100.geojson');
norway=await command(norway,'-clip coast.geojson',{'coast.geojson':JSON.stringify(norwayCoast)});
replace('NOR',norway,{source:'Kartverket / Geonorge; coast from geoBoundaries',year:'2025',license:'CC BY 4.0',download:'https://testnedlasting.geonorge.no/geonorge/Basisdata/Fylker/GeoJSON/Basisdata_0000_Norge_4258_Fylker_GeoJSON.zip'},p=>p.administrativenhetnavn?.find(n=>n.sprak==='nor')?.navn??p.fylkesnavn,p=>p.fylkesnummer);

const maltaLocal=await read('malta-riu.geojson');
const malta=await command(maltaLocal,'-dissolve Region');
replace('MLT',malta,{source:'Research Innovation Unit, Malta — riu.gov.mt',year:'2023',license:'Free public use with source attribution',download:'https://services-eu1.arcgis.com/IR9ryIcXWG5koVHs/ArcGIS/rest/services/Malta_LAU2/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',url:'https://riu.gov.mt/malta-local-and-regional-lau2/'},p=>p.Region,p=>p.Region.match(/\(([^)]+)\)/)[1].toUpperCase());

const iceland=await read('iceland-lmi.geojson');
replace('ISL',iceland,{source:'National Land Survey of Iceland — IS 50V, 24 September 2026',year:'2026',license:'NLSI open data — attribution required',download:'https://gis.lmi.is/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=IS_50V:mork_sveitarf_svaedi&outputFormat=application/json&srsName=EPSG:4326'},p=>p.sveitarfelag,p=>p.nrsveitarfelags);

const nuts=await read('nuts3.geojson');
// Replace the unusually coarse source outlines with official GISCO geometry.
const giscoSource={source:'Eurostat GISCO NUTS 2024, 1:1 million',year:'2024',license:'Eurostat GISCO reuse conditions',download:'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2024_4326_LEVL_3.geojson'};
replace('ALB',collection(nuts.features.filter(f=>f.properties.CNTR_CODE==='AL')),giscoSource,p=>p.NAME_LATN,p=>p.NUTS_ID);
const belgium=collection(nuts.features.filter(f=>f.properties.CNTR_CODE==='BE'));
for(const f of belgium.features)f.properties.region=f.properties.NUTS_ID.slice(0,3);
replace('BEL',await command(belgium,'-dissolve region'),giscoSource,p=>({BE1:'Brussels-Capital Region',BE2:'Flemish Region',BE3:'Walloon Region'})[p.region],p=>p.region);
function orient(feature){
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  for(const coordinates of polygons)if(geoArea({type:'Polygon',coordinates})>2*Math.PI)coordinates.forEach(r=>r.reverse());
  return feature;
}
const budapest=nuts.features.find(f=>f.properties.NUTS_ID==='HU110');
if(!budapest)throw Error('GISCO Budapest missing');
if(!regions.features.some(f=>f.properties.countryCode==='HUN'&&f.properties.name==='Budapest'))regions.features.push({type:'Feature',id:'HUN-HU-BU',properties:{id:'HUN-HU-BU',name:'Budapest',country:'Венгрия',countryCode:'HUN',sourceLevel:'ADM1',sourceYear:'2024',sourceId:'HU110',isoCode:'HU-BU'},geometry:budapest.geometry});
// These NUTS units have a one-to-one match with the administrative units.
// Match before replacing geometry so existing region identifiers remain stable.
for(const [iso,code]of [['BGR','BG'],['HUN','HU'],['SRB','RS'],['DNK','DK']]){
  let units=collection(structuredClone(nuts.features.filter(f=>f.properties.CNTR_CODE===code)));
  if(iso==='DNK'){
    for(const f of units.features)f.properties.region=f.properties.NUTS_ID.slice(0,4);
    units=await command(units,'-dissolve region');
  }
  const original=regions.features.filter(f=>f.properties.countryCode===iso);
  if(units.features.length!==original.length)throw Error(`${iso}: GISCO unit count mismatch`);
  const oriented=original.map(f=>orient(structuredClone(f))),used=new Set();
  const danishNames={DK01:'Hovedstaden',DK02:'Sjælland',DK03:'Syddanmark',DK04:'Midtjylland',DK05:'Nordjylland'};
  for(const unit of units.features){
    const sourceId=unit.properties.NUTS_ID||unit.properties.region;
    const center=geoCentroid(orient(structuredClone(unit)));
    const hits=iso==='DNK'?oriented.filter(f=>f.properties.name===danishNames[sourceId]):['HU110','HU120'].includes(sourceId)?oriented.filter(f=>f.properties.name===unit.properties.NAME_LATN):oriented.filter(f=>geoContains(f,center));
    if(hits.length!==1||used.has(hits[0]?.properties.id))throw Error(`${iso}: ambiguous GISCO match ${sourceId}`);
    used.add(hits[0].properties.id);
    const target=original.find(f=>f.properties.id===hits[0].properties.id);
    target.geometry=unit.geometry;
    Object.assign(target.properties,{sourceId,sourceYear:'2024'});
  }
  Object.assign(sources.sources.find(s=>s.iso===iso),giscoSource,{units:original.length,level:'ADM1',note:iso==='DNK'?'NUTS 3 units dissolved to five NUTS 2 regions':'NUTS 3 units matched one-to-one with administrative regions'});
}
sources.additionalSources=[];

// Display these countries as one selectable area, removing internal boundaries.
const wholeCountries=['SVN','LVA','LTU','EST','MNE','MKD','LUX','XKX'];
for(const iso of wholeCountries){
  const source=sources.sources.find(item=>item.iso===iso);
  const merged=await command(collection(regions.features.filter(f=>f.properties.countryCode===iso)),'-dissolve countryCode');
  if(merged.features.length!==1)throw Error(`${iso}: country dissolve failed`);
  const id=`${iso}-WHOLE`;
  regions.features=regions.features.filter(f=>f.properties.countryCode!==iso);
  regions.features.push({type:'Feature',id,properties:{id,name:source.country,country:source.country,countryCode:iso,sourceLevel:'ADM0',sourceYear:source.year,sourceId:iso,isoCode:iso,displayMode:'whole-country'},geometry:merged.features[0].geometry});
  Object.assign(source,{units:1,originalLevel:source.level,level:'ADM0',displayMode:'whole-country',note:'Administrative polygons merged into one country outline'});
}

// Keep the source's Gagauzia and Transnistria outlines; merge all other units.
const moldova=regions.features.filter(f=>f.properties.countryCode==='MDA');
const specialMoldova=new Set(['MD-GA','MD-SN']);
if(moldova.filter(f=>specialMoldova.has(f.properties.isoCode)).length!==2)throw Error('Moldova special regions missing');
const restMoldova=await command(collection(moldova.filter(f=>!specialMoldova.has(f.properties.isoCode))),'-dissolve countryCode');
if(restMoldova.features.length!==1)throw Error('Moldova dissolve failed');
const moldovaSource=sources.sources.find(item=>item.iso==='MDA');
regions.features=regions.features.filter(f=>f.properties.countryCode!=='MDA');
for(const feature of moldova.filter(f=>specialMoldova.has(f.properties.isoCode))){
  feature.properties.name=feature.properties.isoCode==='MD-GA'?'Гагаузия':'Приднестровье';
  regions.features.push(feature);
}
regions.features.push({type:'Feature',id:'MDA-REST',properties:{id:'MDA-REST',name:'Молдова',country:'Молдова',countryCode:'MDA',sourceLevel:'GROUPED',sourceYear:moldovaSource.year,sourceId:'MDA-REST',isoCode:null,description:'Остальная территория страны'},geometry:restMoldova.features[0].geometry});
Object.assign(moldovaSource,{units:3,level:'grouped',note:'Gagauzia and Transnistria retain source administrative outlines; all other units, including Bender, merged'});

const britishAreas=await read('britain-ceremonial-100m.geojson');
const england=collection(britishAreas.features.filter(f=>ceremonialCountyNames.includes(f.properties.NAME)));
const welshNames=new Set(['Clwyd','Dyfed','Gwent','Gwynedd','Mid Glamorgan','Powys','South Glamorgan','West Glamorgan']);
for(const [code,features]of [['GB-WLS',britishAreas.features.filter(f=>welshNames.has(f.properties.NAME))],['GB-SCT',britishAreas.features.filter(f=>!welshNames.has(f.properties.NAME)&&!ceremonialCountyNames.includes(f.properties.NAME))]]){
  if(features.length!==(code==='GB-WLS'?8:35))throw Error(`OS area grouping failed: ${code}`);
  for(const f of features)f.properties.part=code;
  const merged=await command(collection(features),'-dissolve part');
  const region=regions.features.find(f=>f.properties.isoCode===code);
  region.geometry=merged.features[0].geometry;
  region.properties.sourceYear='версия OS Boundary-Line';region.properties.sourceId=`OS-${code}`;
}
if(!northernIreland)throw Error('CSO Northern Ireland outline missing');
const niRegion=regions.features.find(f=>f.properties.isoCode==='GB-NIR');
niRegion.geometry=northernIreland.geometry;niRegion.properties.sourceYear='2019';niRegion.properties.sourceId='CSO-NI';
regions.features=regions.features.filter(f=>!(f.properties.countryCode==='GBR'&&f.properties.isoCode==='GB-ENG'));
for(const feature of england.features){
  const name=feature.properties.NAME,id=`GBR-ENG-${name.toUpperCase().replace(/[^A-Z0-9]+/g,'-')}`;
  regions.features.push({type:'Feature',id,properties:{id,name,country:'Великобритания',countryCode:'GBR',parentCode:'GB-ENG',parentName:'Англия',sourceLevel:'CEREMONIAL',sourceYear:'версия OS Boundary-Line',sourceId:name,isoCode:null},geometry:feature.geometry});
}
const ukSource=sources.sources.find(item=>item.iso==='GBR');
Object.assign(ukSource,{units:51,level:'mixed',source:'Англия: 48 церемониальных графств; Шотландия и Уэльс: объединённые контуры Ordnance Survey Boundary-Line (дата версии не указана, получено 02.10.2026). Северная Ирландия: CSO, 2019',year:'2019 / OS',download:countiesDocumentation,license:'OS: Open Government Licence v3.0; © Crown copyright and database right 2026. CSO: CC BY 4.0'});
sources.additionalSources.push({country:'GBR',source:'Ordnance Survey Boundary-Line — ceremonial counties',url:countiesDocumentation,license:'Open Government Licence v3.0',retrieved:'2026-10-02'});
sources.display={wholeCountries,england:'48 ceremonial counties',ireland:'Leinster, Connacht, Munster, Ulster (Donegal, Cavan, Monaghan)',moldova:'Gagauzia, Transnistria, rest of Moldova'};

const expected={DEU:16,POL:16,UKR:27,ITA:20,GBR:51,NOR:15,IRL:4,HUN:20,BLR:7,BGR:28,DNK:5,SRB:25,BEL:3,ALB:12,MLT:6,MKD:1,SVN:1,LVA:1,LTU:1,EST:1,MNE:1,LUX:1,XKX:1,MDA:3,ISL:61};
for(const [iso,count]of Object.entries(expected)){const actual=regions.features.filter(f=>f.properties.countryCode===iso).length;if(actual!==count)throw Error(`${iso}: expected ${count}, got ${actual}`);}
const englishNames=new Set(regions.features.filter(f=>f.properties.parentCode==='GB-ENG').map(f=>f.properties.name));
if(englishNames.size!==48||ceremonialCountyNames.some(name=>!englishNames.has(name)))throw Error('English ceremonial county names are incomplete');
if(new Set(regions.features.map(f=>f.properties.id)).size!==regions.features.length)throw Error('Duplicate identifiers');
function checkCoordinates(coords){if(typeof coords[0]==='number'){if(!Number.isFinite(coords[0])||!Number.isFinite(coords[1])||Math.abs(coords[0])>180||Math.abs(coords[1])>90)throw Error(`Invalid WGS84 coordinate: ${coords}`);}else coords.forEach(checkCoordinates);}
regions.features.forEach(f=>checkCoordinates(f.geometry.coordinates));
regions.features.sort((a,b)=>a.properties.id.localeCompare(b.properties.id));
await fs.writeFile(path.join(cache,'regions-before-land-clip.geojson'),JSON.stringify(regions));
// Administrative polygons may include territorial waters. A flag map needs land.
const land=await read('land-gshhg-100m.geojson');
const clipped=await command(regions,'-clip land.geojson',{'land.geojson':JSON.stringify(land)});
// Monaco's precise small coastline should not be replaced by a coarser mask.
const monaco=regions.features.find(f=>f.properties.countryCode==='MCO');
clipped.features=clipped.features.filter(f=>f.properties.countryCode!=='MCO').concat(monaco);
const simplified=await command(clipped,'-simplify dp interval=100 keep-shapes');
if(simplified.features.length!==regions.features.length)throw Error('Simplification lost regions');
if(simplified.features.some(f=>!f.geometry))throw Error('Land clipping removed a region');
await fs.writeFile('public/data/regions.geojson',JSON.stringify(simplified));
const world=JSON.parse(await fs.readFile('public/data/world.geojson','utf8'));
await fs.writeFile('public/data/world.geojson',JSON.stringify(await command(world,'-simplify dp interval=100 keep-shapes')));
sources.coastline={source:'GSHHG 2.3.7 — full-resolution shoreline',url:'https://www.soest.hawaii.edu/pwessel/gshhg/',license:'LGPL v3',note:'Administrative water areas clipped to land; Douglas-Peucker distance threshold 100 m instead of a retained vertex percentage'};
sources.coastline.licenseText=(await Promise.all(['LICENSE.TXT','COPYING.LESSERv3','COPYINGv3'].map(file=>fs.readFile(`public/data/licenses/gshhg/${file}`,'utf8')))).join('\n\n');
sources.coastline.attribution='GSHHG: Paul Wessel, University of Hawaiʻi; Walter H. F. Smith, NOAA. Version 2.3.7. Land geometry extracted from full-resolution L1 shorelines and simplified for the browser.';
await fs.writeFile('public/data/sources.json',JSON.stringify(sources,null,2));
await fs.rm('public/data/regions.raw.geojson');
console.log(JSON.stringify({countries:sources.sources.length,regions:regions.features.length,bytes:(await fs.stat('public/data/regions.geojson')).size,checks:expected},null,2));

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {geoArea,geoContains} from 'd3';

const data=JSON.parse(await fs.readFile('public/data/regions.geojson','utf8'));
const sources=JSON.parse(await fs.readFile('public/data/sources.json','utf8'));
assert.equal(data.features.length,456);
assert.equal(new Set(data.features.map(f=>f.properties.id)).size,456);
assert.equal(sources.sources.length,46);
for(const source of sources.sources)assert.equal(data.features.filter(f=>f.properties.countryCode===source.iso).length,source.units,source.iso);
for(const f of data.features){
  assert.ok(f.geometry&&['Polygon','MultiPolygon'].includes(f.geometry.type),f.properties.id);
  const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  for(const coordinates of polygons){
    for(const ring of coordinates){
      assert.ok(ring.length>=4,f.properties.id);
      assert.deepEqual(ring[0],ring.at(-1),f.properties.id+' unclosed ring');
      for(const point of ring)assert.ok(Number.isFinite(point[0])&&Number.isFinite(point[1])&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90,f.properties.id+' WGS84');
    }
    if(geoArea({type:'Polygon',coordinates})>2*Math.PI)coordinates.forEach(r=>r.reverse());
  }
  const area=geoArea(f);
  assert.ok(area>0&&area<2*Math.PI,f.properties.id+' area/winding');
}
const hits=point=>data.features.filter(f=>geoContains(f,point));
const contains=(point,predicate,label)=>{
  const matched=hits(point);
  assert.equal(matched.length,1,label+' unique coverage');
  assert.ok(predicate(matched[0].properties),label+' correct region');
};
for(const [iso,points]of Object.entries({
  UKR:[[34.10,44.95],[34.157,44.501],[36.47,45.36],[30.72,46.48],[32.62,46.63],[31.99,46.97]],
  NOR:[[5.324,60.393],[13.608,68.214]],SWE:[[18.07,59.329]],FIN:[[24.94,60.17]],EST:[[22.49,58.25]],
  ITA:[[13.361,38.116],[9.12,39.22]],FRA:[[8.738,41.919]],GRC:[[25.132,35.338],[19.916,39.624]],MLT:[[14.512,35.899]],
  CYP:[[33.38,35.17]],PRT:[[-25.67,37.741],[-16.92,32.65]],ESP:[[-2.94,35.29],[-5.316,35.888],[-16.256,28.463]],
  MCO:[[7.425,43.738]],VAT:[[12.453,41.902]],SMR:[[12.446,43.934]],LIE:[[9.522,47.141]],AND:[[1.522,42.507]],
}))for(const point of points)contains(point,p=>p.countryCode===iso,iso+' '+point);
for(const point of [[33.522,44.60],[33.595,44.50],[33.538,44.777]])contains(point,p=>p.isoCode==='UA-40','Sevastopol '+point);
for(const point of [[34.10,44.95],[34.157,44.501],[36.47,45.36]])contains(point,p=>p.isoCode==='UA-43','Crimea '+point);
for(const point of [[33.0,44.7],[34.5,44.0],[3.2,60.4]])assert.equal(hits(point).length,0,'Sea must not be selectable '+point);
contains([19.04,47.5],p=>p.name==='Budapest','Budapest enclave');
for(const [iso,expected]of Object.entries({ROU:9,HUN:8,SRB:4,BGR:8,CZE:3,CYP:2,MLT:1,HRV:5,PRT:7}))assert.equal(data.features.filter(f=>f.properties.countryCode===iso).length,expected,iso+' new layout');
for(const [name,point]of [
  ['Bohemia',[14.421,50.088]],['Bohemia',[15.585,49.607]],['Moravia',[16.608,49.196]],['Moravia',[15.434,49.082]],
  ['Moravia',[15.590,49.396]],['Moravia',[16.468,49.758]],['Czech Silesia',[17.902,49.938]],['Czech Silesia',[17.205,50.229]],
  ['Moravia',[18.289,49.834]],['Czech Silesia',[18.31,49.837]],['Czech Silesia',[18.17,49.831]],
  ['Bucovina',[26.253,47.651]],['Bucovina',[25.558,47.533]],['Bucovina',[25.354,47.347]],['Moldova',[26.301,47.463]],
  ['Moldova',[27.589,47.163]],['Crișana',[21.316,46.175]],['Transilvania',[23.59,46.77]],['Banat',[21.23,45.75]],
  ['Sătmar și Maramureș',[23.57,47.65]],['Oltenia',[23.79,44.33]],['Muntenia',[26.10,44.43]],['Dobrogea',[28.63,44.18]],
  ['Vojvodina',[19.84,45.26]],['Belgrade',[20.46,44.82]],['Šumadija and Western Serbia',[20.34,43.14]],['Southern and Eastern Serbia',[21.90,43.32]],
  ['Black Sea Coast and Strandzha',[27.47,42.50]],['Shopluk',[23.32,42.70]],['Pirin Macedonia',[23.10,42.02]],
])contains(point,p=>p.name===name,name+' '+point);
for(const [id,point]of [
 ['CYP-SOUTH',[33.62,34.92]],['CYP-SOUTH',[33.04,34.68]],['CYP-SOUTH',[32.42,34.77]],['CYP-SOUTH',[34.00,35.01]],
 ['CYP-NORTH',[33.32,35.34]],['CYP-NORTH',[33.94,35.13]],['CYP-NORTH',[32.99,35.20]],['CYP-NORTH',[33.36,35.19]],
 ['CYP-NORTH',[32.621456,35.17586]],
 ['PRT-NORTE',[-8.61,41.15]],['PRT-CENTRO',[-8.646,40.641]],['PRT-CENTRO',[-7.92,40.656]],
 ['PRT-LISBOA',[-9.139,38.722]],['PRT-LISBOA',[-8.89,38.53]],['PRT-LISBOA',[-9.10,38.444]],['PRT-LISBOA',[-8.902,38.569]],
 ['PRT-ALENTEJO',[-8.506,38.373]],['PRT-ALENTEJO',[-8.567,38.177]],['PRT-ALENTEJO',[-8.868,37.957]],['PRT-ALENTEJO',[-8.686,39.236]],
 ['PRT-ALGARVE',[-7.935,37.02]],['PRT-ACORES',[-25.67,37.741]],['PRT-MADEIRA',[-16.92,32.65]],
 ['HRV-ISTRIA',[13.85,44.87]],['HRV-KVARNER',[14.443,45.327]],['HRV-KVARNER',[14.91,44.99]],
 ['HRV-DALMATIA',[16.444,43.51]],['HRV-DALMATIA',[15.233,44.119]],['HRV-SLAVONIA',[18.695,45.555]],['HRV-CONTINENTAL',[15.98,45.81]],
 ['MLT-WHOLE',[14.512,35.899]],['MLT-WHOLE',[14.24,36.044]],
])contains(point,p=>p.id===id,id+' '+point);
for(const point of [[-21.94,64.15],[-18.09,65.68],[-20.27,63.44]])contains(point,p=>p.id==='ISL-WHOLE','Iceland whole country');
assert.equal(data.features.filter(f=>f.properties.countryCode==='ISL').length,1);
contains([27.56,53.90],p=>p.isoCode==='BY-HM','Minsk city');
contains([6.13,49.61],p=>p.id==='LUX-WHOLE','Luxembourg');
contains([21.16,42.66],p=>p.id==='XKX-WHOLE','Kosovo');
contains([-.09,51.513],p=>p.name==='City of London','City of London enclave');
contains([-.127,51.499],p=>p.name==='Greater London','Westminster');
contains([-6.298,49.926],p=>p.name==='Cornwall','Isles of Scilly');
contains([-5.93,54.60],p=>p.isoCode==='GB-NIR','Belfast');
for(const point of [[-7.735,54.955],[-7.36,53.99],[-6.97,54.25]])contains(point,p=>p.countryCode==='IRL'&&p.name==='Ulster','Republic of Ireland Ulster');
contains([-9.04,53.27],p=>p.name==='Connacht','Galway coast');
for(const point of [[28.654,46.299],[28.83,46.06],[28.404,45.685]])contains(point,p=>p.name==='Гагаузия','Gagauzia enclave');
contains([29.637,46.843],p=>p.name==='Приднестровье','Tiraspol');
contains([28.836,47.025],p=>p.id==='MDA-REST','Chisinau');
const crimea=data.features.find(f=>f.properties.isoCode==='UA-43');
const sevastopol=data.features.find(f=>f.properties.isoCode==='UA-40');
const crimeaArea=geoArea(crimea)*6371.0088**2,sevastopolArea=geoArea(sevastopol)*6371.0088**2;
assert.ok(crimeaArea>24500&&crimeaArea<27000,'Crimea must be land area, without territorial waters');
assert.ok(sevastopolArea>750&&sevastopolArea<1000,'Sevastopol must not include a sea buffer');
console.log(JSON.stringify({regions:456,countries:46,checks:'WGS84, closed rings, winding, region counts, coast/island coverage, enclaves, historical-border control points, Cyprus north/south and Setúbal municipal split, no marine polygons',crimeaLandKm2:Math.round(crimeaArea),sevastopolLandKm2:Math.round(sevastopolArea)},null,2));

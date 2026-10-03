"use client";

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { geoAzimuthalEqualArea, select, zoom, zoomIdentity, type ZoomTransform } from "d3";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Compass, Info, LocateFixed, Minus, Plus, X, Maximize2 } from "lucide-react";

type Properties = { id:string; name:string; country:string; countryCode:string; sourceLevel:string; sourceYear:string; sourceId:string|null; isoCode:string|null; parentName?:string; description?:string };
type Bounds = [[number,number],[number,number]];
type Region = { properties:Properties; bounds:Bounds|null; point:[number,number]; area:number; paths:string[] };
const regionContext=(region:Region)=>region.properties.description?`${region.properties.country} · ${region.properties.description}`:region.properties.sourceLevel==='ADM0'?'Страна · единый регион':region.properties.parentName?`${region.properties.country} · ${region.properties.parentName}`:region.properties.country;
type Source = { iso:string; country:string; source:string; download:string; license:string; year:string; level:string; units:number };
type Coastline = { source:string; url:string; license:string; licenseText:string; attribution:string };
type RenderData = { regions:Region[]; world:{bounds:Bounds|null;paths:string[]}[]; graticule:string };
type MapData = RenderData & { sources:Source[]; coastline:Coastline };
type Population = { value:number; year:number; referenceDate?:string; source:string; definition:string; coverage?:'partial'|'approximate'; note?:string };
type PopulationSource = { name:string; url:string; originalUrl?:string; mirrorUrl?:string; supportingUrl?:string; supportingName?:string };
type PopulationData = { records:Record<string,Population>; sources:Record<string,PopulationSource> };
type Flag = { name:string; image:string; mapImage?:string; variant:string; displayVariant?:boolean; sourceUrl:string; sourceName:string; author:string; license:string; licenseUrl:string; referenceUrl?:string; components?:{sourceUrl:string;author:string;license:string;licenseUrl:string}[] };
type FlagData = { updated:string; description:string; records:Record<string,Flag>; colors?:Record<string,{name:string;color:string;note:string}> };
type FlagLayout = { key:string; flag:Flag; bounds:Bounds };
const flagKey=(region:Region)=>region.properties.isoCode&&/^[A-Z]{2}-[A-Z0-9]+$/.test(region.properties.isoCode)?region.properties.isoCode:region.properties.id;
const flagPatternId=(prefix:string,key:string)=>`${prefix}-flag-${key}`;
// Pattern placement stays in map coordinates, independent of zoom and LOD.
// The existing region path clips its own fill; no extra geographic paths.
const FlagPaintDefs=memo(function FlagPaintDefs({layouts,prefix}:{layouts:FlagLayout[];prefix:string}){
  return <defs>{layouts.map(({key,flag,bounds:[[x0,y0],[x1,y1]]})=><pattern key={key} id={flagPatternId(prefix,key)} patternUnits="userSpaceOnUse" x={x0} y={y0} width={x1-x0} height={y1-y0} viewBox={`0 0 ${x1-x0} ${y1-y0}`} preserveAspectRatio="none">
    <image href={flag.mapImage??flag.image} width={x1-x0} height={y1-y0} preserveAspectRatio="xMidYMid slice"/>
  </pattern>)}</defs>;
});
const populationFormat=new Intl.NumberFormat('ru-RU');
const dateFormat=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
function PopulationInfo({id,data,detail=false}:{id:string;data:PopulationData|null;detail?:boolean}){
  const p=data?.records[id],source=p&&data?.sources[p.source];
  if(!p)return <div className="population-info population-unavailable">Данные о населении недоступны</div>;
  return <div className={`population-info${detail?' population-detail':''}`} data-population-year={p.year} data-coverage={p.coverage??'complete'}>
    <span className="population-label">{p.coverage==='partial'?'Население · частичный охват':p.coverage==='approximate'?'Население · оценка':'Население'}</span>
    <div className="population-value">{populationFormat.format(p.value)} <small>чел.</small></div>
    <span className="population-date">{p.year} год{detail&&p.referenceDate?` · ${dateFormat.format(new Date(p.referenceDate+'T00:00:00Z'))}`:''}{p.year<2024?' · более ранние данные':''}</span>
    {p.coverage==='approximate'&&<span className="population-coverage">Статистические границы могут отличаться</span>}
    {detail?<>
      <p className="population-definition">{p.definition}</p>
      {p.note&&<p className="population-note">{p.note}</p>}
      {source&&(p.source==='eurostat'?<span className="population-source-name">Eurostat</span>:<a className="population-source" href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>)}
      {source?.originalUrl&&<a className="population-original" href={source.originalUrl} target="_blank" rel="noreferrer">Исходная таблица ↗</a>}
      {source?.mirrorUrl&&<a className="population-original" href={source.mirrorUrl} target="_blank" rel="noreferrer">Копия таблицы ↗</a>}
      {source?.supportingUrl&&<a className="population-original" href={source.supportingUrl} target="_blank" rel="noreferrer">{source.supportingName??'Дополнительные данные'} ↗</a>}
    </>:source&&<span className="population-source-caption">{source.name}</span>}
  </div>;
}
type MapApi = { focus:(region:Region)=>Promise<void>; scale:(factor:number)=>void; reset:()=>void };
const W=1200,H=920;
const labels:[string,number,number][]=[
  ["ИСЛАНДИЯ",-19,65],["НОРВЕГИЯ",10,63],["ШВЕЦИЯ",16,62],["ФИНЛЯНДИЯ",27,64],
  ["ВЕЛИКОБРИТАНИЯ",-3,54.5],["ИРЛАНДИЯ",-8,53],["ФРАНЦИЯ",2.6,46.5],
  ["ИСПАНИЯ",-3.7,40.3],["ПОРТУГАЛИЯ",-8,39.5],["ГЕРМАНИЯ",10.3,51.1],
  ["ПОЛЬША",19.4,52],["УКРАИНА",31,49],["БЕЛАРУСЬ",28,53.3],["ИТАЛИЯ",12.6,42.3],
  ["РУМЫНИЯ",25,45.7],["ГРЕЦИЯ",23,38.5],["РОССИЯ",45,59],
  ["ЧЕХИЯ",15,49.8],["АВСТРИЯ",14,47.5],["ВЕНГРИЯ",19.3,47],["БОЛГАРИЯ",25.3,42.8],["ДАНИЯ",9.5,56.3]
];

export default function Atlas(){
  const [data,setData]=useState<MapData|null>(null);
  const [population,setPopulation]=useState<PopulationData|null>(null);
  const [flags,setFlags]=useState<FlagData|null>(null);
  const [failed,setFailed]=useState(false);
  const [selected,setSelected]=useState<Region|null>(null);
  const [hover,setHover]=useState<{region:Region;x:number;y:number}|null>(null);
  const [transform,setTransform]=useState<ZoomTransform>(zoomIdentity);
  const [viewport,setViewport]=useState<Bounds>([[0,0],[W,H]]);
  const [sourcesOpen,setSourcesOpen]=useState(false);
  const svgRef=useRef<SVGSVGElement>(null);
  const api=useRef<MapApi|null>(null);
  const previousSelected=useRef<string|null>(null);
  const tooltipRef=useRef<HTMLDivElement>(null);
  const flagPrefix='atlas'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const flagLayouts=useMemo(()=>data&&flags?data.regions.flatMap(region=>{
    const key=flagKey(region),flag=flags.records[key];
    return flag&&region.bounds?[{key,flag,bounds:region.bounds}]:[];
  }):[],[data,flags]);
  const selectedFlag=selected&&flags?.records[flagKey(selected)];
  const selectedColor=selected&&flags?.colors?.[flagKey(selected)];
  const miniFlags=useMemo(()=>selected?flagLayouts.filter(f=>f.key===flagKey(selected)):[],[selected,flagLayouts]);
  const projection=useMemo(()=>geoAzimuthalEqualArea().rotate([-18,-54]).clipAngle(85).translate([W/2,H/2]).scale(1010).precision(.15),[]);
  const reset=useCallback(()=>{api.current?.reset();setSelected(null);setHover(null);},[]);

  useEffect(()=>{
    const lifecycle=new AbortController();
    const get=async<T,>(url:string):Promise<T>=>{const r=await fetch(url,{signal:lifecycle.signal});if(!r.ok)throw Error(`Asset ${r.status}`);return r.json() as Promise<T>;};
    Promise.all([get<RenderData>('/data/map-render.json'),get<{sources:Source[];coastline:Coastline}>('/data/sources.json')])
      .then(([render,sources])=>{if(!render.regions?.length)throw Error('No regions');setData({...render,sources:sources.sources,coastline:sources.coastline});})
      .catch(e=>{if(e.name!=='AbortError')setFailed(true);});
    get<PopulationData>('/data/population.json').then(setPopulation).catch(()=>{});
    get<FlagData>('/data/flags.json').then(setFlags).catch(()=>{});
    return()=>lifecycle.abort();
  },[]);

  // Clamp again after a new region's tooltip has its actual dimensions.
  useLayoutEffect(()=>{
    if(!hover||!tooltipRef.current)return;
    const box=tooltipRef.current.getBoundingClientRect();
    const x=Math.max(8,Math.min(hover.x,innerWidth-box.width-12)),y=Math.max(8,Math.min(hover.y,innerHeight-box.height-12));
    if(x!==hover.x||y!==hover.y)setHover(current=>current?{...current,x,y}:null);
  },[hover?.region.properties.id,population]);

  useEffect(()=>{
    const svg=svgRef.current;if(!svg)return;
    const update=()=>{
      const matrix=svg.getScreenCTM();if(!matrix)return;
      const box=svg.getBoundingClientRect(),inverse=matrix.inverse();
      const top=new DOMPoint(box.left,box.top).matrixTransform(inverse),bottom=new DOMPoint(box.right,box.bottom).matrixTransform(inverse);
      setViewport([[top.x,top.y],[bottom.x,bottom.y]]);
    };
    const observer=new ResizeObserver(update);observer.observe(svg);update();
    return()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    if(!data||!svgRef.current)return;
    const svg=select(svgRef.current);
    const behavior=zoom<SVGSVGElement,unknown>().extent([[0,0],[W,H]]).scaleExtent([.55,48]).clickDistance(5)
      .translateExtent([[-W*2,-H*2],[W*3,H*3]]).on('start',()=>setHover(null)).on('zoom',e=>setTransform(e.transform));
    svg.call(behavior);
    const duration=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:380;
    api.current={
      scale:factor=>{svg.transition().duration(duration()).call(behavior.scaleBy,factor);},
      reset:()=>{svg.transition().duration(duration()).call(behavior.transform,zoomIdentity);},
      focus:async region=>{
        if(!region.bounds)return;
        const [[x0,y0],[x1,y1]]=region.bounds;
        if(![x0,y0,x1,y1].every(Number.isFinite))return;
        const k=Math.max(1,Math.min(40,.58/Math.max((x1-x0)/W,(y1-y0)/H)));
        await svg.transition().duration(duration()).call(behavior.transform,zoomIdentity.translate(W*.44-k*(x0+x1)/2,H/2-k*(y0+y1)/2).scale(k)).end().catch(()=>{});
      }
    };
    return()=>{svg.interrupt().on('.zoom',null);api.current=null;};
  },[data]);

  useEffect(()=>{
    if(!svgRef.current)return;
    const paths=select(svgRef.current).selectAll<SVGPathElement,unknown>('.region');
    if(previousSelected.current)paths.filter(function(){return this.dataset.regionId===previousSelected.current;}).classed('selected',false);
    if(selected)paths.filter(function(){return this.dataset.regionId===selected.properties.id;}).classed('selected',true).raise();
    previousSelected.current=selected?.properties.id??null;
  },[selected,data]);

  useEffect(()=>{
    if(!data)return;
    type Tool={name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean};execute:(input:unknown)=>Promise<unknown>};
    const context=(document as Document&{modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    const tools:Tool[]=[{
      name:'select_region',title:'Выбрать регион',description:'Выбрать административный регион по идентификатору и приблизить карту.',
      inputSchema:{type:'object',properties:{regionId:{type:'string'}},required:['regionId'],additionalProperties:false},annotations:{readOnlyHint:false},
      execute:async input=>{
        if(!input||typeof input!=='object'||Object.keys(input).length!==1||!('regionId'in input)||typeof input.regionId!=='string')throw Error('Expected regionId string');
        const region=data.regions.find(f=>f.properties.id===input.regionId);
        if(!region)throw Error('Region not found');
        setSelected(region);setHover(null);await api.current?.focus(region);
        return {id:region.properties.id,name:region.properties.name,country:region.properties.country};
      }
    },{
      name:'reset_map',title:'Показать Европу',description:'Вернуть общий вид Европы и снять выбор региона.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},
      execute:async input=>{
        if(!input||typeof input!=='object'||Object.keys(input).length!==0)throw Error('Expected empty object');
        reset();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {selectedRegion:null,view:'Europe'};
      }
    }];
    for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
    return()=>lifecycle.abort();
  },[data,reset]);

  // Higher detail is only useful when it occupies visible screen pixels.
  const level=transform.k<2.4?0:transform.k<7?1:transform.k<20?2:3;
  function visible(bounds:Bounds|null){
    if(!bounds)return false;
    const [[x0,y0],[x1,y1]]=bounds,k=transform.k,x=transform.x,y=transform.y,pad=32;
    return x1*k+x>=viewport[0][0]-pad&&x0*k+x<=viewport[1][0]+pad&&y1*k+y>=viewport[0][1]-pad&&y0*k+y<=viewport[1][1]+pad;
  }
  const mini=useMemo(()=>{
    if(!selected?.bounds)return null;
    const [[x0,y0],[x1,y1]]=selected.bounds;
    const s=Math.min(236/Math.max(x1-x0,.0001),146/Math.max(y1-y0,.0001));
    return {d:selected.paths[3],transform:`translate(${130-s*(x0+x1)/2},${85-s*(y0+y1)/2}) scale(${s})`};
  },[selected]);
  function tooltip(e:React.PointerEvent<SVGPathElement>,region:Region){
    if(e.pointerType==='touch'||e.buttons)return;
    const width=tooltipRef.current?.offsetWidth??300,height=tooltipRef.current?.offsetHeight??180;
    setHover({region,x:Math.max(8,Math.min(e.clientX+16,innerWidth-width-12)),y:Math.max(8,Math.min(e.clientY+16,innerHeight-height-12))});
  }

  return <main className="atlas-shell">
    <header className="atlas-header">
      <div className="brand"><span className="brand-icon"><Compass size={23}/></span><div><span className="brand-name">АТЛАС</span><span className="brand-caption">Регионы Европы</span></div></div>
      <div className="header-scope"><span>Европа</span><i/><span>Страны и регионы</span></div>
      <Button variant="ghost" className="sources-button" onClick={()=>setSourcesOpen(true)}><Info size={17}/>О карте</Button>
    </header>
    <section className="map-stage" aria-label="Интерактивная карта регионов Европы">
      <div className="map-heading"><p className="eyebrow">СТРАНЫ И РЕГИОНЫ</p><h1>Европа по регионам</h1><p className="map-prompt">Наведите на регион, чтобы увидеть население</p></div>
      {!data&&<div className="map-message" role="status">{failed?<><p>Не удалось загрузить карту</p><Button variant="outline" onClick={()=>location.reload()}>Повторить</Button></>:<><span className="loading-spinner"/><p>Загружаем границы…</p></>}</div>}
      <svg ref={svgRef} className="europe-map" viewBox={`0 0 ${W} ${H}`} tabIndex={0} aria-label="Карта: перетаскивание для перемещения; плюс и минус для масштаба"
        onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='+'||e.key==='='){e.preventDefault();api.current?.scale(1.6);}if(e.key==='-'){e.preventDefault();api.current?.scale(1/1.6);}if(e.key==='0'||e.key==='Home'){e.preventDefault();reset();}}}
        onClick={e=>{if(e.target===e.currentTarget){setSelected(null);setHover(null);}}}>
        <FlagPaintDefs layouts={flagLayouts} prefix={flagPrefix}/>
        <g className="map-layer" transform={transform.toString()}>
          <path className="graticule" d={data?.graticule??''}/>
          <g className="world-land" aria-hidden="true">{data?.world.map((shape,i)=><path key={i} d={visible(shape.bounds)?shape.paths[level]:''}/>)}</g>
          <g className="regions">{data?.regions.map(region=><path key={region.properties.id} className={`region${flags?.records[flagKey(region)]?' has-flag':flags?.colors?.[flagKey(region)]?' has-color':''}`} data-region-id={region.properties.id} data-country={region.properties.countryCode} data-flag-key={flags?.records[flagKey(region)]?flagKey(region):undefined} style={flags?.records[flagKey(region)]?{fill:`url(#${flagPatternId(flagPrefix,flagKey(region))})`}:flags?.colors?.[flagKey(region)]?{fill:flags.colors[flagKey(region)].color}:undefined} d={visible(region.bounds)?region.paths[level]:''} role="button" tabIndex={visible(region.bounds)?0:-1} aria-label={`${region.properties.name}, ${region.properties.country}`} aria-pressed={selected?.properties.id===region.properties.id}
            onPointerEnter={e=>tooltip(e,region)} onPointerMove={e=>tooltip(e,region)} onPointerLeave={()=>setHover(null)}
            onClick={e=>{e.stopPropagation();setHover(null);setSelected(region);}}
            onFocus={e=>{if(e.currentTarget.matches(':focus-visible')){setSelected(region);api.current?.focus(region);}}}
            onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(region);api.current?.focus(region);}if(e.key==='Escape'){setSelected(null);svgRef.current?.focus();}}}>
              <title>{region.properties.name} · {region.properties.country}</title>
            </path>)}</g>
          <g className="country-labels" aria-hidden="true" style={{opacity:transform.k>3.8?0:1}}>{labels.map(([name,lon,lat])=>{const p=projection([lon,lat]);return p?<text key={name} x={p[0]} y={p[1]} fontSize={10/Math.sqrt(transform.k)}>{name}</text>:null;})}</g>
          {transform.k>=4&&<g className="region-labels" aria-hidden="true">{data?.regions.filter(region=>visible(region.bounds)&&region.area*transform.k*transform.k>7000).map(region=><text key={region.properties.id} x={region.point[0]} y={region.point[1]} fontSize={12/transform.k}>{region.properties.name}</text>)}</g>}
          <g className="sea-labels" aria-hidden="true" style={{opacity:transform.k>2?0:1}}>{([['АТЛАНТИЧЕСКИЙ ОКЕАН',-19,45],['СРЕДИЗЕМНОЕ МОРЕ',15,35.8],['ЧЁРНОЕ МОРЕ',34,43.2]] as [string,number,number][]).map(([name,lon,lat])=>{const p=projection([lon,lat]);return p?<text key={name} x={p[0]} y={p[1]}>{name}</text>:null;})}</g>
        </g>
      </svg>
      <div className="map-controls" aria-label="Масштаб карты"><Button variant="ghost" size="icon" aria-label="Увеличить карту" onClick={()=>api.current?.scale(1.6)} disabled={!data}><Plus/></Button><i/><Button variant="ghost" size="icon" aria-label="Уменьшить карту" onClick={()=>api.current?.scale(1/1.6)} disabled={!data}><Minus/></Button><i/><Button variant="ghost" size="icon" aria-label="Показать всю Европу" onClick={reset} disabled={!data}><LocateFixed/></Button></div>
      <div className="map-bottom"><span className="map-instruction">Прокрутка — масштаб<span> · </span>Перетаскивание — перемещение</span><span className="map-count">{data?`${data.sources.length} стран · ${data.regions.length.toLocaleString('ru-RU')} регионов`:''}</span></div>
    </section>
    <footer className="atlas-footer"><span>Границы регионов</span><div><span>geoBoundaries · национальные источники</span><i/><button onClick={()=>setSourcesOpen(true)}>Источники</button></div></footer>
    {hover&&<div ref={tooltipRef} className="region-tooltip" role="tooltip" style={{left:hover.x,top:hover.y}}><strong>{hover.region.properties.name}</strong><span>{regionContext(hover.region)}</span><PopulationInfo id={hover.region.properties.id} data={population}/></div>}
    <Sheet modal={false} open={!!selected} onOpenChange={open=>{if(!open)setSelected(null);}}><SheetContent className="region-sheet" showCloseButton={false} onOpenAutoFocus={e=>e.preventDefault()} onCloseAutoFocus={e=>e.preventDefault()} onInteractOutside={e=>e.preventDefault()}>
      <SheetHeader className="region-sheet-header"><p className="eyebrow">{selected?.properties.sourceLevel==='ADM0'?'ВЫБРАННАЯ СТРАНА':'ВЫБРАННЫЙ РЕГИОН'}</p><SheetTitle>{selected?.properties.name}</SheetTitle><SheetDescription>{selected?regionContext(selected):''}</SheetDescription></SheetHeader>
      <SheetClose asChild><Button variant="ghost" size="icon" className="close-region" aria-label="Снять выбор региона"><X/></Button></SheetClose>
      {mini&&<svg className="region-silhouette" viewBox="0 0 260 170" aria-hidden="true"><FlagPaintDefs layouts={miniFlags} prefix={flagPrefix+'-mini'}/><path d={mini.d} transform={mini.transform} style={selectedFlag&&selected?{fill:`url(#${flagPatternId(flagPrefix+'-mini',flagKey(selected))})`}:selectedColor?{fill:selectedColor.color}:undefined}/></svg>}
      {selectedFlag&&<div className="region-flag"><img src={selectedFlag.image} alt={`Флаг ${selectedFlag.name}`}/><span>{selectedFlag.displayVariant||selectedFlag.variant.includes('временная')||selectedFlag.variant.startsWith('Ulster Banner')||selectedFlag.variant.includes('создан для карты')?selectedFlag.variant:'Флаг региона'}</span></div>}
      {selected&&<PopulationInfo id={selected.properties.id} data={population} detail/>}
      <Button className="focus-region" onClick={()=>selected&&api.current?.focus(selected)}><Maximize2 size={16}/>Приблизить регион</Button>
    </SheetContent></Sheet>
    <Sheet open={sourcesOpen} onOpenChange={setSourcesOpen}><SheetContent className="sources-sheet" showCloseButton={false}>
      <SheetHeader><p className="eyebrow">О КАРТЕ</p><SheetTitle>Границы и источники</SheetTitle><SheetDescription>Страны и регионы Европы</SheetDescription></SheetHeader>
      <SheetClose asChild><Button variant="ghost" size="icon" className="close-sources" aria-label="Закрыть информацию о карте"><X/></Button></SheetClose>
      <div className="sources-body">
        <p>Наведите на регион, чтобы увидеть население и год данных. По клику открывается карточка с датой, источником и пояснениями. На телефоне нажмите на регион. Используйте колесо мыши или кнопки масштаба; на телефоне — жест двумя пальцами.</p>
        <div className="population-sources"><h2>Население</h2><p>Приоритет — данные за 2025 и 2024 годы. Если сопоставимой серии нет, показаны более ранние данные с явной подписью года. Значения относятся к указанной дате; разные страны используют разные определения населения.</p><p>Для составных регионов сложены опубликованные данные входящих территорий. Частичный охват и расхождения статистических границ отмечены в карточке региона. Данные сохранены в карте и доступны без интернета.</p>{population&&<ul>{Object.entries(population.sources).map(([id,s])=><li key={id}>{id==='eurostat'?<span>{s.name}</span>:<a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>}</li>)}</ul>}</div>
        {flags&&<div className="flag-sources"><h2>Флаги регионов</h2><p>{flags.description} Изображения сохранены в карте и доступны без интернета.</p><ul>{Object.entries(flags.records).map(([key,f])=><li key={key}><img src={f.image} alt=""/><div>{f.sourceUrl?<a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.name}</a>:<span>{f.name}</span>}<span>{f.sourceName} · {f.licenseUrl?<a href={f.licenseUrl} target="_blank" rel="noreferrer">{f.license}</a>:<span>{f.license}</span>}</span>{f.author&&<span>{f.author}</span>}{f.components?.filter(c=>c.sourceUrl!==f.sourceUrl).map(c=><span key={c.sourceUrl}><a href={c.sourceUrl} target="_blank" rel="noreferrer">Дополнительный герб</a> · {c.author} · <a href={c.licenseUrl} target="_blank" rel="noreferrer">{c.license}</a></span>)}</div></li>)}</ul></div>}
        <p>На карте представлены страны Европы. Для каждой страны выбран административный уровень, соответствующий её устройству. Ватикан показан целиком; соседние территории показаны серым фоном.</p>
        <p>Словения, Латвия, Литва, Эстония, Черногория, Северная Македония, Люксембург, Косово, Мальта, Исландия, Албания, Андорра, Лихтенштейн, Сан-Марино, Ватикан и Монако показаны цельными странами без внутренних границ. Англия разделена на 48 церемониальных графств; Шотландия, Уэльс и Северная Ирландия показаны целиком.</p>
        <p>Республика Ирландия разделена на Leinster, Connacht, Munster и Ulster. В Ulster входят только Donegal, Cavan и Monaghan; Северная Ирландия остаётся отдельным регионом Великобритании.</p>
        <p>Молдова показана тремя регионами: Гагаузия, Приднестровье и остальная территория страны. Контуры Гагаузии и Приднестровья сохранены из исходного набора границ.</p>
        <p>Регионы закрашены по суше; морская акватория в их контуры не входит. Границы взяты из открытых источников разных лет. На стыках национальных наборов возможны небольшие расхождения. Даты и источники указаны ниже.</p>
        <div className="source-list">{data?.sources.map(s=><article key={s.iso}><div><strong>{s.country}</strong><span>{s.year}</span></div><p>{s.source}</p><a href={s.download} target="_blank" rel="noreferrer">Границы · {s.units} регионов</a><p className="license">{s.license}</p></article>)}</div>
        {data?.coastline&&<p className="context-source">Береговая линия: <a href={data.coastline.url} target="_blank" rel="noreferrer">{data.coastline.source}</a>. {data.coastline.attribution} <a href={'data:text/plain;charset=utf-8,'+encodeURIComponent(data.coastline.licenseText)} download="GSHHG-LICENSES.txt">Лицензия {data.coastline.license}</a>.</p>}
        <p className="context-source">Контуры соседних стран: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>, public domain.</p>
      </div>
    </SheetContent></Sheet>
  </main>;
}

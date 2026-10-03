import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {prepareRendering} from './prepare-rendering.mjs';
import {checkPopulation} from './check-population.mjs';
import {prepareFlags} from './prepare-flags.mjs';

// Use the same React/D3 component and production styles in a self-contained file.
await checkPopulation();
await prepareRendering();
await prepareFlags();
const result=spawnSync(process.execPath,['scripts/run-framework.mjs','build'],{stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
const cssDirectory=path.resolve('dist/client/_next/static/css');
const cssFiles=(await fs.readdir(cssDirectory)).filter(name=>name.endsWith('.css'));
const css=(await Promise.all(cssFiles.map(name=>fs.readFile(path.join(cssDirectory,name),'utf8')))).join('\n');
const entry=path.resolve('.sites-runtime/offline-entry.tsx');
await fs.mkdir(path.dirname(entry),{recursive:true});
await fs.writeFile(entry,`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import Atlas from '../app/atlas';
    import render from '../public/data/map-render.json';
    import sources from '../public/data/sources.json';
    import population from '../public/data/population.json';
    import flags from '../public/data/flags.json';
    const assets={'/data/map-render.json':render,'/data/sources.json':sources,'/data/population.json':population,'/data/flags.json':flags};
    const originalFetch=globalThis.fetch.bind(globalThis);
    globalThis.fetch=async(input,options)=>{
      const url=typeof input==='string'?input:input.url;
      if(Object.prototype.hasOwnProperty.call(assets,url)){
        if(options?.signal?.aborted)throw new DOMException('Aborted','AbortError');
        return new Response(JSON.stringify(assets[url]),{headers:{'Content-Type':'application/json'}});
      }
      return originalFetch(input,options);
    };
    createRoot(document.getElementById('root')).render(<Atlas/>);
  `);
const bundle=await build({
  configFile:false,publicDir:false,logLevel:'warn',
  plugins:[react(),{name:'atlas-geojson',transform(code,id){if(id.endsWith('.geojson'))return `export default ${code};`;}}],
  resolve:{alias:{'@':process.cwd()}},define:{'process.env.NODE_ENV':'"production"'},
  build:{write:false,minify:true,target:'es2020',lib:{entry,name:'EuropeAtlas',formats:['iife']}},
});
await fs.rm(entry);
const outputs=Array.isArray(bundle)?bundle.flatMap(item=>item.output):bundle.output;
const javascript=outputs.find(item=>item.type==='chunk');
if(!javascript)throw Error('Standalone JavaScript bundle missing');
const icon=await fs.readFile('public/favicon.svg','utf8');
const html=`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Атлас регионов Европы</title><link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}"><style>${css.replaceAll('</style','<\\/style')}</style></head><body><div id="root"></div><script>${javascript.code.replaceAll('</script','<\\/script')}</script></body></html>`;
const destination=path.resolve(process.argv[2]||'atlas-europe.html');
await fs.writeFile(destination,html);
console.log(`Standalone atlas saved: ${destination} (${Buffer.byteLength(html)} bytes)`);

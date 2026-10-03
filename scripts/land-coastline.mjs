import fs from 'node:fs/promises';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import ms from 'mapshaper';

const url='https://github.com/GenericMappingTools/gshhg-gmt/releases/download/2.3.7/gshhg-shp-2.3.7.zip';
const sha256='8dbbe7e071e77e9e75f2d639239099ebca8d5c16d6a07df8169729d49f15cf41';
export async function prepareLandCoastline(cache){
  const archive=path.join(cache,'gshhg-shp-2.3.7.zip');
  try{await fs.access(archive);}catch{
    const response=await fetch(url,{signal:AbortSignal.timeout(300000)});
    if(!response.ok)throw Error(`GSHHG download HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('GSHHG checksum mismatch');
    await fs.writeFile(archive,bytes);
  }
  const zip=await fs.readFile(archive);
  if(createHash('sha256').update(zip).digest('hex')!==sha256)throw Error('GSHHG cache checksum mismatch');
  let end=zip.length-22;while(end>=0&&zip.readUInt32LE(end)!==0x06054b50)end--;
  if(end<0)throw Error('Invalid GSHHG ZIP');
  let cursor=zip.readUInt32LE(end+16);const members={};
  const licenses=path.resolve('public/data/licenses/gshhg');
  await fs.mkdir(licenses,{recursive:true});
  while(cursor<end&&zip.readUInt32LE(cursor)===0x02014b50){
    const n=zip.readUInt16LE(cursor+28),x=zip.readUInt16LE(cursor+30),c=zip.readUInt16LE(cursor+32);
    const name=zip.subarray(cursor+46,cursor+46+n).toString();
    const isShape=/GSHHS_f_L1\.(shp|shx|dbf|prj)$/.test(name);
    const isLicense=['LICENSE.TXT','COPYING.LESSERv3','COPYINGv3','README.TXT'].includes(name);
    if(isShape||isLicense){
      const offset=zip.readUInt32LE(cursor+42),method=zip.readUInt16LE(cursor+10),size=zip.readUInt32LE(cursor+20);
      if(method!==0&&method!==8)throw Error('Unsupported GSHHG ZIP compression');
      const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
      const compressed=zip.subarray(start,start+size),data=method===8?inflateRawSync(compressed):compressed;
      if(isShape)members[path.posix.basename(name)]=data;
      else await fs.writeFile(path.join(licenses,name),data);
    }
    cursor+=46+n+x+c;
  }
  // The upstream ZIP carries LGPL but refers to GPLv3 without bundling it.
  const gplFile=path.join(licenses,'COPYINGv3');
  try{await fs.access(gplFile);}catch{
    const response=await fetch('https://raw.githubusercontent.com/gcc-mirror/gcc/master/COPYING3',{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`GPLv3 license HTTP ${response.status}`);
    const text=await response.text();
    if(!text.includes('GNU GENERAL PUBLIC LICENSE'))throw Error('Invalid GPLv3 license text');
    await fs.writeFile(gplFile,text);
  }
  const target=path.join(cache,'land-gshhg-100m.geojson');
  try{await fs.access(target);return;}catch{}
  const result=await ms.applyCommands('-i GSHHS_f_L1.shp -simplify dp interval=100 keep-shapes -filter-fields -o land.geojson format=geojson precision=0.000001',members);
  await fs.writeFile(target,result['land.geojson']);
  console.log('Full-resolution GSHHG coastline prepared.');
}

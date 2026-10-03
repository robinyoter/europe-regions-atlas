import {spawnSync} from 'node:child_process';
for(const script of ['prepare-boundaries','download-supplemental','finalize-boundaries','custom-regions','prepare-rendering']){
  const result=spawnSync(process.execPath,[`scripts/${script}.mjs`],{stdio:'inherit',env:process.env});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}

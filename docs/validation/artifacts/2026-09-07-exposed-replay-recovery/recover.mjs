import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const oldPath='/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r2/docs/validation/artifacts/2026-09-05-r2-local-replay-sources/sequelize-8430-complete-v1-manifest.json';
const oldBytes=fs.readFileSync(oldPath), old=JSON.parse(oldBytes), h=old.history;
const source=path.join(root,'source.git'), bundle=path.join(root,'sequelize-8430-recovered-v2.bundle'), restore=path.join(root,'offline-restore.git');
const start=Date.now(), cap=250*1024*1024;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1',LC_ALL:'C',LANG:'C',TZ:'UTC'};
const usage=()=>Number(execFileSync('/usr/bin/du',['-sk',root],{encoding:'utf8'}).split(/\s/)[0])*1024;
const log=[];
async function git(args,online=false){
  if(usage()>=cap||Date.now()-start>=20*60*1000)throw Error('Budget exhausted');
  const full=['-c','credential.helper=','-c','core.hooksPath=/dev/null','-c',online?'protocol.https.allow=always':'protocol.allow=never',...args];
  const t=Date.now();
  return await new Promise((resolve,reject)=>{
    const p=spawn('git',full,{env,cwd:root,stdio:['ignore','pipe','pipe']});let stdout=[],stderr=[],stopped=false;
    p.stdout.on('data',b=>stdout.push(b));p.stderr.on('data',b=>stderr.push(b));
    const timer=setInterval(()=>{if(usage()>=cap||Date.now()-start>=20*60*1000){stopped=true;p.kill('SIGTERM');}},200);
    p.on('error',e=>{clearInterval(timer);reject(e);});
    p.on('close',code=>{clearInterval(timer);const out=Buffer.concat(stdout),err=Buffer.concat(stderr).toString();log.push({args:full,online,exitCode:code,seconds:(Date.now()-t)/1000,stderr:err});fs.writeFileSync(path.join(root,'operations.json'),JSON.stringify(log,null,2)+'\n');if(stopped||code!==0)reject(Error('Git failed or capped: '+JSON.stringify(args)+' '+err));else resolve(out);});
  });
}
const text=async(a)=>String(await git(a)).trim();
try{
  if(fs.existsSync(source)||fs.existsSync(bundle)||fs.existsSync(restore))throw Error('Refusing to overwrite existing recovery');
  await git(['init','--bare',source]);
  await git(['--git-dir='+source,'fetch','--no-tags','--no-write-fetch-head','https://github.com/sequelize/sequelize.git',...['reviewBase','reviewHead','finalBase','finalHead'].map(role=>h[role]+':refs/evidence/'+role)],true);
  const sourceBytes=usage();
  if(sourceBytes*3>=cap)throw Error('Conservative source+bundle+restore budget would exceed cap');
  await git(['--git-dir='+source,'fsck','--full','--no-dangling']);
  await git(['--git-dir='+source,'bundle','create',bundle,'--all']);
  if(usage()+sourceBytes>=cap)throw Error('Projected fresh restore would exceed cap');
  await git(['init','--bare',restore]);
  // The only permitted transport during restore is this exact local bundle file.
  await git(['-c','protocol.file.allow=always','--git-dir='+restore,'fetch','--no-tags','--no-write-fetch-head',bundle,'refs/evidence/*:refs/evidence/*']);
  const checks={};
  for(const dir of [source,restore]){
    const g=['--git-dir='+dir];
    await git([...g,'fsck','--full','--no-dangling']);
    if(await text([...g,'rev-parse','--is-shallow-repository'])!=='false')throw Error('Shallow source');
    if(await text([...g,'rev-parse','--show-object-format'])!=='sha1')throw Error('Object format');
    for(const p of ['objects/info/alternates','info/grafts','shallow'])if(fs.existsSync(path.join(dir,p)))throw Error('Forbidden Git metadata '+p);
    if(fs.readdirSync(path.join(dir,'objects/pack')).some(p=>p.endsWith('.promisor')))throw Error('Promisor pack');
    const config=await text([...g,'config','--list']);if(/promisor|partialclone|alternate/i.test(config))throw Error('Promisor config');
    if(await text([...g,'for-each-ref','refs/replace']))throw Error('Replacement refs');
    for(const role of ['reviewBase','reviewHead','finalBase','finalHead'])if(await text([...g,'rev-parse',h[role]+'^{tree}'])!==h[role+'Tree'])throw Error('Tree mismatch '+role);
    if(await text([...g,'merge-base',h.reviewBase,h.reviewHead])!==h.reviewBase)throw Error('Merge base');
    const roots=(await text([...g,'rev-list','--max-parents=0',h.reviewHead])).split('\n').sort();
    if(JSON.stringify(roots)!==JSON.stringify(h.rootCommitOids))throw Error('Root mismatch');
    if(Number(await text([...g,'rev-list','--count',h.reviewHead]))!==7749)throw Error('Ancestry count');
    const family=sha(Buffer.from(JSON.stringify({version:'git-root-family-v1',objectFormat:'sha1',rootCommitOids:roots})));
    if(family!==h.repositoryFamilyIdentitySha256)throw Error('Family identity');
    for(const [key,base,head] of [['review',h.reviewBase,h.reviewHead],['final',h.finalBase,h.finalHead],['commentHeadToFinal',h.reviewHead,h.finalHead]]){
      const b=await git([...g,'-c','core.quotePath=true','-c','color.ui=false','-c','diff.renames=false','diff','--binary','--full-index','--no-ext-diff','--no-textconv','--no-renames','--no-color','--diff-algorithm=myers','--src-prefix=a/','--dst-prefix=b/','--unified=3',base,head,'--']);
      if(b.length!==old.canonicalDiffs[key].bytes||sha(b)!==old.canonicalDiffs[key].sha256)throw Error('Diff mismatch '+key);
      if(dir===restore)fs.writeFileSync(path.join(root,key+'.diff'),b,{flag:'wx'});
    }
    if(await text([...g,'rev-parse',h.reviewHead+':'+old.license.path])!==old.license.blob)throw Error('License blob mismatch');
    const license=await git([...g,'show',h.reviewHead+':'+old.license.path]);
    if(sha(license)!==old.license.contentSha256)throw Error('License content mismatch');
    if(dir===restore)fs.writeFileSync(path.join(root,'LICENSE.txt'),license,{flag:'wx'});
    checks[path.basename(dir)]={fsck:true,shallow:false,allFourTrees:true,ancestryCount:7749,roots,familyIdentitySha256:family,threeCanonicalDiffs:true,license:true,noAlternatesPromisorReplacementsGrafts:true};
  }
  await git(['--git-dir='+restore,'bundle','verify',bundle]);
  const b=fs.readFileSync(bundle);
  const manifest={schemaVersion:2,createdAt:new Date().toISOString(),evidenceClass:'visible-development-source-recovery-only',status:'offline-source-verified-not-admitted',sourceRepository:old.sourceRepository,oldManifestSha256:sha(oldBytes),oldBundleSha256:old.artifact.sha256,oldBundleBytes:old.artifact.bytes,artifact:{path:bundle,bytes:b.length,sha256:sha(b),oldByteIdentity:sha(b)===old.artifact.sha256,localPersistentOnly:true},history:h,canonicalDiffs:old.canonicalDiffs,license:old.license,checks,limits:{aggregateDiskBytes:usage(),capBytes:cap,elapsedSeconds:(Date.now()-start)/1000,wallCapSeconds:1200},limitations:['Source availability only; not admission, human confirmation, partition selection, or runtime reproduction.','Exact historical refs only; current default branch intentionally not acquired.','No historical source, hooks, dependencies, builds, or providers executed.','Persistent local bundle only, not pushed to Git; missing old bundle is not recreated byte-for-byte unless hashes match.']};
  fs.writeFileSync(path.join(root,'recovery-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  if(usage()>cap)throw Error('Final storage cap exceeded');
  console.log(JSON.stringify(manifest,null,2));
}catch(error){fs.writeFileSync(path.join(root,'recovery-failure.json'),JSON.stringify({status:'deferred',error:String(error),aggregateDiskBytes:usage(),elapsedSeconds:(Date.now()-start)/1000},null,2)+'\n');throw error;}

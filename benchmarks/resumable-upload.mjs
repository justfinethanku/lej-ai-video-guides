// Separate upload process; local HTTP sink validates all bytes with SHA-256. No credentials or remote writes.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { open, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [mode, workerRoot, file, base] = process.argv.slice(2);
const studio = fileURLToPath(new URL('..', import.meta.url));
const root = mode === 'worker' ? workerRoot : studio;
if (!['baseline', 'patched', 'worker'].includes(mode)) throw Error('Usage: node benchmarks/resumable-upload.mjs baseline|patched');
if (mode === 'worker') {
 const before = process.memoryUsage();
 const started = performance.now();
 if (root === 'baseline') {
  const source = execFileSync('git', ['show', 'ae806ad56b4f8de75acc5b1969aa4dab64206d55:scripts/publish.mjs'], { cwd: studio, encoding: 'utf8' });
  const fn = source.slice(source.indexOf('async function uploadResumable('), source.indexOf('\nasync function upload('));
  const upload = new Function('readFileSync','fetch','BASE','BUCKET','auth','console',`return (${fn});`)(readFileSync,fetch,base,'fixture',{}, {log(){}});
  await upload('demo/v1/video.mp4',file,'video/mp4');
 } else {
  const { uploadResumable } = await import(pathToFileURL(resolve(root,'scripts/resumable-upload.mjs')));
  await uploadResumable('demo/v1/video.mp4',file,'video/mp4',{base,bucket:'fixture',auth:{}});
 }
 const after = process.memoryUsage();
 console.log(JSON.stringify({elapsedMs:performance.now()-started, beforeRss:before.rss, peakRss:process.resourceUsage().maxRSS*1024, afterRss:after.rss, external:after.external}));
 process.exit(0);
}
const kind=mode; // baseline or patched
const dir=await mkdtemp(join(tmpdir(),'guides-upload-bench-'));
let offset=0, length=0, hash, digest, patches=0;
const server=createServer(async(req,res)=>{
 try {
  if(req.method==='DELETE') {res.writeHead(200).end();return;}
  if(req.method==='POST') {length=Number(req.headers['upload-length']);offset=0;patches=0;hash=createHash('sha256');res.writeHead(201,{Location:`http://127.0.0.1:${server.address().port}/upload/1`}).end();return;}
  if(req.method!=='PATCH' || Number(req.headers['upload-offset'])!==offset) throw Error('wrong offset/method');
  let n=0;for await(const chunk of req) {n+=chunk.length;hash.update(chunk);}
  if(n>6*1024*1024 || n<=0)throw Error('wrong chunk size');
  offset+=n;patches++;if(offset===length)digest=hash.digest('hex');
  res.writeHead(204,{'Upload-Offset':String(offset)}).end();
 }catch(e){res.writeHead(400).end(e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
 for(const mib of [32,128,256]) {
  const input=join(dir,`${mib}.bin`);const f=await open(input,'w');await f.truncate(mib*1024*1024);await f.write(Buffer.from('start'),0,5,0);await f.write(Buffer.from('end'),0,3,mib*1024*1024-3);await f.close();
  const expected=createHash('sha256');const src=await open(input,'r');for await(const bytes of src.createReadStream())expected.update(bytes);const expectedDigest=expected.digest('hex');
  for(let repeat=1;repeat<=2;repeat++) {
   const args=['--max-old-space-size=256',fileURLToPath(import.meta.url),'worker',kind==='baseline'?'baseline':root,input,`http://127.0.0.1:${server.address().port}`];
   const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
   const code=await new Promise((r,reject)=>{child.once('close',r);child.once('error',reject);});if(code!==0)throw Error(stderr);
   if(offset!==mib*1024*1024||digest!==expectedDigest)throw Error('uploaded bytes differ');
   console.log(JSON.stringify({kind,mib,repeat,patches,sha256:digest,...JSON.parse(stdout)}));
  }
 }
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}

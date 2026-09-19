/** Render a 30-second film from the real browser captures; no simulated product states. */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir = resolve('output/privacy');
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const W = 1920, H = 1080, FPS = 30;
const scenes = [
  { duration:4, file:'01-family-privacy.png', crop:[60,100,1310,810], label:'INTRODUCING / FAMILY PRIVACY', lines:['Their future.','Their privacy.'], copy:['A quieter digital footprint.','A growing world of possibilities.'], tag:'A new layer of care' },
  { duration:4.5, file:'02-encrypted-labels.png', crop:[120,70,590,515], label:'01 / ENCRYPTED FAMILY LABELS', lines:['Their name.','Your secret.'], copy:['Private labels, encrypted on your device.','Unlock. Back up. Recover.'], tag:'Your keys stay with you' },
  { duration:4.5, file:'03-kid-invitation.png', crop:[730,40,590,780], label:'02 / INVITATION-ONLY KID ACCESS', lines:['A little window.','No vault keys.'], copy:['One-use invitations. No name in the link.','No wallet address. Amounts hidden by default.'], tag:'Read only • expires automatically' },
  { duration:4, file:'04-kid-view.png', crop:[80,70,1270,815], label:'03 / ROOM TO LEARN', lines:['Less exposure.','More discovery.'], copy:['A private view made for curiosity.','No wallet connection. No money-moving buttons.'], tag:'Built for their world' },
  { duration:4, file:'05-gift-preview.png', crop:[410,190,620,590], label:'04 / THOUGHTFUL GIFTING', lines:['Share the love.','Leave names out.'], copy:['Generic previews. Encrypted gift messages.','A little today. A world of possibilities.'], tag:'No public message wall' },
  { duration:4, file:'07-kid-revoked.png', crop:[80,70,1270,650], label:'05 / YOUR FAMILY. YOUR CALL.', lines:['Open a window.','Close it anytime.'], copy:['Revoke an invitation from Family privacy.','That device loses access on its next request.'], tag:'Revocable from your dashboard' },
  { duration:5, file:'08-boundary.png', crop:[85,435,1270,340], label:'SPROUT / A MORE PRIVATE FAMILY SPACE', lines:['More privacy.','More peace of mind.'], copy:['App privacy is here. On-chain shielding is not.','Wallet balances and transfers remain public.'], tag:'A growing future. A smaller footprint.', dark:true },
];
for (const s of scenes) s.image = await loadImage(await readFile(resolve(dir,s.file)));
const logo = await loadImage(await readFile('web/public/brand/sprout-logo.png'));
const canvas = createCanvas(W,H), ctx=canvas.getContext('2d');
const processVideo = spawn(ffmpeg, ['-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',resolve(dir,'showcase-silent.mp4')], {stdio:['pipe','ignore','pipe']});
let encoderLog=''; processVideo.stderr.on('data', d=>encoderLog+=d.toString());
const clamp=n=>Math.max(0,Math.min(1,n));
const ease=n=>1-Math.pow(1-clamp(n),3);
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function text(value,x,y,size,color,font='Arial',weight='400'){ctx.fillStyle=color;ctx.font=`${weight} ${size}px ${font}`;ctx.fillText(value,x,y);}
function paint(scene,at,opacity=1){
  const entry=ease(at/.75), progress=clamp(at/scene.duration), dark=scene.dark;
  const ink=dark?'#f2f4df':'#203f2c', secondary=dark?'#b8c6a3':'#71816a';
  ctx.save();ctx.globalAlpha=opacity;
  ctx.fillStyle=dark?'#173b2c':'#eff0e7';ctx.fillRect(0,0,W,H);
  const glow=ctx.createRadialGradient(1500,400,30,1300,400,900);glow.addColorStop(0,dark?'#426a4144':'#d2dfbf99');glow.addColorStop(1,dark?'#173b2c00':'#eff0e700');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
  ctx.strokeStyle=dark?'#b7cd9740':'#9eae8b40';ctx.lineWidth=1;
  for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(1500,540,390+i*64,330+i*56,progress*.06+i*.25,0,Math.PI*2);ctx.stroke();}
  ctx.drawImage(logo,90,58,44,44);text('sprout',150,92,35,ink,'Arial','700');
  text('FAMILY PRIVACY',W-320,88,15,secondary,'Arial','600');
  ctx.strokeStyle=dark?'#78976855':'#bbc7b088';ctx.beginPath();ctx.moveTo(90,135);ctx.lineTo(1830,135);ctx.stroke();
  const offset=(1-entry)*35;
  text(scene.label,100,268+offset,14,secondary,'Arial','600');
  scene.lines.forEach((line,i)=>{ctx.save();ctx.beginPath();ctx.rect(90,290+i*95,650*ease((at-i*.12)/.75),115);ctx.clip();ctx.font=`${i===1?'italic':'400'} 76px Georgia`;const fontSize=Math.min(76, 635/ctx.measureText(line).width*76);text(line,96,384+i*95+offset,fontSize,i===1?(dark?'#b4d093':'#718c55'):ink,'Georgia',i===1?'italic':'400');ctx.restore();});
  scene.copy.forEach((line,i)=>text(line,102,548+i*31+offset,19,secondary));
  ctx.fillStyle=dark?'#32533a':'#e0e8d6';rr(100,659+offset,Math.min(530,ctx.measureText(scene.tag).width+64),47,24);ctx.fill();ctx.fillStyle=dark?'#aeca8b':'#597642';ctx.beginPath();ctx.arc(121,683+offset,4,0,Math.PI*2);ctx.fill();text(scene.tag,137,689+offset,16,dark?'#e6edd5':'#4d653e');
  // Camera motion is applied to captured interface pixels, never invented UI.
  const crop=scene.crop;
  let targetW= scene.file==='02-encrypted-labels.png'?840:scene.file==='03-kid-invitation.png'?610:scene.file==='05-gift-preview.png'?780:1090;
  let targetH=targetW*crop[3]/crop[2];
  if(targetH>760){targetW*=760/targetH;targetH=760;}
  const x=scene.file==='03-kid-invitation.png'?1050:1880-targetW;
  const y=530-targetH/2;
  ctx.save();ctx.translate(x+targetW/2+(1-entry)*90,y+targetH/2+Math.sin(progress*2.5)*7);ctx.rotate((1-progress)*-.012);const z=1+progress*.022;ctx.scale(z,z);
  ctx.shadowColor=dark?'#071e2255':'#3443242b';ctx.shadowBlur=45;ctx.shadowOffsetY=22;ctx.fillStyle='#fbfcf6';rr(-targetW/2,-targetH/2,targetW,targetH,23);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  rr(-targetW/2,-targetH/2,targetW,targetH,23);ctx.clip();ctx.drawImage(scene.image,...crop,-targetW/2,-targetH/2,targetW,targetH);ctx.restore();
  text('WORKING LOCAL BUILD  /  SAMPLE FAMILY',100,997,13,secondary,'Arial','600');
  text(`${String(scenes.indexOf(scene)+1).padStart(2,'0')} / 07`,1740,997,15,secondary,'Arial','600');
  ctx.restore();
}
let sceneStart=0;
for(let frame=0;frame<FPS*30;frame++){
  const t=frame/FPS;let idx=0,start=0;
  while(idx<scenes.length-1 && t>=start+scenes[idx].duration){start+=scenes[idx].duration;idx++;}
  const scene=scenes[idx], local=t-start;
  paint(scene,local);
  if(idx>0 && local<.32){paint(scenes[idx-1],scenes[idx-1].duration,1-ease(local/.32));}
  ctx.fillStyle=scene.dark?'#bdcf97':'#759356';ctx.fillRect(90,1034,1740*(t/30),3);
  if(frame===70 || frame===185 || frame===345 || frame===845) await writeFile(resolve(dir,`film-frame-${frame}.png`),canvas.toBuffer('image/png'));
  const data=canvas.toBuffer('image/jpeg',95);
  if(!processVideo.stdin.write(data)) await once(processVideo.stdin,'drain');
  if(frame%180===0) console.log(`Rendered ${frame/FPS}s / 30s`);
}
processVideo.stdin.end();
const [code]=await once(processVideo,'close');
if(code!==0) throw new Error(encoderLog.slice(-2000));
console.log('30-second 1080p motion showcase rendered.');

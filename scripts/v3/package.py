from pathlib import Path
import json,subprocess,os,shutil,zipfile,html
from urllib.parse import quote
import imageio_ffmpeg
root=Path(__file__).resolve().parents[2];source=root/'output/v3';dest=Path.home()/'Downloads'/'SPROUT - V3 Expansion Videos';dest.mkdir(parents=True,exist_ok=True)
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe();comp=Path('/Users/kusko/Documents/ChatGPT/SPROUT/output/sprout-tech-ten/node_modules/@remotion/compositor-darwin-arm64').resolve();env=dict(os.environ,DYLD_LIBRARY_PATH=str(comp));manifest=json.loads((source/'capture/manifest.json').read_text());features=['events','roundups','cash','arena','continuity'];result=[]
for i,path in enumerate(sorted((source/'videos').glob('*.mp4'))):
 meta=json.loads(subprocess.run([str(comp/'ffprobe'),'-v','error','-show_streams','-show_format','-of','json',str(path)],env=env,check=True,capture_output=True,text=True).stdout);v=next(s for s in meta['streams'] if s['codec_type']=='video');a=next(s for s in meta['streams'] if s['codec_type']=='audio');assert v['width']==1920 and v['height']==1080 and v['codec_name']=='h264' and v['pix_fmt']=='yuv420p';assert v['r_frame_rate']=='30/1' and abs(float(meta['format']['duration'])-30)<.05;assert a['codec_name']=='aac'
 subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-i',str(path),'-f','null','-'],check=True,capture_output=True)
 shutil.copy2(path,dest/path.name);poster=f'{features[i]}.jpg';shutil.copy2(source/'qa'/f'{features[i]}-film-2.jpg',dest/poster);result.append({'feature':features[i],'title':path.stem[5:],'file':path.name,'poster':poster,'duration':float(meta['format']['duration']),'resolution':'1920 × 1080','fps':30,'videoCodec':'H.264','audioCodec':'AAC','voiceover':False,'bytes':path.stat().st_size})
assert len(result)==5
(source/'qa/media-report.json').write_text(json.dumps(result,indent=2));(dest/'video-details.json').write_text(json.dumps(result,indent=2))
font=root/'web/public/fonts/satoshi/Satoshi-Variable.woff2';shutil.copy2(font,dest/'Satoshi-Variable.woff2');shutil.copy2(font.parent/'FFL.txt',dest/'Font License.txt')
readme='''SPROUT — FIVE PRODUCT UPDATES

Five 30-second, 1080p desktop recordings, with instrumental music and no voices.
Open index.html for the watch page. The MP4 files also play independently.

01 Events & Match — create a celebration, copy its invitation, contribute and receive an automatic sponsor match.
02 Round-ups — choose rounding and multiplier rules, set a weekly cap, and inspect the confirmed transfer journal.
03 Cash Garden — park test cash, redeem treasury shares, and inspect current asset values.
04 Teen Arena — place a practice trade, replay decisions, and complete a lesson.
05 Continuity — save a successor plan, check in, and fund a continuity reserve.

These are recordings of the working local app using an isolated Anvil chain and test funds. Cash Garden uses a test treasury. No live treasury integration, live fund movement or public deployment is implied. Onchain transactions and role addresses are public; private application records are encrypted at rest. The brief's separate shielded-settlement and key-ladder integrations are not connected.

App preview: http://127.0.0.1:5198/grow/events
Source branch: codex/sprout-v3-expansion
The source worktree contains setup, tests, capture and render scripts under scripts/v3, with build notes in docs/v3/BUILD.md.

Visual assets: existing Sprout landing-page artwork. Satoshi: Fontshare, license included. Music: original synthesized instrumental score from the Sprout film workspace. No voice recording or voice generation was used.
'''
(dest/'README.txt').write_text(readme)
zipname='SPROUT - All 5 Updates.zip'
with zipfile.ZipFile(dest/zipname,'w',compression=zipfile.ZIP_STORED) as z:
 for p in sorted(dest.glob('*.mp4')):z.write(p,p.name)
 z.write(dest/'README.txt','README.txt')
cards=''.join(f'''<article><div class="caption"><span>0{i+1}</span><h2>{html.escape(x['title'])}</h2><b>00:30</b></div><video controls playsinline preload="metadata" poster="{x['poster']}"><source src="{quote(x['file'])}" type="video/mp4"></video><div class="under"><span>1080p · Desktop walkthrough · No voiceover</span><a download href="{quote(x['file'])}">Download MP4 ↗</a></div></article>''' for i,x in enumerate(result))
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sprout — A growing world</title><style>@font-face{font-family:Satoshi;src:url('./Satoshi-Variable.woff2')}*{box-sizing:border-box}body{margin:0;background:#fcfbf6;color:#254e38;font-family:Satoshi,Arial,sans-serif}a{color:inherit}header{display:flex;align-items:center;justify-content:space-between;padding:27px 5vw;border-bottom:1px solid #e1e7d8}.logo{font:35px Georgia,serif;letter-spacing:-1px;text-decoration:none}.toplinks{display:flex;gap:25px;font-size:12px}.intro{max-width:1380px;margin:64px auto 45px;padding:0 30px;display:flex;align-items:end;justify-content:space-between;gap:35px}.kicker{font-size:10px;font-weight:800;letter-spacing:2px;color:#8b997a}h1{font:52px/1.06 Georgia,serif;letter-spacing:-1.5px;margin:20px 0}em{color:#83986a;font-weight:400}.intro p{max-width:560px;font-size:14px;color:#829174;line-height:1.8}.download{display:inline-flex;align-items:center;gap:14px;padding:15px 21px;background:#254e38;color:#fffef5;text-decoration:none;border-radius:7px;font-size:12px;white-space:nowrap}.grid{max-width:1380px;padding:0 30px;display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:0 auto}article{border:1px solid #dfe5d5;border-radius:12px;background:#fffef9;overflow:hidden}.caption{display:flex;align-items:center;gap:16px;padding:23px}.caption>span{font:22px Georgia,serif;color:#a6b196}h2{font:27px Georgia,serif;margin:0;letter-spacing:-.6px}.caption>b{font-size:11px;font-weight:400;color:#9aaa85;margin-left:auto}video{display:block;width:100%;aspect-ratio:16/9;background:#f0f3e8}.under{padding:20px 23px;display:flex;justify-content:space-between;gap:20px;font-size:10px;color:#899879}.under>a{text-decoration:none;color:#345d40}footer{max-width:1320px;margin:50px auto;padding:30px 0;border-top:1px solid #dfe5d5;display:flex;justify-content:space-between;font-size:11px;color:#8a987b}.note{max-width:850px;padding:0 30px;margin:40px auto;font-size:11px;line-height:1.8;color:#91a17f;text-align:center}:focus-visible{outline:3px solid #d2a56e;outline-offset:4px}@media(max-width:800px){.intro{display:block;margin-top:35px}.grid{grid-template-columns:1fr;padding:0 20px}.intro{padding:0 20px}h1{font-size:40px}.intro>.download{margin-top:15px}.toplinks{gap:14px;font-size:10px}.caption{padding:20px}.under{font-size:9px}footer{margin:30px 20px;gap:20px}.intro p{font-size:12px}}</style></head><body><header><a class="logo" href="./">sprout</a><div class="toplinks"><a href="http://127.0.0.1:5198/grow/events">Open the app ↗</a><a href="README.txt">Build notes ↗</a></div></header><section class="intro"><div><span class="kicker">FIVE NEW WAYS TO GROW</span><h1>A little more care.<br/><em>A whole world ahead.</em></h1><p>Five working desktop experiences, made in Sprout’s visual world.<br/>A 30-second walkthrough of every update. Music, motion, no voices.</p></div><a class="download" download href="ZIPFILE">Download all five videos <span>↓</span></a></section><main class="grid">CARDS</main><p class="note">Recorded in the local app using test funds. The cash treasury is a practice integration. Private application records are encrypted; blockchain transactions are public.</p><footer><span>Small beginnings. Meaningful futures.</span><span>SPROUT · PRODUCT UPDATES</span></footer><script>document.querySelectorAll('video').forEach(v=>v.addEventListener('play',()=>document.querySelectorAll('video').forEach(other=>{if(other!==v)other.pause()})))</script></body></html>'''.replace('CARDS',cards).replace('ZIPFILE',quote(zipname))
(dest/'index.html').write_text(page)
print(json.dumps({'folder':str(dest),'zip':str(dest/zipname),'videos':len(result),'totalMegabytes':round(sum(x['bytes'] for x in result)/1e6,1),'validated':True},indent=2))

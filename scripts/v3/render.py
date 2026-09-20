from pathlib import Path
import json, subprocess, concurrent.futures, os
import imageio_ffmpeg
root=Path(__file__).resolve().parents[2]; out=root/'output/v3'; final=out/'videos'; final.mkdir(parents=True,exist_ok=True)
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe(); font='/System/Library/Fonts/Supplemental/Georgia.ttf'; sans='/System/Library/Fonts/Supplemental/Arial.ttf'
scenes={
'events':('Events & Match',[(0,6,'A moment today. A bigger tomorrow.'),(6,16,'Parent contributions trigger funded sponsor matches.'),(16,30,'Create a celebration and share its gift link.')]),
'roundups':('Round-ups',[(0,10,'Choose the rounding step. Set your boost.'),(10,19,'Approve a total allowance and a weekly limit.'),(19,30,'Every confirmed transfer, recorded once.')]),
'cash':('Cash Garden',[(0,12,'Park eligible cash in the family vault.'),(12,20,'Redeem treasury shares back to settlement cash.'),(20,30,'Current asset values. Clear eligibility checks.')]),
'arena':('Teen Arena',[(0,10,'Your family’s portfolio. A practice version.'),(10,18,'Record a practice trade. Replay the decision.'),(18,30,'Learn the essentials. Build confidence.')]),
'continuity':('Continuity',[(0,10,'Choose the person who can carry the plan forward.'),(10,19,'A check-in clock and a window to review.'),(19,30,'Set aside future care in a separate reserve.')])}
manifest=json.loads((out/'capture/manifest.json').read_text()); selected=os.environ.get('V3_RENDER_ONLY'); results=[]
def render(pair):
 i,(name,(title,captions))=pair
 if selected and name!=selected:return
 if name not in manifest:return
 item=manifest[name]; captiondir=out/'captions';captiondir.mkdir(exist_ok=True)
 titlefile=captiondir/f'{name}-title.txt';titlefile.write_text(f'sprout  /  {title}')
 meta=captiondir/f'{name}-meta.txt';meta.write_text(f'0{i+1} / 05     PRODUCT UPDATE     •     LOCAL PRACTICE')
 filters=['scale=1792:1008:flags=lanczos','pad=1920:1080:64:36:color=0xfcfbf6',f'drawtext=fontfile={font}:textfile={titlefile}:fontsize=23:fontcolor=0x244e38:x=64:y=6',f'drawtext=fontfile={sans}:textfile={meta}:fontsize=12:fontcolor=0x78876b:x=w-tw-64:y=12']
 for j,(start,end,text) in enumerate(captions):
  path=captiondir/f'{name}-{j}.txt';path.write_text(text)
  filters.append(f"drawtext=fontfile={sans}:textfile={path}:fontsize=20:fontcolor=0x3e6546:x=(w-tw)/2:y=1051:enable='between(t,{start},{end})'")
 filters+=['fade=t=in:st=0:d=0.2','fade=t=out:st=29.65:d=0.35']
 target=final/f'0{i+1} - {title}.mp4'
 command=[ffmpeg,'-hide_banner','-loglevel','error','-y','-ss',str(item['start']),'-i',item['path'],'-ss',str(i*2),'-i',str(out/'audio/score.wav'),'-t','30','-vf',','.join(filters),'-af','loudnorm=I=-18:TP=-1.5:LRA=9,afade=t=in:st=0:d=0.35,afade=t=out:st=28.6:d=1.4','-r','30','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-threads','4','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(target)]
 subprocess.run(command,check=True)
 stills=[]
 for at in [2,9,17,26]:
  still=out/'qa'/f'{name}-film-{at}.jpg';subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-ss',str(at),'-i',str(target),'-frames:v','1',str(still)],check=True);stills.append(str(still))
 return {'feature':name,'title':title,'path':str(target),'duration':30,'width':1920,'height':1080,'fps':30,'voice':False,'audio':'Original instrumental score','bytes':target.stat().st_size,'stills':stills}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 for result in pool.map(render,enumerate(scenes.items())):
  if result:results.append(result);print(f"Rendered {result['title']}: 30 seconds, 1080p, instrumental only.",flush=True)
previous=json.loads((out/'rendered.json').read_text()) if (out/'rendered.json').exists() else []
merged={x['feature']:x for x in previous}
merged.update({x['feature']:x for x in results})
(out/'rendered.json').write_text(json.dumps(list(merged.values()),indent=2))

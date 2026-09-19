from pathlib import Path
import json, subprocess, os
root=Path(__file__).resolve().parents[2]/'output/sprout-family-film'
ffmpeg=os.environ['FFMPEG_PATH']
for name,item in json.loads((root/'capture/manifest.json').read_text()).items():
 subprocess.run([ffmpeg,'-v','error','-y','-ss',str(item['start']),'-i',item['path'],'-t',str(item['duration']),'-vf','fps=30','-an','-c:v','libx264','-crf','16','-pix_fmt','yuv420p',str(root/'public/recordings'/f'{name}.mp4')],check=True)
 for second in [1,item['duration']-1]:
  subprocess.run([ffmpeg,'-v','error','-y','-ss',str(second),'-i',str(root/'public/recordings'/f'{name}.mp4'),'-frames:v','1',str(root/'capture'/f'{name}-{second}.png')],check=True)
print('Recordings trimmed and inspected frames exported.')

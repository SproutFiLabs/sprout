from pathlib import Path
import numpy as np, wave, json
sr=48000; dur=40; n=sr*dur; mix=np.zeros((n,2)); rng=np.random.default_rng(19192026)
def put(sig,at,amp=1,pan=0):
 i=int(at*sr)
 if i>=n:return
 j=min(n,i+len(sig)); sig=sig[:j-i]*amp
 mix[i:j,0]+=sig*np.sqrt((1-pan)/2);mix[i:j,1]+=sig*np.sqrt((1+pan)/2)
def key(note,d=1.4):
 t=np.arange(int(sr*d))/sr;f=440*2**((note-69)/12)
 return (np.sin(2*np.pi*f*t+1.25*np.sin(2*np.pi*f*2*t)*np.exp(-t*10))*np.exp(-t*3)+.12*np.sin(2*np.pi*f*3*t)*np.exp(-t*8))*np.minimum(t*300,1)
# Original warm electronic groove, 120 BPM. Extended chords, syncopated bass,
# soft brushed percussion, a small melodic motif, and frame-aligned UI foley.
chords=[[50,57,60,64,69],[46,53,57,60,65],[53,60,64,67,72],[48,55,58,62,67]]
for bar in range(20):
 at=bar*2; ch=chords[bar%4]
 for j,note in enumerate(ch):put(key(note,2.7),at+j*.012,.055,(-.5+j*.25))
 for step in [0,.75,1.5]:put(key(ch[0]-12,.5),at+step,.17)
 for j,note in enumerate([ch[2]+12,ch[4],ch[1]+12,ch[3]+12]):
  if bar%2==0 or bar>=10:put(key(note,.85),at+.25+j*.5,.045,(-1)**j*.4)
 if 1<=bar<18:
  for beat in range(4):
   t=np.arange(int(sr*.22))/sr
   put(np.sin(2*np.pi*(48*t+2.8*(1-np.exp(-32*t))))*np.exp(-t*24),at+beat*.5,.21 if beat%2==0 else .08)
   if beat%2:put(np.convolve(rng.normal(size=len(t)),np.ones(3)/3,mode='same')*np.exp(-t*30),at+beat*.5,.055,.15)
  for tick in range(8):
   t=np.arange(int(sr*.08))/sr; noise=rng.normal(size=len(t));put(np.diff(noise,prepend=0)*np.exp(-t*85),at+tick*.25+.015,.009 if tick%2 else .006,(-1)**tick*.5)
for at,notes in [(0,[76,74,69]),(4,[76,79,77]),(10,[74,76,81]),(13,[81,79,76]),(18,[77,76,72]),(24,[74,76,81,86]),(27,[81,76,74])]:
 for i,note in enumerate(notes):put(key(note,1.9),at+i*.5,.065,(-1)**i*.25)
cuts=[3,9,17,27,33,36]
events=[(t,'whoosh') for t in cuts]+[(.4,'bloom'),(5.1,'tap'),(13.4,'confirm'),(19.2,'tap'),(21.6,'tap'),(24.2,'confirm'),(30.7,'confirm'),(33.2,'bloom'),(36.3,'resolve')]
for at,kind in events:
 if kind=='whoosh':
  d=.35;t=np.arange(int(sr*d))/sr;noise=np.convolve(rng.normal(size=len(t)),np.ones(24)/24,mode='same');put(noise*np.sin(np.pi*t/d)**2,max(0,at-.18),.11,-.25)
 elif kind=='tap':put(key(88,.18),at,.065)
 else:
  for j,m in enumerate([74,81,86]):put(key(m,1.3),at+j*.05,.052,-.3+j*.3)
for delay,gain in [(.113,.12),(.229,.075),(.373,.04)]:
 d=int(sr*delay);mix[d:]+=mix[:-d,::-1].copy()*gain
mix*=np.minimum(np.arange(n)/sr/.12,1)[:,None]*np.minimum((n-np.arange(n))/sr/1.6,1)[:,None]
mix=np.tanh(mix*1.1);mix*=.65/max(1e-9,np.abs(mix).max())
p=Path(__file__).resolve().parents[2]/'output/sprout-family-film';out=p/'public/audio/score.wav'
with wave.open(str(out),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((mix*32767).astype('<i2').tobytes())
(p/'audio-cues.json').write_text(json.dumps(events,indent=2));print('Original 40-second stereo score and synchronized sound effects rendered.')

import React,{useEffect,useState} from 'react';
import {AbsoluteFill,Img,Audio,OffthreadVideo,Sequence,staticFile,useCurrentFrame,delayRender,continueRender} from 'remotion';
import './film.css';
const B={ink:'#292d26',paper:'#fafbf7',sage:'#edf1e5',green:'#476249',muted:'#66705c'};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));const ease=(v:number)=>1-Math.pow(1-clamp(v),4);
const arrive=(t:number,start=0,d=.7)=>ease((t-start)/d);
function Logo(){return <div className="wf-logo"><Img src={staticFile('brand/sprout-logo.png')}/>SPROUT</div>}
function Reveal({t,children}:{t:number;children:React.ReactNode}){return <div style={{overflow:'hidden',paddingBottom:8,marginBottom:-8}}><div style={{transform:`translateY(${(1-arrive(t))*110}%)`}}>{children}</div></div>}
function Bouquet({t,end=false}:{t:number;end?:boolean}){return <div className="wf-bouquet" style={{transform:`translateY(${(1-arrive(t,0,1.1))*250}px) rotate(${(end?3:-4)+(1-arrive(t,0,1.2))*-12}deg) scale(${.85+.15*arrive(t,0,1.2)})`,opacity:arrive(t,0,.25)}}><Img src={staticFile('art/harvest-bouquet.png')}/></div>}
const scenes=[
 {from:3,to:9,clip:'assets',number:'01',title:'Know what you own.',sub:'Search an asset. Read the rights behind it.',note:'Actual product recording · Robinhood Stock Tokens are unavailable to US persons.'},
 {from:9,to:17,clip:'records',number:'02',title:'Give every detail a home.',sub:'Review a record. Fill the gap. Save it.',note:'Example transaction records · Tax estimates depend on entered values; this is not a tax filing.'},
 {from:17,to:27,clip:'planner',number:'03',title:'Make room for their someday.',sub:'Choose a goal, decide ownership, and save your plan.',note:'Actual planner workflow · Account opening, deposits and trading are not enabled.'},
 {from:27,to:33,clip:'rewards',number:'04',title:'Follow every little win.',sub:'From an eligible purchase to a clear reward trail.',note:'Illustrative reward flow · Funding and provider activation required. Payouts are manual.'},
 {from:33,to:36,clip:'context',number:'05',title:'Bring your questions along.',sub:'Open Intelligence with the asset already in context.',note:'Actual context handoff · Live AI requires verified holder access. Not financial advice.'},
];
function Clip({scene}:{scene:typeof scenes[number]}){const t=useCurrentFrame()/30;return <AbsoluteFill style={{background:scene.number==='02'||scene.number==='04'?B.sage:B.paper}}>
 <div className="wf-heading"><span>{scene.number} / YOUR SPROUT TOOLKIT</span><h1><Reveal t={t}>{scene.title}</Reveal></h1><p style={{opacity:arrive(t,.12)}}>{scene.sub}</p></div>
 <div className="wf-shot-count">{scene.number}<span>/ 05</span></div>
 <div className="wf-screen" style={{transform:`translateY(${(1-arrive(t,0,.5))*38}px) scale(${.992+.008*arrive(t,0,.6)})`,opacity:arrive(t,0,.3)}}>
  <div className="wf-browser"><i/><i/><i/><span>SPROUT / {scene.clip==='records'?'tax-garden':scene.clip==='planner'?'family-investing':scene.clip==='context'?'intelligence':scene.clip==='assets'?'asset-passports':'rewards'}</span><b>RECORDED WORKFLOW</b></div>
  <OffthreadVideo src={staticFile(`recordings/${scene.clip}.mp4`)} muted style={{display:'block',width:'100%',transform:scene.clip==='records'?`scale(${1+.55*arrive(t,1,.6)*(1-arrive(t,4.6,.6))})`:undefined,transformOrigin:'100% 58%'}}/>
 </div>
 <div className="wf-note">{scene.note}</div>
 </AbsoluteFill>}
export function FamilyFilm(){const t=useCurrentFrame()/30;const [handle]=useState(()=>delayRender('Brand font'));useEffect(()=>{document.fonts.load('500 24px Satoshi').then(()=>continueRender(handle));},[handle]);
 const cuts=[3,9,17,27,33,36];const cut=cuts.find(c=>Math.abs(t-c)<.16);const phase=cut===undefined?0:(t-cut+.16)/.32;
 return <AbsoluteFill style={{background:B.paper,color:B.ink,fontFamily:'Satoshi'}}>
 <Audio src={staticFile('audio/score.wav')} volume={.85}/>
 <Sequence durationInFrames={90}><AbsoluteFill><div className="wf-brand"><Logo/></div><div className="wf-intro"><span className="wf-eyebrow">THE FAMILY TOOLKIT / A NEW CHAPTER</span><h1><Reveal t={t-.05}>Your SPROUT.</Reveal><Reveal t={t-.2}><em>Put to use.</em></Reveal></h1><p style={{opacity:arrive(t,.55)}}>A little more clarity. Every day.</p></div><Bouquet t={t-.1}/><div className="wf-caption">Product preview • Example data</div></AbsoluteFill></Sequence>
 {scenes.map(s=><Sequence key={s.clip} from={s.from*30} durationInFrames={(s.to-s.from)*30}><Clip scene={s}/></Sequence>)}
 <Sequence from={1080} durationInFrames={120}><AbsoluteFill><div className="wf-brand"><Logo/></div><div className="wf-outro"><span className="wf-eyebrow">LITTLE BY LITTLE. TOGETHER.</span><h1><Reveal t={t-36}>Small steps.</Reveal><Reveal t={t-36.12}><em>A clearer tomorrow.</em></Reveal></h1><div className="wf-benefit" style={{opacity:arrive(t,36.35)}}><b>1M SPROUT</b><span>Holder access to Intelligence<br/>and accountant exports.</span></div><p className="wf-url" style={{opacity:arrive(t,36.55)}}>sproutfy.tech</p></div><Bouquet t={t-36} end/><div className="wf-caption">Product preview · Not financial advice.</div></AbsoluteFill></Sequence>
 {cut!==undefined&&<div style={{position:'absolute',inset:0,zIndex:10,background:B.sage,clipPath:`inset(0 ${Math.max(0,100-phase*220)}% 0 ${Math.max(0,(phase-.45)*190)}%)`}}/>}
 </AbsoluteFill>
}

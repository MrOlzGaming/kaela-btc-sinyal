const fs=require('fs'),path=require('path');const R=path.join(__dirname,'..','..')+'/';
// Riset 30 Sep 2026 (lihat BACKTEST-REGISTRY.md bagian Ninja, mean reversion searah tren untuk venue fee 0).
// Pakai: node backtest/ninja/<file>.js <dir cache candle dari NINJA_CANDLE_CACHE>
const {run}=require(R+'backtestNinjaResearch3');const {summarize}=require(R+'backtestNinjaFvg');
const {barPermutationTest,deflatedSharpeRatio}=require(R+'backtest/backtestValidation');
const dir=process.argv[2];const S=Date.UTC(2019,8,30),SP=Date.UTC(2024,8,30),E=Date.UTC(2026,8,30);
const H8=8*3600e3;const bc=(a,b)=>Math.max(0,Math.floor(b/H8)-Math.floor(a/H8));
const load=(sym,tf,a,b)=>JSON.parse(fs.readFileSync(path.join(dir,`${sym}-${tf}-${a}-${b}-v.json`)));
async function fetchSym(sym,tf,a,b){const f=path.join(dir,`${sym}-${tf}-${a}-${b}-v.json`);if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f));let all=[],cur=a;while(cur<b){const r=await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${tf}&startTime=${cur}&endTime=${b}&limit=1000`);const d=await r.json();if(!d.length)break;all=all.concat(d.map(x=>({openTime:x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:x[6]})));cur=d[d.length-1][0]+1}all=all.filter(c=>c.closeTime<b);fs.writeFileSync(f,JSON.stringify(all));return all}
const cost=(c,slip)=>t=>t.grossPct-2*slip-0.01*bc(c[t.entryIdx].openTime,c[t.exitIdx].closeTime);
// exit di OPEN candle berikutnya (bukan close candle sinyal exit) -- kecuali exit kena SL
function nextOpenExit(c,tr){return tr.map(t=>{if(t.exitPrice!==c[t.exitIdx].close||t.exitIdx+1>=c.length)return t;const ep=c[t.exitIdx+1].open;return {...t,exitIdx:t.exitIdx+1,exitPrice:ep,grossPct:((ep-t.entryPrice)/t.entryPrice)*100*(t.dir==='long'?1:-1)}})}
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
(async()=>{
 for(const tf of ['15m','5m']){const is=load('BTCUSDT',tf,SP,E),oos=load('BTCUSDT',tf,S,SP);const p={kind:'mr',trend:true,k:3,exit:'mean'};
  for(const [nm,c,days] of [['IS',is,730],['OOS',oos,1827]]){const tr0=run(c,p);const tr=nextOpenExit(c,tr0);const n=tr.map(cost(c,0.01));const n0=tr0.map(cost(c,0.01));
   console.log(tf,nm,'exit close: NET',n0.reduce((a,b)=>a+b,0).toFixed(1)+'%','| exit next-open: NET',n.reduce((a,b)=>a+b,0).toFixed(1)+'%','PF',summarize(tr.map((t,i)=>({...t,grossPct:n[i]})),tf==='5m'?5:15,days,0).pfNet.toFixed(2),'n',n.length)}
  const perm=barPermutationTest(is,cs=>run(cs,p).map(cost(cs,0.01)),mean,{iterations:100});
  console.log(tf,'IS bar-permutation p=',perm.pValue,'acak',perm.nullMean.toFixed(4),'vs asli',perm.observedMetric.toFixed(4),'%/trade, n acak',perm.nullMeanTradeCount.toFixed(0));
  const dsr=deflatedSharpeRatio(run(oos,p).map(cost(oos,0.01)),1);console.log(tf,'OOS PSR (1 trial, gak dipilih di OOS)=',(dsr.dsr*100).toFixed(1)+'%');}
 for(const tf of ['15m']){const eis=await fetchSym('ETHUSDT',tf,SP,E),eoos=await fetchSym('ETHUSDT',tf,S,SP);
  for(const k of [2,3,4])for(const [nm,c,days] of [['IS',eis,730],['OOS',eoos,1827]]){const tr=run(c,{kind:'mr',trend:true,k,exit:'mean'});const n=tr.map(cost(c,0.01));const y={};tr.forEach((t,i)=>{const yy=new Date(c[t.entryIdx].closeTime).getUTCFullYear();y[yy]=(y[yy]||0)+n[i]});
   console.log('ETH',tf,'k='+k,nm,'n',n.length,'NET',n.reduce((a,b)=>a+b,0).toFixed(1)+'%','PF',summarize(tr.map((t,i)=>({...t,grossPct:n[i]})),15,days,0).pfNet.toFixed(2),JSON.stringify(Object.fromEntries(Object.entries(y).map(([a,b])=>[a,+b.toFixed(1)]))))}}
})();

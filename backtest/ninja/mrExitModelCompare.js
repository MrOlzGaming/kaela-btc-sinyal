// mrExitModelCompare.js (1 Okt 2026) -- bukti model exit: limit SMA20 fill DI LEVEL SMA20 (niru live ninjaMrTrader.js)
// vs asumsi optimis 'exit di CLOSE candle + fee maker' (dipakai angka registry 30 Sep). Mode: strict/closeMaker.
// Pakai: node backtest/ninja/mrExitModelCompare.js <cache5m.json>
const fs=require('fs');const M=require('./culikResearch');
const c5=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const c=M.aggregate(c5,15),ind=M.prep(c);
const p={bb:2.5,trend:true,k:4};
// re-implement run dgn opsi fill: 'strict' (tembus), 'touch' (nyentuh), 'taker' (market open berikutnya)
function run(mode){const MAK=0.02,TAK=0.06;const tr=[];let pos=null,pend=null;
for(let i=0;i<c.length;i++){const x=c[i];let ex=false;
 if(pend){const L=pend.dir==='long';let fill=null,makerIn=true;
  if(mode==='taker'){fill=x.open;makerIn=false}else if(mode==='strict'?(L?x.low<pend.limit:x.high>pend.limit):(L?x.low<=pend.limit:x.high>=pend.limit))fill=pend.limit;
  if(fill!==null){const f=pend.slPct/100;pos={dir:pend.dir,entry:fill,idx:i,sl:L?fill*(1-f):fill*(1+f),makerIn,ml:ind.sma[i]};
   if(L?x.low<=pos.sl:x.high>=pos.sl){cl(i,pos.sl,false);ex=true}else if(L?x.close>=ind.sma[i]:x.close<=ind.sma[i]){cl(i,x.close,false);ex=true}}
  pend=null}
 else if(pos){const L=pos.dir==='long';
  if(L?x.low<=pos.sl:x.high>=pos.sl){cl(i,L?Math.min(x.open,pos.sl):Math.max(x.open,pos.sl),false);ex=true}
  else if(mode==='closeMaker'?false:(mode==='strict'?(L?x.high>pos.ml:x.low<pos.ml):(L?x.high>=pos.ml:x.low<=pos.ml))){cl(i,pos.ml,true);ex=true}
  else if(L?x.close>=ind.sma[i]:x.close<=ind.sma[i]){cl(i,x.close,mode==='closeMaker');ex=true}
  else pos.ml=ind.sma[i]}
 if(!pos&&!pend&&!ex&&ind.atr[i]!==null){const s=M.sigMR(p,c,ind,i);if(s)pend={dir:s.dir,limit:s.dir==='long'?x.close*(1-1e-5):x.close*(1+1e-5),slPct:p.k*ind.atr[i]/x.close*100}}}
function cl(i,price,mo){const g=(price-pos.entry)/pos.entry*100*(pos.dir==='long'?1:-1);tr.push({t:c[pos.idx].openTime,net:g-(pos.makerIn?MAK:TAK)-(mo?MAK:TAK)});pos=null}
return tr}
const per=[['2019-09..2024-09 (OOS sesi lain)',Date.UTC(2019,8,30),Date.UTC(2024,8,30)],['2024-09..2026-09 (IS sesi lain)',Date.UTC(2024,8,30),Date.UTC(2026,9,1)]];
for(const mode of ['strict','closeMaker']){const tr=run(mode);for(const [nm,a,b] of per){const s=M.stats(tr.filter(t=>t.t>=a&&t.t<b),1);console.log(mode.padEnd(7),nm.padEnd(32),'n',s.n,'win',s.win.toFixed(0)+'%','PF',s.pf.toFixed(2),'NET',s.net.toFixed(1)+'%','avg',s.avgNet.toFixed(3))}
const y={};for(const t of tr){const k=new Date(t.t).getUTCFullYear();y[k]=(y[k]||0)+t.net}console.log('        per tahun',Object.entries(y).map(([a,b])=>a.slice(2)+':'+b.toFixed(0)).join(' '))}

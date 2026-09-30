const fs=require('fs'),path=require('path');const R=path.join(__dirname,'..','..')+'/';
// Riset 30 Sep 2026 (lihat BACKTEST-REGISTRY.md bagian Ninja, mean reversion searah tren untuk venue fee 0).
// Pakai: node backtest/ninja/<file>.js <dir cache candle dari NINJA_CANDLE_CACHE>
const {run}=require(R+'backtestNinjaResearch3');const {summarize}=require(R+'backtestNinjaFvg');
const dir=process.argv[2];const S=Date.UTC(2019,8,30),SP=Date.UTC(2024,8,30),E=Date.UTC(2026,8,30);
const H8=8*3600e3;const bc=(a,b)=>Math.max(0,Math.floor(b/H8)-Math.floor(a/H8));
const load=(tf,a,b)=>JSON.parse(fs.readFileSync(path.join(dir,`BTCUSDT-${tf}-${a}-${b}-v.json`)));
for(const tf of ['5m','15m']){const oos=load(tf,S,SP),is=load(tf,SP,E);const tfm=tf==='5m'?5:15;
 for(const k of [1.5,2,2.5,3,4])for(const slip of [0,0.01,0.02,0.03]){const out=[];for(const [nm,c,days] of [['IS',is,730],['OOS',oos,(SP-S)/864e5]]){const tr=run(c,{kind:'mr',trend:true,k,exit:'mean'}).map(t=>({...t,grossPct:t.grossPct-2*slip-0.01*bc(c[t.entryIdx].openTime,c[t.exitIdx].closeTime)}));const s=summarize(tr,tfm,days,0);const y={};for(const t of tr){const yy=new Date(c[t.entryIdx].closeTime).getUTCFullYear();y[yy]=(y[yy]||0)+t.grossPct}out.push(`${nm} n=${s.n} PF=${s.pfNet.toFixed(2)} NET=${s.netSumPct.toFixed(1)}% DD=${s.maxDdPct.toFixed(1)}% [${Object.entries(y).map(([a,b])=>a.slice(2)+':'+b.toFixed(0)).join(' ')}]`)}
 console.log(tf,'k='+k,'slip='+slip,out.join(' || '))}}

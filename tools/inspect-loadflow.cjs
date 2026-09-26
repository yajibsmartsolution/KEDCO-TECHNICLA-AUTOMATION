const fs = require('fs');
for (const name of ['dispatch','operator']) {
 const s=fs.readFileSync(`frontend/pages/system-operations/${name}.html`,'utf8');
 const a=JSON.parse(s.match(/const KEDCO_33KV_EFORM_ROWS = (\[.*?\]);/s)[1]);
 console.log(name, a.map((r,i)=>({...r,row:i+1})).filter(r=>/TEXTILE/.test(r.feeder)));
}
const s=fs.readFileSync('frontend/pages/mis/mis.html','utf8');
console.log(s.split('\n').find(l=>l.includes('function exportLoadFlowWorkbook'))?.slice(0,1400));

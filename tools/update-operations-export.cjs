const fs=require('fs');
for(const page of ['dispatch','operator']){
 const path=`frontend/pages/system-operations/${page}.html`;
 let s=fs.readFileSync(path,'utf8');
 s=s.replace(/<script id="kedco-33kv-textile-paste-fix-v1">[\s\S]*?<\/script>/,'');
 const marker='<!-- Shared professional operations exports and labelled row paste -->';
 if(!s.includes(marker))s+=`\n${marker}\n<script src="../../assets/exceljs-4.4.0.min.js"></script>\n<script src="../../kedco-operations-excel.js?v=20260925-1"></script>\n<script src="../../kedco-loadflow-row-paste.js?v=20260925-1"></script>\n`;
 s=s.replace('kedco-realtime-loadflow-v2.js?v=20260915-overview-reference-28','kedco-realtime-loadflow-v2.js?v=20260925-save-events-29');
 fs.writeFileSync(path,s);
}
const path='frontend/kedco-realtime-loadflow-v2.js';
let s=fs.readFileSync(path,'utf8');
s=s.replace(/document.addEventListener\("kedco:loadflow-updated",e=>\{([\s\S]*?)\n    \}\);/, '// Capture both window draft notifications and document paste notifications.\n    window.addEventListener("kedco:loadflow-updated",e=>{$1\n    },true);');
fs.writeFileSync(path,s);

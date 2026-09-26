/* Shared Operator / Dispatch workbooks. ExcelJS is bundled locally. */
(() => {
  'use strict';
  const colors = {navy:'17365D',green:'087F5B',gold:'D6A537',ink:'243746',pale:'EDF5F8'};
  const fill = argb => ({type:'pattern',pattern:'solid',fgColor:{argb}});
  const number = value => {
    const text=String(value ?? '').trim();
    return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) ? Number(text) : text;
  };
  function buildWorkbook(report) {
    const wb=new ExcelJS.Workbook();
    wb.creator='KEDCO System Operations'; wb.created=new Date();
    const ws=wb.addWorksheet(report.sheet,{properties:{tabColor:{argb:colors.green}},
      views:[{state:'frozen',ySplit:5,xSplit:report.loadflow?2:0}],
      pageSetup:{orientation:'landscape',paperSize:report.loadflow?8:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:5'}});
    const count=report.headers.length;
    ws.columns=report.widths.map(width=>({width}));
    [report.title,'KANO ELECTRICITY DISTRIBUTION COMPANY | SYSTEM OPERATIONS',report.subtitle].forEach((text,i)=>{
      ws.mergeCells(i+1,1,i+1,count); const cell=ws.getCell(i+1,1);cell.value=text;
      cell.fill=fill(i===2?colors.green:colors.navy);
      cell.font={name:'Calibri',size:i===0?20:11,bold:true,color:{argb:'FFFFFF'}};
      cell.alignment={vertical:'middle',wrapText:true};ws.getRow(i+1).height=i===0?34:26;
    });
    ws.getRow(5).values=report.headers;ws.getRow(5).height=36;
    ws.getRow(5).eachCell(cell=>{cell.fill=fill(colors.green);cell.font={name:'Calibri',bold:true,color:{argb:'FFFFFF'}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};});
    report.rows.forEach((values,i)=>{
      const row=ws.addRow(values);row.height=30;
      for(let c=1;c<=count;c++){
        const cell=row.getCell(c);cell.font={name:'Calibri',size:11,color:{argb:colors.ink}};
        cell.fill=fill(i%2?colors.pale:'FFFFFF');cell.alignment={vertical:'middle',wrapText:true,horizontal:typeof cell.value==='number'?'right':'left'};
        cell.border={bottom:{style:'hair',color:{argb:'D7E2E9'}}};
        if(typeof cell.value==='number')cell.numFmt=c===1?'0':'0.00';
        if(report.loadflow && c>=30){cell.fill=fill('FFF2CC');cell.font.bold=true;}
        if(/^(OPEN|L\/F|E\/F|O\/S|FAULT)$/.test(String(cell.value))){cell.fill=fill('FCE4D6');cell.font.color={argb:'9C0006'};}
        if(/^(RESTORED|CLOSED)$/.test(String(cell.value))){cell.fill=fill('E2F0D9');cell.font.color={argb:'006100'};}
      }
    });
    if(report.rows.length)ws.autoFilter={from:{row:5,column:1},to:{row:5+report.rows.length,column:count}};
    ws.headerFooter.oddFooter='&LKEDCO | '+report.sheet+'&RPage &P of &N';
    if(report.summary?.length){
      const summary=wb.addWorksheet('System Summary');
      summary.columns=[{width:42},...Array.from({length:24},()=>({width:12})),...Array.from({length:3},()=>({width:14}))];
      summary.addRow(['SYSTEM SUMMARY',...report.headers.slice(5,29),'Minimum','Average','Maximum']);
      report.summary.forEach(row=>summary.addRow(row));
      summary.getRow(1).eachCell(cell=>{cell.fill=fill(colors.navy);cell.font={bold:true,color:{argb:'FFFFFF'}};});
      summary.views=[{state:'frozen',xSplit:1,ySplit:1}];
    }
    const notes=wb.addWorksheet('Report Notes');notes.getColumn(1).width=110;
    [report.title,report.subtitle,'Generated: '+new Date().toLocaleString('en-GB'),
      report.loadflow?'Scope: visible feeder rows; System Summary retains the displayed system totals.':'Scope: current daily-log period and filters.',
      'Blank cells mean unavailable or not entered; zero is an actual numeric reading.',
      'Hourly readings: MW. Total energy: MWh. Load factor: percent. Operational codes remain text.',
      'Codes: L/S load shedding; L/F line fault; O/S out of service; E/F earth fault.'].forEach(text=>notes.addRow([text]));
    return wb;
  }
  function loadflowReport(form){
    if(typeof refreshKedcoLoadFlow==='function')refreshKedcoLoadFlow(form,'load33');
    const value=cell=>{const input=cell.querySelector('input');return number(input?input.value:cell.textContent);};
    const rows=[...form.querySelectorAll('tr[data-lf33-row]')].filter(row=>!row.hidden&&row.dataset.feeder).map(row=>[...row.cells].map(value));
    const date=form.elements.namedItem('lf33_date')?.value||'undated';
    return {sheet:'33 kV Load Flow',title:'33 kV FEEDERS LOAD FLOW',subtitle:'Reading date: '+date+' | Feeders: '+rows.length,
      filename:'KEDCO-33kV-Load-Flow-'+date+'.xlsx',loadflow:true,
      headers:['S/N','33 kV Feeder','Band','TCN Limit (MW)','Max Ever (MW)',...Array.from({length:24},(_,i)=>String(i+1).padStart(2,'0')+':00'),'Total (MWh)','Max Demand (MW)','Load Factor (%)'],
      widths:[7,28,9,14,14,...Array(24).fill(10),16,16,16],rows,
      summary:[...form.querySelectorAll('tr[data-lf33-summary]')].map(row=>[...row.cells].map(value))};
  }
  function dailyReport(form){
    const records=form.__dailyFilteredRows||form.__dailyRows||[];
    const date=form.querySelector('[data-daily-filter-date]')?.value||new Date().toLocaleDateString('en-CA');
    const period=form.querySelector('[data-daily-period]')?.value||'day';
    const label=typeof dailyPeriodRange==='function'?dailyPeriodRange(date,period).label:date;
    return {sheet:'Daily Operations Log',title:'DAILY OPERATIONS LOG',subtitle:label+' | Operations: '+records.length,
      filename:'KEDCO-Daily-Log-'+period+'-'+date+'.xlsx',
      headers:['S/N','Station / Source','Feeder / Apparatus','Opened','Closed / Restored','Operation / Reason','Load Lost (MW)','Elapsed Duration','Approved Duration','Downtime / Overtime','Status','Operator'],
      widths:[7,26,28,23,23,32,16,20,22,25,16,25],
      rows:records.map((r,i)=>[i+1,r.station||'',r.feeder||'',dailyFmtDate(r.opened_at),dailyFmtDate(r.closed_at),dailyOperationLabel(r.category),number(r.load_lost_mw),dailyDuration(r.opened_at,r.closed_at)||'ONGOING',dailyRequiresDuration(r.category)?dailyPlannedDurationLabel(r):'',dailyRequiresDuration(r.category)?dailyCountdownState(r).text:'',r.status==='closed'?'RESTORED':'OPEN',r.operator||''])};
  }
  async function exportForm(form,button){
    if(button?.disabled)return;
    if(button)button.disabled=true;
    try{
      if(!window.ExcelJS)throw Error('Excel export library could not load. Reload this page and try again.');
      const report=form.dataset.form==='load33'?loadflowReport(form):dailyReport(form);
      const data=await buildWorkbook(report).xlsx.writeBuffer();
      const url=URL.createObjectURL(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const a=document.createElement('a');a.href=url;a.download=report.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }catch(error){console.error(error);alert('Excel export failed: '+error.message);}finally{if(button)button.disabled=false;}
  }
  function updateButton(){
    const button=document.getElementById('exportForm'),form=document.querySelector('#formCanvas form');
    if(button){const label=['daily','load33'].includes(form?.dataset.form)?'Export Excel':'Export JSON';if(button.textContent!==label)button.textContent=label;}
    document.querySelectorAll('form[data-form="daily"] .daily-log-toolbar').forEach(bar=>{
      if(bar.querySelector('[data-daily-export]'))return;
      const b=document.createElement('button');b.type='button';b.dataset.dailyExport='';b.className='daily-export small';b.textContent='Export Excel';bar.appendChild(b);
    });
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('#exportForm,[data-daily-export]');if(!button)return;
    const form=button.closest('form')||document.querySelector('#formCanvas form');
    if(!['load33','daily'].includes(form?.dataset.form))return;
    event.preventDefault();event.stopImmediatePropagation();exportForm(form,button);
  },true);
  function start(){updateButton();new MutationObserver(updateButton).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  window.KEDCOOperationsExcel={buildWorkbook,loadflowReport,dailyReport};
})();

/* Full labelled spreadsheet rows: discard metadata, preserve all 24 readings. */
(() => {
  'use strict';
  function hoursAfterFeeder(tail){
    const values=tail.map(value=>String(value??'').trim());
    if(values.length>=27)return values.slice(3,27);
    if(values.length===25&&/^(?:A|B|C|D|E|AW)?$/i.test(values[0]))return values.slice(1,25);
    return values.slice(0,24);
  }
  lfExtract33HoursAfterFeeder=hoursAfterFeeder;
  document.addEventListener('paste',event=>{
    const input=event.target.closest?.('[data-lf33-reading]');
    const form=input?.closest('form[data-form="load33"]');
    if(!form||input.readOnly||input.disabled||form.dataset.kedcoLoadflowMode==='reference')return;
    const text=event.clipboardData?.getData('text/plain')||'';
    const lines=text.replace(/\r/g,'').split('\n').filter(line=>line.length);if(lines.length!==1||!text.includes('\t'))return;
    const cells=lines[0].split('\t');
    const row=input.closest('tr[data-lf33-row]');
    const index=cells.findIndex(cell=>lfNormFeeder(cell)===lfNormFeeder(row.dataset.feeder));
    if(index<0)return;
    event.preventDefault();event.stopImmediatePropagation();
    const values=hoursAfterFeeder(cells.slice(index+1));
    const start=values.length===24?1:Number(input.dataset.hour)||1;
    const overwrite=!!form.querySelector('[data-lf33-overwrite-blanks]')?.checked;
    let count=0;
    values.forEach((value,i)=>{
      if(!value&&!overwrite)return;
      const dest=row.querySelector('[data-lf33-reading][data-hour="'+(start+i)+'"]');
      if(dest&&lfSetPastedValue(dest,value))count++;
    });
    refreshKedcoLoadFlow(form,'load33');
    document.dispatchEvent(new CustomEvent('kedco:loadflow-updated',{detail:{formId:'load33',reason:'labelled-row-paste'}}));
    set33PasteStatus(form,'Applied '+count+' hourly readings to '+row.dataset.feeder+'. Autosave queued.','ok');
  },true);
  window.KEDCOLoadflowRowPaste={hoursAfterFeeder};
})();

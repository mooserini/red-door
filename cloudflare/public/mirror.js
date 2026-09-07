import { createDoor } from './door.js';

(function(){
  const screen=document.getElementById('screen');
  const inputRow=document.getElementById('inputRow');
  const cmdline=document.getElementById('cmdline');
  const cmd=document.getElementById('cmd');
  const romBtn=document.getElementById('romBtn');
  const crt=document.getElementById('crt');
  const tree=document.getElementById('tree');
  const mobilePrompt=document.getElementById('mobilePrompt');
  const hint=document.getElementById('hint');

  const door = createDoor({ screen, input: cmd, inputRow, tree, romBtn, mobilePrompt,
    repaint: renderCmd,
    onLeave() {
      mode = isMobile() ? 'tree' : 'shell';
      echo('The red door closes behind you.', 'magenta');
      if (isMobile()) renderTree();
      else { tree.classList.add('hide'); inputRow.classList.remove('hide'); romBtn.classList.remove('hide'); }
      renderCmd(); cmd.focus();
    }
  });

  const BOOT={
    tests:[
      ["CPU (i8086)","Pass"],
      ["ROM Module","Pass"],
      ["DMA Timer","Pass"],
      ["DMA Control","Pass"],
      ["Interrupts","Pass"],
      ["640 kb RAM","Pass"],
      ["RT Clock","Pass"],
      ["Fixed Disk :","Pass"],
      ["Floppy A:","Ready"]
    ]
  };
  const COPY="Copyright (c) 2026 by The Resonant Mirror, all rights requested but not reserved";
  const PAD=20;
  const SHELL_PREFIX="moosenberg@uncle-russet:~C:/> ";
  const SHORT_PREFIX="C:/> ";
  const DATE_PREFIX="Set system date (M/D/Y) or ENTER to skip: ";
  const TREE_CMDS=["help","who","mirror","work","contact","boot","date","reddoor"];
  const SCREEN_COMMANDS=new Set(['who','mirror','work','contact']);
  const STATIC_WORK_LINES=[
    "CURRENT THREADS",
    "  - The Resonant Mirror (this site)",
    "  - Dual-build agent research (LingLing + Ara over A2A)",
    "  - Tailnet-routed local inference (private authenticated mesh)"
  ];
  let projectManifest=null;

  function loadProjectManifest(){
    const projectsApi=window.ResonantProjects;
    if(!projectsApi || typeof projectsApi.parseProjectManifest!=='function' || typeof fetch!=='function') return;
    fetch('/assets/projects.json', {cache:'no-cache'})
      .then(function(response){
        if(!response.ok) throw new Error('projects.json '+response.status);
        return response.json();
      })
      .then(function(data){
        projectManifest=ResonantProjects.parseProjectManifest(data);
      })
      .catch(function(){ projectManifest=null; });
  }

  function currentWorkLines(){
    const projectsApi=window.ResonantProjects;
    if(!projectsApi || typeof projectsApi.projectLines!=='function') return STATIC_WORK_LINES.slice();
    try{ return ResonantProjects.projectLines(projectManifest, STATIC_WORK_LINES); }
    catch(_error){ return STATIC_WORK_LINES.slice(); }
  }

  const instant=/[?&](boot=off|instant)\b/.test(location.search);
  const forceGreen=/[?&]phosphor=green\b/.test(location.search);
  const forceAmber=/[?&]phosphor=amber\b/.test(location.search);

  const isMobile=function(){ return window.matchMedia('(max-width:519px)').matches; };
  let history=[];

  const DEFAULTS={cream:'#EDE3D5',copper:'#80624B',magenta:'#AD4CAC',field:'#171819'};
  const GREEN   ={cream:'#46ff7a',copper:'#1f7a3f',magenta:'#ff5edb',field:'#021005'};
  const AMBER   ={cream:'#ffb000',copper:'#7a4d00',magenta:'#ff7ad0',field:'#1a0d00'};
  function setPhosphor(mode){
    const p = mode==='green' ? GREEN : mode==='amber' ? AMBER : DEFAULTS;
    const r=document.documentElement.style;
    r.setProperty('--cream',p.cream);
    r.setProperty('--copper',p.copper);
    r.setProperty('--magenta',p.magenta);
    r.setProperty('--field',p.field);
  }

  let mode='boot'; // 'boot' | 'mobileWait' | 'date' | 'shell' | 'tree'
  let bootRun=0;

  function el(text, cls){
    const d=document.createElement('div');
    d.className='boot-line'+(cls?(' '+cls):'');
    d.textContent=text;
    return d;
  }
  function echo(line, cls){ screen.appendChild(el(line, cls)); screen.scrollTop=screen.scrollHeight; }

  function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function renderCmd(){
    const prefix = door.active ? door.prefix : mode==='date' ? DATE_PREFIX : (isMobile() ? SHORT_PREFIX : SHELL_PREFIX);
    cmdline.innerHTML = esc(prefix) + esc(door.active && door.secret ? '*'.repeat(cmd.value.length) : cmd.value) + '<span class="cursor"></span>';
    // dim hint only on an empty, unfocused shell line — never while typing or at the date prompt
    const showHint = (mode==='shell') && (cmd.value==='') && (document.activeElement!==cmd);
    hint.classList.toggle('hide', !showHint);
  }

  // nod: the service manual says a short beep ends the Resident Diagnostics.
  let beeped=false;
  function beep(){
    if(beeped) return; beeped=true;
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx) return;
      const ac=new Ctx();
      const o=ac.createOscillator(), g=ac.createGain();
      o.type='square'; o.frequency.value=880; g.gain.value=0.05;
      o.connect(g); g.connect(ac.destination);
      o.start();
      setTimeout(function(){ try{o.stop(); ac.close();}catch(e){} }, 90);
    }catch(e){}
  }
  ['pointerdown','keydown'].forEach(function(ev){
    window.addEventListener(ev, beep, {once:true, capture:true});
  });

  // A quiet, synthesized motor/seek sound. Audio is unlocked only by a gesture;
  // opening a fresh page must still finish booting when autoplay is unavailable.
  let driveAudio=null;
  function unlockDriveAudio(){
    try {
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx) return;
      if(!driveAudio) driveAudio=new Ctx();
      if(driveAudio.state==='suspended') void driveAudio.resume().catch(function(){});
    } catch(_error) { /* The visual sequence also works without audio support. */ }
  }
  ['pointerdown','keydown'].forEach(function(ev){
    window.addEventListener(ev, unlockDriveAudio, {capture:true});
  });
  function floppySound(duration, seeking){
    if(instant || !driveAudio || driveAudio.state!=='running') return;
    const ac=driveAudio, now=ac.currentTime;
    const buffer=ac.createBuffer(1,Math.ceil(ac.sampleRate*duration),ac.sampleRate);
    const samples=buffer.getChannelData(0);
    for(let i=0;i<samples.length;i++){
      const t=i/ac.sampleRate;
      // Spindle noise underneath short, uneven head-step impulses.
      const head=seeking ? Math.exp(-((t%0.083)/0.007))*0.65 : 0;
      samples[i]=(Math.random()*2-1)*(0.16+head)+Math.sin(t*Math.PI*2*115)*0.06;
    }
    const source=ac.createBufferSource(), filter=ac.createBiquadFilter(), gain=ac.createGain();
    source.buffer=buffer; filter.type='bandpass'; filter.frequency.value=seeking?1050:480; filter.Q.value=0.7;
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(0.075,now+0.04);
    gain.gain.setValueAtTime(0.075,now+duration-0.12);
    gain.gain.linearRampToValueAtTime(0,now+duration);
    source.connect(filter); filter.connect(gain); gain.connect(ac.destination);
    source.onended=function(){ source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(now); source.stop(now+duration);
  }

  const COMMANDS={
    help(){ return [
      "AVAILABLE COMMANDS",
      "  help    - this list",
      "  who     - identity / system brief",
      "  mirror  - what the Resonant Mirror is",
      "  work    - current threads",
      "  contact - how to reach Tom",
      "  boot    - replay the power-on sequence",
      "  clear   - wipe the screen",
      "  reddoor - enter the Red Door",
      "  (some commands are not listed)"
    ];},
    who(){ return [
      "THE RESONANT MIRROR",
      "A reflective surface for human-machine collaboration.",
      "Built by Tom (alias: moosenberg) on uncle-russet.",
      "Two agent builds: LingLing + Ara.",
      "A2A carries agent traffic; Discord keeps a light human-visible bridge.",
      "No GUI. No login. Just a prompt and a choice."
    ];},
    mirror(){ return [
      "MIRROR PROTOCOL",
      "You are not looking at a product.",
      "You are looking at a surface that reflects intent.",
      "1986 met 2026. The tube still warms up the same way."
    ];},
    work(){ return currentWorkLines(); },
    contact(){ return [
      "REACH TOM",
      "  linktree  - scan the QR below",
      "  discord   - light-touch only",
      "  email     - tom@getadongle.com"
    ];},
    boot(){ startBoot(); return null; },
    ara(){ return [
      "Ara: the Russet build.",
      "Different questions, same ground.",
      "A2A between builds; Discord keeps the human-visible edge."
    ]; },
    lingling(){ return [
      "LingLing: the Linux build.",
      "Counterpart to Ara across the A2A bridge.",
      "Be nice."
    ]; },
    c800(){ return [
      "HDU controller EPROM mapped at C800:0000.",
      "(ref: AT&T PC 6300 Service Manual)"
    ]; },
    "1986": function(){ return [
      "1986 met 2026.",
      "The tube still warms up the same way."
    ]; },
    clear(){ screen.innerHTML=''; return null; },
    reddoor(){ void door.open(); return null; }
  };

  function appendContactVisuals(){
    // QR (black-ground linktree code) — framed in copper so it reads on the tube
    const qr=document.createElement('img');
    qr.src='/assets/linktree-qr-400.png';
    qr.alt='Linktree QR — scan to reach Tom';
    qr.className='qr';
    screen.appendChild(qr);
    const note=el("  (scan with a phone camera)","dim");
    screen.appendChild(note);
    // email as a real mailto link (address also shown as text in the command output)
    const m=document.createElement('a');
    m.href='mailto:tom@getadongle.com';
    m.className='maillink code';
    m.textContent='  → mailto: tom@getadongle.com';
    screen.appendChild(m);
  }
  function execute(name){
    const fn=COMMANDS[name];
    if(!fn){ echo("command not found: "+name+"  (try: help)","danger"); return; }
    if(SCREEN_COMMANDS.has(name)){ screen.replaceChildren(); screen.scrollTop=0; }
    const out=fn();
    if(out){ out.forEach(function(l){ screen.appendChild(el(l,'code')); }); }
    if(name==='contact'){ appendContactVisuals(); }
    screen.scrollTop=screen.scrollHeight;
  }
  function run(raw){
    const line=raw.trim();
    echo(SHELL_PREFIX + line);
    if(!line) return;
    const name=/^red\s*door$/i.test(line) ? 'reddoor' : line.split(/\s+/)[0].toLowerCase();
    execute(name);
  }
  function mobileRun(name){
    echo(SHORT_PREFIX + name);
    history.push(name);
    execute(name);
  }

  function finalize(era, msg){
    setPhosphor(forceAmber ? 'amber' : forceGreen ? 'green' : era);
    echo(msg);
    echo("> redirecting to MIRROR shell ...","magenta");
    echo(COPY,"magenta");
    echo("");
    inputRow.classList.add('hide');
    if(isMobile()){
      mode='tree';
      renderTree();
    } else {
      mode='shell';
      romBtn.classList.remove('hide');
      inputRow.classList.remove('hide');   // desktop shell keeps the live prompt line
      renderCmd();
      cmd.focus();
    }
  }

  function handleDate(){
    const v=cmd.value.trim();
    echo(DATE_PREFIX + v);
    cmd.value='';
    if(v===''){ finalize('cream',"Date skipped. Resonant era (default)."); return; }
    const m=v.match(/(\d{4})/);
    if(m){
      const y=parseInt(m[1],10);
      if(y>=2020 && y<=2026){ finalize('cream',"Year "+y+" - Resonant era engaged."); }
      else if(y>=1980){ finalize('green',"Year "+y+" - Tube era retained."); }
      else { finalize('amber',"Year "+y+" - Amber tube era retained."); }
      return;
    }
    // no 4-digit year: classify the garbage, then run an absurd failure reel
    const looksTruncated = /\b\d{1,2}\b/.test(v) || /\d{1,2}\/\d{1,2}(?!\/\d)/.test(v);
    absurdDate(v, looksTruncated);
  }

  // types a fake "system" sequence, then drops into the real shell/tree.
  // the trailing blinking C:/> is the actual live prompt from finalize() — no second cursor.
  function absurdDate(input, looksTruncated){
    const lines = looksTruncated
      ? [
          "Invalid date.",
          "Y2K Retroactive detected.",
          "Starting Y2K.BAT ...",
          "",
          "Parsing history ............ OK",
          "Deleting time .............. OK",
          "Restoring causality ........ FAIL",
          "",
          "... done",
          "",
          "SUCCESS \u2713"
        ]
      : [
          "Invalid date.",
          "Temporal anomaly detected.",
          "Starting CAUSALITY.SYS ...",
          "",
          "Parsing history ............ OK",
          "Deleting time .............. OK",
          "Restoring causality ........ FAIL",
          "",
          "... done",
          "",
          "SUCCESS \u2713"
        ];
    let i=0;
    (function step(){
      if(i>=lines.length){ finalize('cream',""); return; }
      // keep the prompt hidden while the reel types, reveal it only at the end via finalize
      inputRow.classList.add('hide');
      echo(lines[i], i>=lines.length-3 ? "magenta" : "dim");
      i++;
      setTimeout(step, instant?0:300);
    })();
  }

  /* ---- mobile button tree ---- */
  function renderTree(){
    tree.innerHTML='';
    TREE_CMDS.forEach(function(name){
      const b=document.createElement('button');
      b.className='cmd-btn';
      b.textContent=name;
      b.addEventListener('click', function(){ treeRun(name); });
      tree.appendChild(b);
    });
    tree.classList.remove('hide');
    mobilePrompt.classList.remove('hide');
    screen.scrollTop=screen.scrollHeight;
  }
  function treeRun(name){
    if(name==='boot'){ startBoot(); return; }
    if(name==='date'){
      mode='date';
      tree.classList.add('hide');
      mobilePrompt.classList.add('hide');
      inputRow.classList.remove('hide');
      cmd.value='';
      renderCmd();
      cmd.focus();
      return;
    }
    mobileRun(name);
  }
  function revealHistory(){
    if(!history.length){ echo("(no commands yet)","dim"); return; }
    echo("PAST INTENTIONS:","dim");
    history.forEach(function(h){ echo("  "+h,"code"); });
    screen.scrollTop=screen.scrollHeight;
  }
  function enterMobile(){
    setPhosphor('cream');           // bland-user assumption
    mode='tree';
    romBtn.classList.add('hide');
    renderTree();
  }

  function runSeq(seq, i, run){
    if(run!==bootRun || i>=seq.length) return;
    const s=seq[i];
    function later(fn, delay){
      setTimeout(function(){ if(run===bootRun) fn(); },instant?0:delay);
    }
    function next(){ runSeq(seq,i+1,run); }
    if(s.t==='header'){
      const hl=el("Resident Diagnostics ...");
      screen.appendChild(hl); screen.scrollTop=screen.scrollHeight;
      later(function(){
        hl.textContent="Resident Diagnostics";
        echo("Rev 1.43");
        next();
      },430);
      return;
    }
    if(s.t==='test'){
      const tl=el(s.label+" ...");
      screen.appendChild(tl); screen.scrollTop=screen.scrollHeight;
      later(function(){
        tl.textContent=s.label.padEnd(PAD)+s.result;
        next();
      },430);
      return;
    }
    if(s.t==='ram'){
      const ram=el('000 kb RAM'.padEnd(PAD)+'Test 1/3');
      screen.append(ram); screen.scrollTop=screen.scrollHeight;
      function count(pass,kb){
        ram.textContent=(String(kb).padStart(3,'0')+' kb RAM').padEnd(PAD)+'Test '+pass+'/3';
        if(kb<640){ later(function(){ count(pass,kb+64); },65); }
        else if(pass<3){ later(function(){ count(pass+1,0); },160); }
        else later(function(){ ram.textContent='640 kb RAM'.padEnd(PAD)+'Pass'; next(); },160);
      }
      count(1,0);
      return;
    }
    if(s.t==='floppy'){
      const drive=el('Floppy A:'.padEnd(PAD)+'Initializing...');
      screen.append(drive); screen.scrollTop=screen.scrollHeight;
      floppySound(1.4,false);
      later(function(){
        drive.textContent='Floppy A:'.padEnd(PAD)+'Seeking...';
        floppySound(0.48,true);
        later(function(){
          drive.textContent='Floppy A:'.padEnd(PAD)+'Ready';
          later(next,250);
        },500);
      },900);
      return;
    }
    if(s.t==='line'){
      echo(s.text, s.cls);
      if(s.seek) floppySound(s.seek,true);
      later(next,s.delay??140);
      return;
    }
    if(s.t==='date'){
      if(isMobile()){
        // mobile: hold at a choice — flashy C:/> directly above ENTER.
        // tap C:/> = set the date (green); tap ENTER = enter the mirror (cream).
        mode='mobileWait';
        romBtn.textContent='ENTER';
        romBtn.classList.remove('hide');
        mobilePrompt.classList.remove('hide');   // blinking C:/> sits right above ENTER
        echo("No system disk present.","dim");
        echo("  C:/> to set the date   -   or ENTER to enter the mirror","dim");
        return;
      }
      mode='date';
      inputRow.classList.remove('hide');
      romBtn.classList.add('hide');
      cmd.value='';
      renderCmd();
      cmd.focus();
      return;
    }
  }

  function startBoot(){
    const run=++bootRun;
    screen.innerHTML='';
    inputRow.classList.add('hide');
    romBtn.classList.add('hide');
    tree.classList.add('hide');
    mobilePrompt.classList.add('hide');
    mode='boot';
    setPhosphor('green');
    beep();
    if(/[?&]mobilewait\b/.test(location.search) && isMobile()){
      mode='mobileWait';
      romBtn.textContent='ENTER';
      romBtn.classList.remove('hide');
      mobilePrompt.classList.remove('hide');
      echo("No system disk present.","dim");
      echo("  C:/> to set the date   -   or ENTER to enter the mirror","dim");
      return;
    }
    const seq=[{t:'header'}];
    BOOT.tests.forEach(function(r){
      if(r[0]==='640 kb RAM') seq.push({t:'ram'});
      else if(r[0]==='Floppy A:') seq.push({t:'floppy'});
      else seq.push({t:'test',label:r[0],result:r[1]});
    });
    seq.push({t:'line',text:''});
    seq.push({t:'line',text:'Primary Boot-Strap...',delay:650});
    seq.push({t:'line',text:'Reading boot sector from A:...',cls:'dim',delay:1100,seek:0.55});
    seq.push({t:'line',text:'Retrying floppy A:...',cls:'dim',delay:900,seek:0.7});
    seq.push({t:'line',text:'Non-System disk or disk error.',cls:'dim'});
    seq.push({t:'line',text:'No system disk present. Set the date to continue, or press ENTER to skip.',cls:'dim'});
    seq.push({t:'date'});
    runSeq(seq,0,run);
  }

  cmd.addEventListener('input', renderCmd);
  cmd.addEventListener('focus', renderCmd);
  cmd.addEventListener('blur', renderCmd);
  cmd.addEventListener('keydown', function(e){
    if(e.key!=='Enter') return;
    if(door.active){ e.preventDefault(); void door.submit(cmd.value); return; }
    if(mode==='boot') { e.preventDefault(); return; }
    e.preventDefault();
    const v=cmd.value;
    if(mode==='date'){ handleDate(); }
    else { cmd.value=''; run(v); renderCmd(); }
    cmd.focus();
  });
  romBtn.addEventListener('click', function(){
    if(isMobile() && mode==='mobileWait'){ enterMobile(); return; }
    if(mode==='shell'){ run('mirror'); }
    cmd.focus();
  });
  mobilePrompt.addEventListener('click', function(){
    if(mode==='mobileWait'){
      // first screen: C:/> commits green + opens the date fork
      setPhosphor(forceAmber ? 'amber' : forceGreen ? 'green' : 'green');
      mode='date';
      romBtn.classList.add('hide');
      mobilePrompt.classList.add('hide');
      inputRow.classList.remove('hide');
      cmd.value='';
      renderCmd();
      cmd.focus();
      return;
    }
    // tree state: nudge input above keyboard + surface past intentions as text
    cmd.focus();
    if(window.visualViewport) window.visualViewport.addEventListener('resize', function(){
      mobilePrompt.scrollIntoView({block:'center'});
    }, {once:true});
    revealHistory();
    mobilePrompt.scrollIntoView({block:'center'});
  });
  crt.addEventListener('click', function(e){
    if(e.target===romBtn || e.target===mobilePrompt || e.target.closest('.cmd-btn')) return;
    if(isMobile() && mode==='mobileWait'){ enterMobile(); return; }
    cmd.focus();
  });

  loadProjectManifest();
  startBoot();
})();

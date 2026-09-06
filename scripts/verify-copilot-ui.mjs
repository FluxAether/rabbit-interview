// Local browser fixture for the real Copilot UI. No recording, model calls or persisted settings.
// Run: rtk proxy node scripts/verify-copilot-ui.mjs
import { createServer, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const resultPath = path.resolve('docs/audits/2026-09-05-stealth-assistant/ui-check-latest.json')
const mocks = {
  copilotSession: `export const sendCopilotCommand = async () => {}; export const exportCopilotRecording = async () => false;`,
  settingsStore: `let settings = { copilotFontSize: 'base', copilotShowMyBubbles: true, useSystemAudio: true, useMicWithSystem: true, micDevice: 'Test microphone' }; export const loadAppSettings = async () => settings; export const saveAppSettings = async (next) => { settings = { ...settings, ...next }; };`,
  copilotWindow: `const status = { visible: true, protection_applied: true, protection_requested: true, platform_supported: true, request_dispatched: true, error: null }; export const getCopilotWindowStatus = async () => status; export const showCopilotWindow = async () => status; export const setCopilotWindowOpacity = async () => {}; export const subscribeCopilotWindowStatus = async () => () => {};`,
  core: `export const invoke = async (command) => command === 'list_audio_devices' ? ['Test microphone'] : { system_audio_available: true, microphone_available: true, audiotee_commit: 'test-fixture', sample_rate: 16000 };`,
  window: `export const getCurrentWindow = () => ({ startDragging: async () => {} });`,
}
const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import StealthCopilot from '/src/pages/StealthCopilot.tsx';
import CopilotPanel from '/src/components/CopilotPanel.tsx';
import { useAppStore } from '/src/stores/useAppStore.ts';
import { createInitialSnapshot, reduceCopilotSnapshot } from '/src/lib/copilotSessionState.ts';
import '/src/index.css';
globalThis.__copilotRowRenders = 0;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const seed = (count) => {
  const messages = Array.from({length:count}, (_, i) => ({id:i+1, role:i%2?'assistant':'interviewer', source:i%2?'llm':'system-stt', createdAt:Date.now()+i, text:i%2 ? '先明确需求边界，再说明方案与取舍，最后给出验证结果。'.repeat(14) : '问题 '+(i/2+1)+'：请说明你的实施方案。', ...(i%2?{replyToId:i}:{})}));
  useAppStore.setState({copilot:{...createInitialSnapshot(),phase:'listening',sessionId:1,startedAt:Date.now()-600000,messages,question:messages.at(-2).text}});
};
seed(80);
const apply = (action) => useAppStore.setState(({copilot}) => ({copilot:reduceCopilotSnapshot(copilot,{...action,sessionId:1})}));
function Check() {
  const [result, setResult] = useState('Ready');
  const [floating,setFloating] = useState(false);
  const [hidden,setHidden] = useState(false);
  const run = async () => {
    setResult('Running'); await wait(800);
    const before = globalThis.__copilotRowRenders;
    for (let i=0;i<20;i++) { apply({type:'amplitude',amplitude:i%2?0.2:0.6}); await wait(50); }
    const rows = document.querySelectorAll('article').length;
    const audioRowRenders = globalThis.__copilotRowRenders-before;
    const data = {view:floating?'floating':'main',totalMessages:useAppStore.getState().copilot.messages.length,mountedRows:rows,audioRowRenders,pass:audioRowRenders===0&&rows<60};
    setResult(JSON.stringify(data));
    await fetch('/__copilot-result',{method:'POST',body:JSON.stringify(data)});
  };
  useEffect(()=>{void run()},[]);
  const append = () => {
    const id = useAppStore.getState().copilot.messages.length+1;
    apply({type:'message',message:{id,role:'interviewer',source:'system-stt',createdAt:Date.now(),text:'新增问题 '+id+'：请补充验证结果。'}});
  };
  const stream = async (replyToId) => {
    const q = useAppStore.getState().copilot.messages.findLast(m=>m.role==='interviewer' && (replyToId == null || m.id === replyToId));
    for(let i=1;i<=30;i++){apply({type:'stream-answer',suggestion:{id:90000 + q.id,text:'回答增量。'.repeat(i*3),category:'AI'},replyToId:q.id}); await wait(40);}
    apply({type:'complete-answer',answerId:90000 + q.id,answer:'回答增量。'.repeat(90),suggestions:[],replyToId:q.id});
  };

  const scrolling = async (scrollDown = false) => {
    setResult('Checking scrolling');
    const checks = {}; const measurements = {};
    const scroller = () => document.querySelector('[data-virtuoso-scroller]');
    const distance = () => {const el=scroller(); return el.scrollHeight-el.scrollTop-el.clientHeight;};
    const anchor = () => {
      const viewport = scroller().getBoundingClientRect();
      const row = [...document.querySelectorAll('[data-message-id]')].find(el => {const rect=el.getBoundingClientRect(); return rect.bottom>viewport.top && rect.top<viewport.bottom;});
      return row ? {id:row.dataset.messageId, top:row.getBoundingClientRect().top-viewport.top} : null;
    };
    const stable = (before) => {
      const el = document.querySelector('[data-message-id="'+before?.id+'"]');
      return Boolean(el && Math.abs(el.getBoundingClientRect().top-scroller().getBoundingClientRect().top-before.top)<=2);
    };
    const jump = () => [...document.querySelectorAll('button')].find(el=>el.title.includes('自动跟随'));
    seed(1000); await wait(600);
    checks.initialBottom = distance()<=25;
    checks.virtualRows = document.querySelectorAll('article').length<60;
    scroller().scrollTop -= 3600; await wait(350);
    if (scrollDown) { scroller().scrollTop += 400; await wait(350); }
    const before = anchor();
    checks.historyButton = jump()?.textContent.includes('回到最新') ?? false;
    append(); await wait(250);
    checks.appendKeepsAnchor = stable(before);
    checks.unreadQuestion = jump()?.textContent.includes('1 条新消息') ?? false;
    await stream(); await wait(300);
    checks.streamKeepsAnchor = stable(before);
    checks.unreadCountsMessages = jump()?.textContent.includes('2 条新消息') ?? false;
    apply({type:'message',message:{id:950000,role:'me',source:'microphone-stt',createdAt:Date.now(),text:'我的补充回答。'}}); await wait(150);
    document.querySelector('button[role="switch"]')?.click(); await wait(250);
    checks.hiddenUserNotUnread = jump()?.textContent.includes('2 条新消息') ?? false;
    document.querySelector('button[role="switch"]')?.click(); await wait(250);
    // A late answer grows a previously measured group above the reader.
    const above = [...scroller().querySelectorAll('[data-item-index]')].filter(el=>el.getBoundingClientRect().bottom<=scroller().getBoundingClientRect().top).at(-1);
    const earlier = above ? Number(above.querySelector('[data-message-id]').dataset.messageId) : Number(before.id) - (Number(before.id)%2===0 ? 5 : 4);
    measurements.earlierQuestion = earlier;
    measurements.earlierBottom = above?.getBoundingClientRect().bottom-scroller().getBoundingClientRect().top;
    await stream(earlier); await wait(300);
    checks.lateAnswerKeepsAnchor = stable(before);
    const anchored = document.querySelector('[data-message-id="'+before.id+'"]');
    measurements.lateAnchor = {before,after:anchored ? anchored.getBoundingClientRect().top-scroller().getBoundingClientRect().top : null};
    jump()?.click(); await wait(450);
    checks.jumpReachesBottom = distance()<=25 && !jump();
    append(); await wait(300);
    checks.appendFollowsBottom = distance()<=25;
    await stream(); await wait(300);
    checks.streamFollowsBottom = distance()<=25;
    const lastAnswer = [...document.querySelectorAll('[data-message-id]')].at(-1);
    const expand = lastAnswer?.querySelector('button[aria-expanded]');
    expand?.click(); await wait(250);
    checks.expandsFullAnswer = expand?.getAttribute('aria-expanded')==='true' && lastAnswer.textContent.includes('回答增量。'.repeat(90));
    scroller().scrollTop -= 3000; await wait(250); jump()?.click(); await wait(300);
    checks.expansionSurvivesVirtualization = document.querySelector('[data-message-id="'+lastAnswer?.dataset.messageId+'"] button[aria-expanded]')?.getAttribute('aria-expanded')==='true';
    document.querySelector('button[aria-label="缩小字体"]')?.click(); await wait(250);
    document.querySelector('button[aria-label="放大字体"]')?.click(); await wait(300);
    checks.fontResizeFollowsBottom = distance()<=25;
    scroller().scrollTop=0; await wait(450);
    checks.oldestMessageAvailable = Boolean(document.querySelector('[data-message-id="1"]'));
    const data={view:floating?'floating':'main',scrollDown,totalMessages:useAppStore.getState().copilot.messages.length,mountedRows:document.querySelectorAll('article').length,checks,measurements,pass:Object.values(checks).every(Boolean)};
    setResult(JSON.stringify(data)); await fetch('/__copilot-result',{method:'POST',body:JSON.stringify(data)});
  };
  const checkHidden = async () => {
    setResult('Checking hidden floating list'); setFloating(true); seed(80); await wait(600);
    setHidden(true); await wait(200);
    const before=globalThis.__copilotRowRenders;
    append(); await stream(); await wait(250);
    const hiddenRowRenders=globalThis.__copilotRowRenders-before;
    const lastId=useAppStore.getState().copilot.messages.at(-1).id;
    setHidden(false); await wait(600);
    const checks={hiddenListDoesNotRender:hiddenRowRenders===0,latestAnswerVisibleOnReturn:Boolean(document.querySelector('[data-message-id="'+lastId+'"]'))};
    const data={view:'floating',kind:'hidden',hiddenRowRenders,checks,pass:Object.values(checks).every(Boolean)};
    setResult(JSON.stringify(data)); await fetch('/__copilot-result',{method:'POST',body:JSON.stringify(data)});
  };
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
    <div style={{padding:8,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid #ddd'}}>
      <button onClick={run}>Run checks</button><button onClick={()=>seed(1000)}>Load 1000</button><button onClick={append}>Append message</button><button onClick={()=>stream()}>Stream answer</button><button onClick={()=>scrolling()}>Run scrolling checks</button><button onClick={()=>scrolling(true)}>Check reading downward</button><button onClick={()=>setFloating(!floating)}>Toggle floating</button><button onClick={checkHidden}>Check hidden floating</button><output aria-label="Check result">{result}</output>
    </div>
    <div style={{minHeight:0,flex:1}}>{floating?<div style={{height:'100%',visibility:hidden?'hidden':'visible'}}><CopilotPanel floating windowStatus={{visible:!hidden,protection_applied:true,protection_requested:true,platform_supported:true,request_dispatched:true,error:null}}/></div>:<StealthCopilot/>}</div>
  </div>;
}
createRoot(document.getElementById('root')).render(<Check/>);
`
const server = await createServer({
  configFile: false,
  plugins: [{
    name: 'copilot-ui-check', enforce: 'pre',
    resolveId(id, importer) {
      if (id === '/__copilot-check.tsx') return '\0copilot-check.tsx'
      if (!importer?.includes('/src/components/') && !importer?.includes('/src/pages/')) return
      const name = id.match(/(?:lib\/|@tauri-apps\/api\/)(\w+)$/)?.[1]
      if (name && mocks[name]) return '\0copilot-check-' + name
    },
    async load(id) {
      if (id === '\0copilot-check.tsx') return (await transformWithEsbuild(entry, 'copilot-check.tsx', { loader: 'tsx', jsx: 'automatic' })).code
      return mocks[id.replace('\0copilot-check-', '')]
    },
    transform(code, id) {
      if (id.includes('/src/components/Copilot')) return code.replace('const mine = message.role === "me"', 'globalThis.__copilotRowRenders = (globalThis.__copilotRowRenders || 0) + 1; const mine = message.role === "me"')
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/__copilot-result' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) body += chunk
          const data = JSON.parse(body)
          const output = JSON.stringify(data, null, 2) + '\n'
          await mkdir(path.dirname(resultPath), { recursive: true })
          const name = data.checks ? 'ui-check-' + data.view + '-' + (data.kind || (data.scrollDown ? 'down' : 'up')) : 'ui-check-audio-' + data.view + '-' + data.totalMessages
          await writeFile(resultPath, output)
          await writeFile(path.join(path.dirname(resultPath), name + '.json'), output)
          res.end('ok'); return
        }
        if (req.url !== '/') return next()
        res.setHeader('Content-Type','text/html')
        res.end(await server.transformIndexHtml('/', '<html><head><title>Copilot UI check</title></head><body><div id="root"></div><script type="module" src="/__copilot-check.tsx"></script></body></html>'))
      })
    },
  }, react()],
  server: { host: '127.0.0.1', port: 1435, strictPort: true },
})
await server.listen()
console.log('Copilot UI check: http://127.0.0.1:1435 — results: ' + resultPath)

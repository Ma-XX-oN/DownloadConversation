import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const network = read('src/userscript/03-agent-lifecycle/08-generation-request.js') +
  read('src/userscript/03-agent-lifecycle/09-network-install-api-transition.js');
const trace = read('src/userscript/02-network-communication/02-stock-network-responses.js');
function source() {
  const start = network.indexOf('      pageWindow.fetch = function(...args) {');
  const end = network.indexOf('\n    }\n\n    // Retain the page-realm XHR constructor',start);
  assert(start >= 0 && end > start);
  const close = network.lastIndexOf('\n      };',end);
  assert(close > start);
  const observerStart = trace.indexOf('  function stockNetworkTraceFetchResponse(');
  const observerEnd = trace.indexOf('\n  // END Issue #123 stock network diagnostics',observerStart);
  assert(observerStart >= 0 && observerEnd > observerStart);
  return trace.slice(observerStart,observerEnd) + '\n' +
    network.slice(start,close+'\n      };'.length);
}

const adapterSource = read('src/userscript/01-runtime/04-native-receipt-adapter.js');
const pinnedProducer = read('vendor/cgp2/receipt-observation.js')
  .replace(/^export (?=(?:const|function) \w+)/gm, '');
const producerPrelude = 'const nativeReceiptProducerV1 = (() => {\n' +
  pinnedProducer + '\nreturn {createChatGPTReceiptIngress};\n})();\n';
const executeNative = (code, context) => {
  context.crypto = { randomUUID:()=> 'test-page-1' };
  return vm.runInNewContext(producerPrelude + adapterSource + '\n' + code, context);
};

class FakeRequest {
  constructor(url, init = {}) {
    this.url=String(url); this.method=init.method ?? 'GET';
    this.headers={get:()=>null};
  }
}
test('native incoming non-200 unrelated fetch reaches producer heartbeat',async()=>{
  const events=[],diagnostics=[];
  const response={status:503,ok:false,url:'https://chatgpt.com/api/unrelated-poll',
    headers:{get:()=>null},clone:()=>({body:null})};
  const pageWindow={Request:FakeRequest,fetch:null};
  const context={
    pageWindow,Request:FakeRequest,originalFetch:async()=>response,
    performance:{now:()=>1000},
    stockNetworkTraceFetchStart:()=>({sequence:1,started_at:0,method:'GET',
      url:response.url,same_origin:false}),
    communicationLogFetchRequest:async()=>{},
    communicationLogFetchResponse:async()=>{},
    rememberApiRequestContext(){},recordClickDiagnosticNetworkRequest(){},
    agentTerminalObserveStatsRequest(){},
    isGenerationStreamUrl:()=>false,isConversationResumeUrl:()=>false,
    isSteerTurnUrl:()=>false,agentStopwatchIsInitialConversationUrl:()=>false,
    agentFaviconObserveProcessing(){},agentStopwatchObserveSteerTurn(){},
    captureGenerationStreamRequest:()=>null,
    cloneSafely:x=>x.clone(),logDiagnostic:(...x)=>diagnostics.push(x),
    boundedDiagnosticText:String,errorMessage:e=>String(e),
    stockNetworkSafeUrl:x=>x,stockNetworkSafeResponseHeaders:()=>({}),
    stockNetworkInspectFetchBody:async()=>{},
    chatGPTAgent:{commTraffic:x=>events.push(x)}
  };
  executeNative(source(),context);
  assert.equal(await pageWindow.fetch(response.url,{method:'GET'}),response);
  assert(diagnostics.some(x=>x[1]==='stock-network-fetch-response'),
    'Real production stock response observer must run');
  assert(events.some(x=>x?.type==='server_receipt'),
    'Every observed incoming response, including unrelated HTTP 503, must reach CGP2');
});

test('native parsed incoming JSON reaches provider JSON-entry heartbeat', async () => {
  const identitySource = read('src/userscript/02-network-communication/01-stock-network-identities.js');
  const marker = '  async function stockNetworkInspectFetchBody(response, trace) {';
  const start = identitySource.indexOf(marker);
  assert(start >= 0, 'Production native JSON-response observer must exist');
  const observer = identitySource.slice(start);
  const events = [];
  const diagnostics = [];
  const context = {
    stockNetworkReadBoundedText: async () => ({
      text: '{"message":{"id":"server-message","author":{"role":"assistant"}}}',
      byte_count: 65, truncated: false
    }),
    stockNetworkBodyIdentity: () => ({
      json_identity: { message_ids: ['server-message'] }
    }),
    boundedDiagnosticText: String,
    logDiagnostic: (...args) => diagnostics.push(args),
    errorMessage: error => String(error?.message ?? error),
    chatGPTAgent: { commTraffic: value => events.push(value) }
  };
  executeNative(observer + '\n globalThis.inspect = stockNetworkInspectFetchBody;', context);
  await context.inspect({
    headers: { get: () => 'application/json' }
  }, { network_sequence: 19, url: 'https://chatgpt.com/backend-api/conversation',
    incoming_received_epoch_ms: Date.now() - 10 });
  assert(diagnostics.some(event => event[1] === 'stock-network-fetch-body-summary'),
    'Production body observer must parse and classify incoming JSON');
  assert(events.some(event => event?.type === 'received_json_entry'),
    'Each incoming parsed JSON entry must reach CGP2 independently of persisted records');
});

test('native bounded body reader reports two distinct inbound chunks', async () => {
  const identity = read('src/userscript/02-network-communication/01-stock-network-identities.js');
  const start = identity.indexOf('  async function stockNetworkReadBoundedText(response) {');
  const end = identity.indexOf('  async function stockNetworkInspectFetchBody(response, trace) {', start);
  assert(start >= 0 && end > start, 'Production reader must be present');
  const events=[];
  const source = identity.slice(start,end);
  const context = {
    chatGPTAgent:{commTraffic:e=>events.push(e)},
    TextDecoder,
    Date,
    STOCK_NETWORK_JSON_BYTE_LIMIT: 1048576,
    releaseReaderLockQuietly(){}
  };
  executeNative(source + '\n globalThis.readBody = stockNetworkReadBoundedText;',context);
  const chunks=[new Uint8Array([65]),new Uint8Array([66])];
  let index=0;
  const result=await context.readBody({body:{getReader:()=>({
    read:async()=>index<chunks.length
      ? {done:false,value:chunks[index++]} : {done:true},
    releaseLock(){}
  })}});
  assert.equal(result.text,'AB');
  assert.equal(events.length,2,'Every observed incoming chunk must publish metadata');
  assert(events.every(e=>e?.type==='server_receipt' &&
    e.receipt?.transport==='fetch' && e.receipt?.phase==='body_chunk'));
});

test('existing unbounded generation/resume stream consumer publishes after diagnostic cap', async () => {
  const source = read('src/userscript/03-agent-lifecycle/08-generation-request.js');
  const start = source.indexOf('  async function consumeObservedConversationStreamResponse(');
  const end = source.indexOf('  async function captureGenerationStreamResponse(',start);
  assert(start >= 0 && end > start, 'Production generation consumer must exist');
  const body = source.slice(start,end);
  const events = [];
  const logs = [];
  const context = {
    chatGPTAgent: { commTraffic: e => events.push(e) },
    TextDecoder, Date,
    consumeStreamTailSseChunk(){},
    streamTailPersistCapture(){},
    logDiagnostic:(...args)=>logs.push(args),
    releaseReaderLockQuietly(){},
    errorMessage:String
  };
  executeNative(body+'\n globalThis.consume=consumeObservedConversationStreamResponse;',context);
  const chunk = new Uint8Array(600*1024);
  let i=0;
  const capture = {conversation_id:'c1',stream_messages:[],handed_off:false,
    handoff_topic_id:null,complete:false};
  const response = {body:{getReader:()=>({
    read:async()=>i++<3 ? {done:false,value:chunk} : {done:true},
    releaseLock(){}
  })}};
  await context.consume(response,capture,{persistCapture:false,source:'generation'});
  assert.equal(events.length,3,
    'Each observed stream chunk, including bytes after 1 MiB, must count as incoming');
  assert(events.every(x=>x?.type==='server_receipt' &&
    x.receipt?.phase==='body_chunk' && x.receipt?.transport==='fetch'));
  assert(logs.some(x=>x[1]==='conversation-stream-response-observed'));
});

test('late registered agent replays only newest original-time inbound metadata', () => {
  const originalTime = Date.now() - 60000;
  const events = [];
  const context = {
    chatGPTAgent: null,
    Date,
    logDiagnostic() {}
  };
  executeNative(
    'globalThis.capture = nativeReceiptCapture;\n' +
    'globalThis.captureJson = nativeJsonEntryCapture;\n' +
    'globalThis.flush = nativeReceiptFlush;', context);
  context.capture({transport:'fetch',direction:'response',status:503,
    captured_at_epoch_ms:originalTime});
  context.capture({transport:'fetch',direction:'request',
    captured_at_epoch_ms:originalTime + 10});
  context.capture({transport:'websocket',direction:'incoming',
    captured_at_epoch_ms:originalTime + 100});
  assert.equal(context.captureJson({incoming_received_epoch_ms:originalTime + 200}),true);
  assert.equal(context.flush(),false);
  context.chatGPTAgent = {commTraffic:event=>events.push(event)};
  assert.equal(context.flush(),true);
  assert.equal(events.length,2,'A bounded source-time buffer must retain latest metadata');
  assert.equal(events[0].type,'server_receipt');
  assert.equal(events[0].receipt.phase,'frame');
  assert.equal(events[0].receipt.timestamp_ms,originalTime + 100);
  assert.equal(events[1].type,'received_json_entry');
  assert.equal(events[1].timestamp_ms,originalTime + 200);
  assert.equal(context.flush(),true);
  assert.equal(events.length,2,'Flushing twice must not replay old activity');
});

test('native WebSocket wrapper counts incoming and not outgoing frames', () => {
  const src=read('src/userscript/03-agent-lifecycle/09-network-install-api-transition.js');
  const start=src.indexOf("    if (typeof pageWindow.WebSocket === 'function')");
  const end=src.indexOf("    if (typeof pageWindow.open === 'function')",start);
  assert(start>=0 && end>start,'Production native WebSocket hook must exist');
  class Socket {
    constructor(){this.events={};this.sent=[];}
    addEventListener(name,fn){this.events[name]=fn;}
    send(payload){this.sent.push(payload);return 'sent';}
  }
  const events=[];
  const context={
    pageWindow:{WebSocket:Socket},
    chatGPTAgent:{commTraffic:x=>events.push(x)},
    Date,
    Reflect,
    Proxy,
    communicationLogWebSocketSend:async()=>{},
    communicationLogWebSocketMessage:async()=>{},
    communicationLogReportFailure(){},
    communicationLogRecord:async()=>{},
    stockNetworkSafeUrl:String,
    captureGenerationWebSocketFrame(){}
  };
  executeNative(src.slice(start,end),context);
  const socket=new context.pageWindow.WebSocket('wss://chatgpt.com/ws');
  assert.equal(socket.send('outgoing'),'sent');
  assert.deepEqual(socket.sent,['outgoing']);
  assert.equal(events.length,0,'Outgoing frame must not refresh Last');
  socket.events.message({data:'incoming'});
  assert.equal(events.length,1,'Incoming frame must generate one receipt');
  assert.equal(events[0].type,'server_receipt');
  assert.equal(events[0].receipt.phase,'frame');
  assert.equal(events[0].receipt.transport,'websocket');
});

test('generation fetch captures receipt before native response clone', async () => {
  const steps=[],events=[];
  const response={status:503,url:'https://chatgpt.com/backend-api/f/conversation',
    headers:{get:()=>null},
    clone(){steps.push('clone');return {body:null};}};
  const pageWindow={Request:FakeRequest,fetch:null};
  const context={
    pageWindow,Request:FakeRequest,originalFetch:async()=>response,
    performance:{now:()=>1000},
    stockNetworkTraceFetchStart:()=>({sequence:1,started_at:1000,
      method:'POST',url:response.url,same_origin:true}),
    communicationLogFetchRequest:async()=>{},
    communicationLogFetchResponse:async()=>{},
    rememberApiRequestContext(){},recordClickDiagnosticNetworkRequest(){},
    agentTerminalObserveStatsRequest(){},
    isGenerationStreamUrl:()=>true,isConversationResumeUrl:()=>false,
    isSteerTurnUrl:()=>false,agentStopwatchIsInitialConversationUrl:()=>false,
    agentFaviconObserveProcessing(){},agentStopwatchObserveSteerTurn(){},
    captureGenerationStreamRequest:()=>Promise.resolve({id:'capture'}),
    captureGenerationStreamResponse:async()=>{},
    cloneSafely:x=>x.clone(),logDiagnostic(){},
    boundedDiagnosticText:String,errorMessage:String,
    stockNetworkSafeUrl:x=>x,stockNetworkSafeResponseHeaders:()=>({}),
    stockNetworkInspectFetchBody:async()=>{},
    chatGPTAgent:{commTraffic:e=>{events.push(e);steps.push('receipt');}}
  };
  executeNative(source(),context);
  assert.equal(await pageWindow.fetch(response.url,{method:'POST'}),response);
  assert(steps.includes('clone'),'Generation response clone must still run');
  assert.equal(steps[0],'receipt',
    'CGP2 source-owned receipt must observe incoming before any body clone');
  assert.equal(events.filter(e=>e?.type==='server_receipt').length,1,
    'Early capture and later stock diagnostics must not double-count response');
});

test('XHR abort status zero cannot fabricate server activity', () => {
  const src=read('src/userscript/03-agent-lifecycle/09-network-install-api-transition.js');
  const start=src.indexOf('    const XHR = pageWindow.XMLHttpRequest;');
  const end=src.indexOf("    if (typeof pageWindow.WebSocket === 'function')",start);
  assert(start >= 0 && end > start);
  class FakeXHR {
    constructor(){this.handlers={};this.status=0;}
    open(){return 'opened';}
    setRequestHeader(){}
    send(){return 'sent';}
    addEventListener(name,fn){this.handlers[name]=fn;}
  }
  const events=[];
  const ctx={
    pageWindow:{XMLHttpRequest:FakeXHR},
    chatGPTAgent:{commTraffic:e=>events.push(e)},
    Date,performance:{now:()=>500},
    stockNetworkTraceXhrStart:()=>({sequence:1,started_at:1}),
    stockNetworkTraceXhrResponse(){},
    communicationLogXhrRequest:async()=>{},
    communicationLogXhrResponse:async()=>{},
    rememberApiRequestContext(){},recordClickDiagnosticNetworkRequest(){},
    communicationLogReportFailure(){},logDiagnostic(){}
  };
  executeNative(src.slice(start,end),ctx);
  const failed=new ctx.pageWindow.XMLHttpRequest();
  failed.open('GET','/backend-api/x');
  assert.equal(failed.send(),'sent');
  failed.handlers.loadend();
  assert.equal(events.length,0,'No server response occurred for status 0');
  const real=new ctx.pageWindow.XMLHttpRequest();
  real.status=503;
  real.open('GET','/backend-api/x');
  real.send();
  real.handlers.loadend();
  assert.equal(events.length,1,'HTTP 503 remains an inbound receipt');
  assert.equal(events[0].receipt.phase,'server_error');
});

test('failing registered agent does not drop original-time receipt before rebind', () => {
  const firstTimestamp=Date.now()-30000;
  const events=[],logs=[];
  const context={
    chatGPTAgent:{commTraffic(){throw new Error('disposed during replacement');}},
    Date,logDiagnostic:(...x)=>logs.push(x)
  };
  executeNative('globalThis.capture=nativeReceiptCapture;\n'+
    'globalThis.flush=nativeReceiptFlush;',context);
  context.capture({transport:'fetch',direction:'response',status:503,
    captured_at_epoch_ms:firstTimestamp});
  assert(logs.some(x=>x[1]==='last-native-ingress-delivery-failed'),
    'Failure should be logged without throwing into native page');
  context.chatGPTAgent={commTraffic:x=>events.push(x)};
  assert.equal(context.flush(),true);
  assert.equal(events.length,1,'Source receipt must survive failed first agent');
  assert.equal(events[0].receipt.timestamp_ms,firstTimestamp);
  assert.equal(context.flush(),true);
  assert.equal(events.length,1,'Later bindings must not replay duplicate receipt');
});

test('unrelated fetch stream keeps receipts beyond 1 MiB without payload retention', async () => {
  const identity=read('src/userscript/02-network-communication/01-stock-network-identities.js');
  const begin=identity.indexOf('  async function stockNetworkReadBoundedText(response) {');
  const end=identity.indexOf('  async function stockNetworkInspectFetchBody(response, trace) {',begin);
  assert(begin>=0 && end>begin);
  const events=[];
  let reads=0, cancelCount=0;
  const context={
    chatGPTAgent:{commTraffic:e=>events.push(e)},
    TextDecoder,Date,STOCK_NETWORK_JSON_BYTE_LIMIT:1024*1024,
    releaseReaderLockQuietly(){}
  };
  executeNative(identity.slice(begin,end)+
    '\n globalThis.readBody=stockNetworkReadBoundedText;',context);
  const response={body:{getReader:()=>({
    read:async()=>++reads<=4
      ? {done:false,value:new Uint8Array(600*1024).fill(65)}
      : {done:true},
    cancel:async()=>{cancelCount++},
    releaseLock(){}
  })}};
  const result=await context.readBody(response);
  assert.equal(result.byte_count,1024*1024,'Diagnostic storage must remain bounded');
  assert.equal(result.text.length,1024*1024);
  assert.equal(result.truncated,true);
  assert.equal(cancelCount,0,'Observed clone must not cancel after 1MiB');
  assert.equal(reads,5,'Continue observing all four chunks to stream end');
  assert.equal(events.length,4,'Every incoming chunk must reach CGP2');
});

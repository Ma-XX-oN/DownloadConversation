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
  vm.runInNewContext(source(),context);
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
  vm.runInNewContext(observer + '\n globalThis.inspect = stockNetworkInspectFetchBody;', context);
  await context.inspect({
    headers: { get: () => 'application/json' }
  }, { network_sequence: 19, url: 'https://chatgpt.com/backend-api/conversation' });
  assert(diagnostics.some(event => event[1] === 'stock-network-fetch-body-summary'),
    'Production body observer must parse and classify incoming JSON');
  assert(events.some(event => event?.type === 'received_json_entry'),
    'Each incoming parsed JSON entry must reach CGP2 independently of persisted records');
});

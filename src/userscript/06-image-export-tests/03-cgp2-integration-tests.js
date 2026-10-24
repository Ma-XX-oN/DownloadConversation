  /**
   * CGP2 browser integration checks run against the actual installed classic
   * plugin while keeping synthetic mutations isolated from the live session.
   */
  /**
   * Verifies the isolated testCGP2InstalledInterface CGP2 browser integration contract.
   * @returns {void} Completes after fixture verification.
   */
  function testCGP2InstalledInterface() {
    const plugin = globalThis.ChatGPTWebAgentPlugin;
    assert(plugin?.id === 'chatgpt-web' && plugin.apiVersion === 1,
      'Private CGP2 classic plugin is missing or has the wrong API.');
    assert(typeof plugin.create === 'function' && typeof plugin.recognize === 'function',
      'CGP2 factory or recognizer unavailable.');
    assert(plugin.recognize({provider: 'chatgpt'}) === true,
      'CGP2 did not recognize its provider.');
    assert(plugin.recognize({provider: 'unrelated', url: 'https://example.com/'}) === false,
      'CGP2 incorrectly recognized another provider.');
    assert(chatGPTAgent && chatGPTCanonicalSession,
      'AICC did not create the live canonical agent and session.');
    const selected = canonicalCore().getAgentPluginArtifact('chatgpt-web');
    const actual = chatGPTAgent.version();
    assert(actual.plugin === selected.id && actual.version === selected.version &&
      actual.ref === selected.ref && actual.apiVersion === selected.apiVersion,
    'Live agent identity does not match AICC catalogue.');
  }

  /**
   * Verifies the isolated testCGP2IsolatedLifecycle CGP2 browser integration contract.
   * @returns {void} Completes after fixture verification.
   */
  function testCGP2IsolatedLifecycle() {
    const plugin = globalThis.ChatGPTWebAgentPlugin;
    assert(plugin?.create, 'Private CGP2 plugin is unavailable.');
    const agent = plugin.create({ref: 'test-only'});
    const other = plugin.create({ref: 'test-only'});
    const states = [];
    const unsubscribe = agent.observeState(state => states.push(state));
    assert(states.length === 1 && states[0].exchange.status === 'UNKNOWN',
      'Initial state observer did not deliver its snapshot.');
    agent.commTraffic({type:'submission_committed', exchange_id:'fixture-exchange', activate:true});
    assert(agent.currentState().exchange.id === 'fixture-exchange',
      'Synthetic exchange did not activate.');
    assert(other.currentState().exchange.id === null,
      'Agent state leaked into another instance.');
    const observed = states.length;
    unsubscribe();
    agent.commTraffic({type:'submission_committed', exchange_id:'fixture-next', activate:true});
    assert(states.length === observed, 'Unsubscribed observer was notified.');
  }

  /**
   * Verifies the isolated testCGP2RejectsWrongVersion CGP2 browser integration contract.
   * @returns {Promise<void>} Completes after fixture verification.
   */
  async function testCGP2RejectsWrongVersion() {
    const plugin = globalThis.ChatGPTWebAgentPlugin;
    assert(plugin?.create, 'Private CGP2 plugin is unavailable.');
    const core = canonicalCore();
    let rejected = false;
    try {
      await core.loadAgent('chatgpt-web', {
        loadModule: async () => ({default: {...plugin, apiVersion: plugin.apiVersion + 1}})
      });
    } catch { rejected = true; }
    assert(rejected, 'AICC accepted a plugin descriptor with a mismatched API version.');
  }

  /**
   * Verifies the isolated testCGP2MissingProvider CGP2 browser integration contract.
   * @returns {Promise<void>} Completes after fixture verification.
   */
  async function testCGP2MissingProvider() {
    const core = canonicalCore();
    let rejected = false;
    try {
      await core.loadAgent('chatgpt-web', {
        loadModule: async () => ({default: null})
      });
    } catch { rejected = true; }
    assert(rejected, 'AICC accepted a missing provider module.');
  }

  /**
   * Verifies the isolated testCGP2CanonicalFixtureParity CGP2 browser integration contract.
   * @returns {void} Completes after fixture verification.
   */
  function testCGP2CanonicalFixtureParity() {
    const plugin = globalThis.ChatGPTWebAgentPlugin;
    assert(plugin?.create, 'Private CGP2 plugin unavailable.');
    const fixture = [
      {id: 'cg-fixture-user', author: {role: 'user'},
        content: {content_type: 'text', parts: ['Fixture question']}, metadata: {}},
      {id: 'cg-fixture-assistant', author: {role: 'assistant'},
        content: {content_type: 'text', parts: ['Fixture answer']}, metadata: {}}
    ];
    const produced = [];
    const agent = plugin.create({
      ref: 'test-only',
      core: {publishEvents: events => produced.push(events)}
    });
    agent.commTraffic({type: 'persisted_records', records: fixture});
    assert(produced.length === 1, 'CGP2 did not publish canonical records.');
    const messages = produced[0].filter(item =>
      item.kind === 'message' && item.visibility === 'visible');
    assert(messages.length === 2, 'Expected exactly two canonical messages.');
    assert(messages[0].source_record_id === fixture[0].id &&
      messages[1].source_record_id === fixture[1].id,
    'CGP2 changed ordered source message identities.');
    agent.commTraffic({type: 'persisted_records', records: fixture});
    assert(produced.length === 2 &&
      JSON.stringify(produced[0]) === JSON.stringify(produced[1]),
    'Repeated inventory changed canonical interpretation.');
  }

  /**
   * Verifies the isolated testCGP2IndependentExchangeOrdering CGP2 browser integration contract.
   * @returns {void} Completes after fixture verification.
   */
  function testCGP2IndependentExchangeOrdering() {
    const plugin = globalThis.ChatGPTWebAgentPlugin;
    assert(plugin?.create, 'Private CGP2 plugin unavailable.');
    const agent = plugin.create({ref: 'test-only'});
    agent.commTraffic({type:'turn_exchange_complete',
      exchange_id:'fixture-x', result:'success', sequence:20});
    assert(agent.currentState().exchange.status === 'COMPLETED',
      'Completed fixture exchange was not recognised.');
    agent.commTraffic({type:'turn_exchange_complete',
      exchange_id:'fixture-x', result:'error', sequence:19});
    assert(agent.currentState().exchange.status === 'COMPLETED',
      'Older fixture observation corrupted the accepted outcome.');
    agent.commTraffic({type:'submission_committed',
      exchange_id:'fixture-y', activate:true});
    assert(agent.currentState().exchange.id === 'fixture-y' &&
      agent.currentState().exchange.status === 'IN_PROGRESS',
    'Subsequent fixture exchange did not start in progress.');
  }

  /**
   * Verifies the isolated testCGP2DirectLoaderIdentity CGP2 browser integration contract.
   * @returns {Promise<void>} Completes after fixture verification.
   */
  async function testCGP2DirectLoaderIdentity() {
    const descriptor = canonicalCore().getAgentPluginArtifact('chatgpt-web');
    const loaded = await importAgentPluginModule(descriptor);
    assert(loaded.default === globalThis.ChatGPTWebAgentPlugin,
      'DC loader did not return the exact shared CGP2 object.');
    const again = await importAgentPluginModule(descriptor);
    assert(again.default === loaded.default,
      'Repeated DC loader call returned a different plugin object.');
  }


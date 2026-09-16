from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
  global text
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  text = text.replace(old, new, 1)


replace_once(
  '// @version      1.2.0-issue.134.6',
  '// @version      1.2.0-issue.135.1',
  'version'
)

replace_once(
  "  /** Local-storage key for Markdown Core debug-provenance visibility. */\n"
  "  const SHOW_DEBUG_PROVENANCE_STORAGE_KEY = 'tm-conversation-recorder-show-debug-provenance';\n",
  "  /** Local-storage key for Markdown Core debug-provenance visibility. */\n"
  "  const SHOW_DEBUG_PROVENANCE_STORAGE_KEY = 'tm-conversation-recorder-show-debug-provenance';\n"
  "  /** Local-storage key for audible agent terminal-state notifications. */\n"
  "  const AGENT_SOUNDS_STORAGE_KEY = 'tm-conversation-recorder-agent-sounds';\n",
  'sound storage key'
)

replace_once(
  "  /** Whether Markdown headings should include Core-derived source debug provenance. */\n"
  "  let showDebugProvenance = localStorage.getItem(SHOW_DEBUG_PROVENANCE_STORAGE_KEY) === 'true';\n",
  "  /** Whether Markdown headings should include Core-derived source debug provenance. */\n"
  "  let showDebugProvenance = localStorage.getItem(SHOW_DEBUG_PROVENANCE_STORAGE_KEY) === 'true';\n"
  "  /** Whether successful/error agent terminal states should emit an audible cue. */\n"
  "  let agentSoundsEnabled = localStorage.getItem(AGENT_SOUNDS_STORAGE_KEY) === 'true';\n"
  "  /** AudioContext unlocked by a user gesture when terminal sounds are enabled. */\n"
  "  let agentSoundAudioContext = null;\n"
  "  /** Bounded stable turn identities that have already emitted a terminal sound. */\n"
  "  const agentSoundTerminalKeys = new Set();\n"
  "  /** Maximum number of emitted terminal turn identities retained for de-duplication. */\n"
  "  const AGENT_SOUND_TERMINAL_KEY_LIMIT = 128;\n",
  'sound state'
)

sound_block = r'''
  /**
   * Unlocks the browser Web Audio context from a user gesture when sounds are enabled.
   *
   * @returns {Promise<boolean>} True when the audio context is ready to play.
   */
  async function unlockAgentSoundAudio() {
    if (!agentSoundsEnabled) return false;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (typeof AudioContextClass !== 'function') return false;
      if (!agentSoundAudioContext) agentSoundAudioContext = new AudioContextClass();
      if (agentSoundAudioContext.state === 'suspended') await agentSoundAudioContext.resume();
      return agentSoundAudioContext.state === 'running';
    } catch (error) {
      logDiagnostic('warnings', 'agent-sound-audio-unlock-failure', { message: errorMessage(error) });
      return false;
    }
  }

  /**
   * Handles a trusted browser gesture that can unlock persisted terminal sounds after reload.
   *
   * @returns {void} No value is returned.
   */
  function agentSoundHandleUserGesture() {
    if (agentSoundsEnabled) void unlockAgentSoundAudio();
  }

  /**
   * Plays one short browser-generated terminal-state cue.
   *
   * @param {string} kind - `success` for the ding or `error` for the buzz.
   * @returns {void} No value is returned.
   */
  function playAgentSound(kind) {
    if (!agentSoundsEnabled || (kind !== 'success' && kind !== 'error')) return;
    const audio = agentSoundAudioContext;
    if (!audio || audio.state !== 'running') return;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const now = audio.currentTime;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.0001, now);
      if (kind === 'error') {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(115, now);
        oscillator.frequency.linearRampToValueAtTime(82, now + 0.28);
        gain.gain.exponentialRampToValueAtTime(0.075, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        oscillator.start(now);
        oscillator.stop(now + 0.29);
      } else if (kind === 'success') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.setValueAtTime(1320, now + 0.09);
        gain.gain.exponentialRampToValueAtTime(0.11, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        oscillator.start(now);
        oscillator.stop(now + 0.23);
      }
    } catch (error) {
      logDiagnostic('warnings', 'agent-sound-playback-failure', { kind, message: errorMessage(error) });
    }
  }

  /**
   * Returns one stable generation-turn identity for terminal-sound de-duplication.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @returns {string|null} Stable conversation/turn key, or null when the request lacks identity.
   */
  function agentSoundTerminalKey(capture) {
    const request = [...(capture?.request_messages ?? [])]
      .reverse()
      .find(message => typeof message?.id === 'string' && message.id);
    const metadata = request?.metadata ?? {};
    const turnIdentity = metadata.turn_exchange_id || metadata.working_turn_id ||
      metadata.request_id || request?.id || capture?.parent_message_id || null;
    if (!turnIdentity) return null;
    return `${capture?.conversation_id ?? 'new'}:${turnIdentity}`;
  }

  /**
   * Retains one terminal turn key in a bounded insertion-ordered set.
   *
   * @param {string} key - Stable terminal turn key.
   * @returns {void} No value is returned.
   */
  function agentSoundRememberTerminalKey(key) {
    if (!key || agentSoundTerminalKeys.has(key)) return;
    while (agentSoundTerminalKeys.size >= AGENT_SOUND_TERMINAL_KEY_LIMIT) {
      const oldest = agentSoundTerminalKeys.values().next().value;
      if (oldest === undefined) break;
      agentSoundTerminalKeys.delete(oldest);
    }
    agentSoundTerminalKeys.add(key);
  }

  /**
   * Classifies the currently known structured generation terminal state.
   *
   * Error matching is intentionally field-based and finite. New provider terminal states are added
   * here only after a real captured log establishes their exact structured shape.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {string|null} `success`, `error`, or null when the turn is not terminal.
   */
  function agentSoundClassifyTerminal(capture, event) {
    const structured = [];
    if (event && typeof event === 'object' && !Array.isArray(event)) structured.push(event);
    if (event?.v && typeof event.v === 'object' && !Array.isArray(event.v)) structured.push(event.v);
    for (const candidate of structured) {
      const providerCode = candidate.code ?? candidate?.error?.code ?? null;
      if (candidate.type === 'error' && providerCode === 'conversation_too_large') return 'error';
      if (candidate.result === 'error' &&
          candidate?.error?.reason === 'request_failed' &&
          Number(candidate?.error?.status_code) >= 400) {
        return 'error';
      }
    }
    const success = (capture?.stream_messages ?? []).some(message =>
      message?.author?.role === 'assistant' &&
      message?.channel === 'final' &&
      message?.status === 'finished_successfully' &&
      message?.end_turn === true
    );
    return success ? 'success' : null;
  }

  /**
   * Emits a terminal-state sound once for one stable generation turn.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {Object|null} event - Most recently parsed structured SSE/v1 event, when any.
   * @returns {void} No value is returned.
   */
  function agentSoundObserveTerminal(capture, event) {
    if (!agentSoundsEnabled) return;
    const kind = agentSoundClassifyTerminal(capture, event);
    if (!kind) return;
    const key = agentSoundTerminalKey(capture);
    if (!key || agentSoundTerminalKeys.has(key)) return;
    agentSoundRememberTerminalKey(key);
    playAgentSound(kind);
  }

  document.addEventListener('pointerdown', agentSoundHandleUserGesture, true);
  document.addEventListener('keydown', agentSoundHandleUserGesture, true);

'''
marker = '  // BEGIN Issue #123 streamed-tail recovery\n'
count = text.count(marker)
if count != 1:
  raise SystemExit(f'stream-tail marker: expected exactly one match, found {count}')
text = text.replace(marker, sound_block + marker, 1)

replace_once(
  "        capture.updated_at = Date.now();\n        continue;\n      }\n      let parsed;\n",
  "        capture.updated_at = Date.now();\n        agentSoundObserveTerminal(capture, null);\n        continue;\n      }\n      let parsed;\n",
  'DONE terminal observation'
)

replace_once(
  "      streamTailApplyEvent(capture, parsed);\n    }\n    if (capture.complete) streamTailPersistCapture(capture);\n",
  "      streamTailApplyEvent(capture, parsed);\n      agentSoundObserveTerminal(capture, parsed);\n    }\n    if (capture.complete) streamTailPersistCapture(capture);\n",
  'structured terminal observation'
)

replace_once(
  '      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button" role="switch" aria-checked="false" aria-label="Keep screen on while extracting"><span class="tm-switch-thumb"></span></button></div>\n',
  '      <div class="tm-row"><span class="tm-label">Screen on when extracting</span><button class="tm-switch" data-role="screen-on" type="button" role="switch" aria-checked="false" aria-label="Keep screen on while extracting"><span class="tm-switch-thumb"></span></button></div>\n'
  '      <div class="tm-row"><label><input data-role="agent-sounds" type="checkbox"> Sounds</label></div>\n',
  'Sounds checkbox markup'
)

replace_once(
  "    bindStoredCheckbox(panel, 'show-debug-provenance', SHOW_DEBUG_PROVENANCE_STORAGE_KEY, showDebugProvenance, value => {\n"
  "      showDebugProvenance = value;\n"
  "    });\n",
  "    bindStoredCheckbox(panel, 'show-debug-provenance', SHOW_DEBUG_PROVENANCE_STORAGE_KEY, showDebugProvenance, value => {\n"
  "      showDebugProvenance = value;\n"
  "    });\n"
  "    bindStoredCheckbox(panel, 'agent-sounds', AGENT_SOUNDS_STORAGE_KEY, agentSoundsEnabled, value => {\n"
  "      agentSoundsEnabled = value;\n"
  "      if (value) void unlockAgentSoundAudio();\n"
  "    });\n",
  'Sounds checkbox binding'
)

path.write_text(text, encoding='utf-8')

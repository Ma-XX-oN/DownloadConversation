from pathlib import Path


SOURCE = Path('chatgpt-conversation-markdown-export.user.js')
SOUND_TEST = Path('tests/agent-completion-sounds.test.mjs')
STOPWATCH_TEST = Path('tests/agent-turn-stopwatch.test.mjs')
DESIGN = Path('DESIGN.md')


def replace_once(path, old, new):
  text = path.read_text(encoding='utf-8')
  count = text.count(old)
  assert count == 1, f'{path}: expected one anchor, found {count}'
  path.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_function(path, signature, replacement):
  text = path.read_text(encoding='utf-8')
  start = text.find(signature)
  assert start >= 0, f'{path}: function signature not found: {signature}'
  assert text.find(signature, start + 1) < 0, f'{path}: duplicate function signature: {signature}'
  marker = '\n  }\n\n  /**'
  end_marker = text.find(marker, start)
  assert end_marker >= 0, f'{path}: end marker not found for: {signature}'
  end = end_marker + len('\n  }')
  path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')


replace_once(
  SOURCE,
  '// @version      1.2.0-issue.136.5',
  '// @version      1.2.0-issue.137.1'
)

replace_once(
  SOURCE,
  "  /** Local-storage key for audible agent terminal-state notifications. */\n"
  "  const AGENT_SOUNDS_STORAGE_KEY = 'tm-conversation-recorder-agent-sounds';",
  "  /** Local-storage key for the current integer agent terminal-sound volume. */\n"
  "  const AGENT_SOUND_VOLUME_STORAGE_KEY = 'tm-conversation-recorder-agent-sound-volume';\n"
  "  /** Legacy boolean sound preference retained only for deterministic migration. */\n"
  "  const LEGACY_AGENT_SOUNDS_STORAGE_KEY = 'tm-conversation-recorder-agent-sounds';"
)

state_old = "  /** Whether successful/error agent terminal states should emit an audible cue. */\n" \
  "  let agentSoundsEnabled = localStorage.getItem(AGENT_SOUNDS_STORAGE_KEY) === 'true';\n"
state_new = """  /**
   * Loads the persisted 0-10 terminal-sound volume, including the legacy checkbox migration.
   *
   * @returns {number} Integer terminal-sound volume from 0 through 10.
   */
  function loadAgentSoundVolume() {
    const stored = localStorage.getItem(AGENT_SOUND_VOLUME_STORAGE_KEY);
    if (stored !== null) {
      const parsed = Number.parseInt(stored, 10);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;
    }
    const legacy = localStorage.getItem(LEGACY_AGENT_SOUNDS_STORAGE_KEY);
    if (legacy === 'true') return 10;
    if (legacy === 'false') return 0;
    return 0;
  }

  /** Persisted integer terminal-sound volume; zero is the only disabled state. */
  let agentSoundVolume = loadAgentSoundVolume();
"""
replace_once(SOURCE, state_old, state_new)

unlock_new = """  async function unlockAgentSoundAudio() {
    const volume = agentSoundVolume;
    const beforeState = agentSoundAudioContext?.state ?? 'absent';
    if (volume <= 0) {
      logDiagnostic('debug', 'agent-sound-audio-unlock', {
        volume,
        before_state: beforeState,
        after_state: beforeState,
        resume_attempted: false,
        ready: false,
        reason: 'volume-zero'
      });
      return false;
    }
    let resumeAttempted = false;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (typeof AudioContextClass !== 'function') {
        logDiagnostic('warnings', 'agent-sound-audio-unlock', {
          volume,
          before_state: beforeState,
          after_state: 'unavailable',
          resume_attempted: false,
          ready: false,
          reason: 'audio-context-unavailable'
        });
        return false;
      }
      if (!agentSoundAudioContext) agentSoundAudioContext = new AudioContextClass();
      if (agentSoundAudioContext.state === 'suspended') {
        resumeAttempted = true;
        await agentSoundAudioContext.resume();
      }
      const afterState = agentSoundAudioContext.state;
      const ready = afterState === 'running';
      logDiagnostic('debug', 'agent-sound-audio-unlock', {
        volume,
        before_state: beforeState,
        after_state: afterState,
        resume_attempted: resumeAttempted,
        ready
      });
      return ready;
    } catch (error) {
      logDiagnostic('warnings', 'agent-sound-audio-unlock', {
        volume,
        before_state: beforeState,
        after_state: agentSoundAudioContext?.state ?? 'absent',
        resume_attempted: resumeAttempted,
        ready: false,
        message: errorMessage(error)
      });
      return false;
    }
  }"""
replace_function(SOURCE, '  async function unlockAgentSoundAudio() {', unlock_new)

handle_new = """  function agentSoundHandleUserGesture() {
    if (agentSoundVolume > 0) void unlockAgentSoundAudio();
  }"""
replace_function(SOURCE, '  function agentSoundHandleUserGesture() {', handle_new)

play_new = """  function playAgentSound(kind) {
    const volume = agentSoundVolume;
    const audio = agentSoundAudioContext;
    const audioContextState = audio?.state ?? 'absent';
    logDiagnostic('debug', 'agent-sound-playback-attempt', {
      kind,
      volume,
      audio_context_state: audioContextState
    });
    if (volume <= 0 || (kind !== 'success' && kind !== 'error')) return false;
    if (!audio || audio.state !== 'running') {
      logDiagnostic('warnings', 'agent-sound-playback-unavailable', {
        kind,
        volume,
        audio_context_state: audioContextState
      });
      return false;
    }
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime;
      const volumeScale = Math.max(0, Math.min(10, volume)) / 10;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.0001, start);
      if (kind === 'success') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(740, start);
        oscillator.frequency.linearRampToValueAtTime(988, start + 0.16);
        gain.gain.exponentialRampToValueAtTime(volumeScale, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
        oscillator.start(start);
        oscillator.stop(start + 0.34);
      } else {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(210, start);
        oscillator.frequency.linearRampToValueAtTime(150, start + 0.32);
        gain.gain.exponentialRampToValueAtTime(volumeScale, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
        oscillator.start(start);
        oscillator.stop(start + 0.44);
      }
      logDiagnostic('debug', 'agent-sound-playback-started', {
        kind,
        volume,
        peak_gain: volumeScale,
        audio_context_state: audio.state
      });
      return true;
    } catch (error) {
      logDiagnostic('warnings', 'agent-sound-playback-failure', {
        kind,
        volume,
        audio_context_state: audio?.state ?? 'absent',
        message: errorMessage(error)
      });
      return false;
    }
  }"""
replace_function(SOURCE, '  function playAgentSound(kind) {', play_new)

observe_new = """  function agentSoundObserveTerminal(capture, event) {
    const kind = agentSoundClassifyTerminal(capture, event);
    if (!kind) return;
    const key = agentSoundTerminalKey(capture);
    logDiagnostic('debug', 'agent-sound-terminal-classified', {
      kind,
      terminal_key: key,
      volume: agentSoundVolume,
      audio_context_state: agentSoundAudioContext?.state ?? 'absent'
    });
    if (!key) return;
    if (agentSoundTerminalKeys.has(key)) {
      logDiagnostic('debug', 'agent-sound-duplicate-suppressed', {
        kind,
        terminal_key: key,
        volume: agentSoundVolume
      });
      return;
    }
    if (agentSoundVolume <= 0) {
      logDiagnostic('debug', 'agent-sound-volume-zero-suppressed', {
        kind,
        terminal_key: key,
        volume: agentSoundVolume
      });
      return;
    }
    if (playAgentSound(kind)) agentSoundRememberTerminalKey(key);
  }"""
replace_function(SOURCE, '  function agentSoundObserveTerminal(capture, event) {', observe_new)

replace_once(
  SOURCE,
  "      #${PANEL_ID} .tm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}",
  "      #${PANEL_ID} .tm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}\n"
  "      #${PANEL_ID} .tm-sound-control-row{position:relative}\n"
  "      #${PANEL_ID} .tm-sound-control{min-width:92px}\n"
  "      #${PANEL_ID} .tm-sound-popup[hidden]{display:none}\n"
  "      #${PANEL_ID} .tm-sound-popup{position:absolute;left:0;top:calc(100% + 6px);z-index:3;display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px;border:1px solid rgba(127,127,127,.55);border-radius:9px;background:rgba(24,24,24,.99);box-shadow:0 4px 14px rgba(0,0,0,.4)}\n"
  "      #${PANEL_ID} .tm-sound-volume-slider{writing-mode:vertical-lr;direction:rtl;width:24px;height:120px}\n"
  "      #${PANEL_ID} .tm-sound-volume-value{min-width:2ch;text-align:center;font-variant-numeric:tabular-nums}"
)

replace_once(
  SOURCE,
  '      <div class="tm-row"><label><input data-role="agent-sounds" type="checkbox"> Sounds</label></div>',
  '      <div class="tm-row tm-sound-control-row"><button class="tm-sound-control" data-role="agent-sound-control" type="button" aria-haspopup="dialog" aria-expanded="false">Sound <span data-role="agent-sound-control-value"></span></button><div class="tm-sound-popup" data-role="agent-sound-popup" hidden role="dialog" aria-label="Agent sound volume"><input class="tm-sound-volume-slider" data-role="agent-sound-volume" type="range" min="0" max="10" step="1" aria-label="Agent sound volume"><output class="tm-sound-volume-value" data-role="agent-sound-volume-value"></output></div></div>'
)

old_binding = """    bindStoredCheckbox(panel, 'agent-sounds', AGENT_SOUNDS_STORAGE_KEY, agentSoundsEnabled, value => {
      agentSoundsEnabled = value;
      if (value) void unlockAgentSoundAudio();
    });"""
new_binding = """    const soundControl = panel.querySelector('[data-role="agent-sound-control"]');
    const soundPopup = panel.querySelector('[data-role="agent-sound-popup"]');
    const soundVolumeInput = panel.querySelector('[data-role="agent-sound-volume"]');
    const soundVolumeValue = panel.querySelector('[data-role="agent-sound-volume-value"]');
    const soundControlValue = panel.querySelector('[data-role="agent-sound-control-value"]');
    /**
     * Renders the current integer sound volume into the popup and control label.
     *
     * @returns {void} No value is returned.
     */
    const renderSoundVolume = () => {
      const value = String(agentSoundVolume);
      if (soundVolumeInput instanceof HTMLInputElement) soundVolumeInput.value = value;
      if (soundVolumeValue) soundVolumeValue.textContent = value;
      if (soundControlValue) soundControlValue.textContent = value;
    };
    /**
     * Opens or closes the sound-volume popup and mirrors the expanded state for accessibility.
     *
     * @param {boolean} open - True to show the volume popup.
     * @returns {void} No value is returned.
     */
    const setSoundPopupOpen = open => {
      if (!soundPopup || !soundControl) return;
      soundPopup.hidden = !open;
      soundControl.setAttribute('aria-expanded', String(open));
    };
    renderSoundVolume();
    soundControl?.addEventListener('click', event => {
      event.stopPropagation();
      const open = Boolean(soundPopup?.hidden);
      setSoundPopupOpen(open);
      if (open && agentSoundVolume > 0) void unlockAgentSoundAudio();
    });
    soundPopup?.addEventListener('click', event => event.stopPropagation());
    soundVolumeInput?.addEventListener('input', () => {
      const parsed = Number.parseInt(soundVolumeInput.value, 10);
      agentSoundVolume = Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;
      localStorage.setItem(AGENT_SOUND_VOLUME_STORAGE_KEY, String(agentSoundVolume));
      renderSoundVolume();
      logDiagnostic('debug', 'agent-sound-volume-changed', { volume: agentSoundVolume });
      if (agentSoundVolume > 0) void unlockAgentSoundAudio();
    });
    document.addEventListener('click', event => {
      if (!soundPopup || soundPopup.hidden) return;
      if (event.target instanceof Node && panel.querySelector('.tm-sound-control-row')?.contains(event.target)) return;
      setSoundPopupOpen(false);
    });"""
replace_once(SOURCE, old_binding, new_binding)

replace_once(
  STOPWATCH_TEST,
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.136\.5/);",
  r"assert.match(userscript, /@version\s+1\.2\.0-issue\.137\.1/);"
)

text = DESIGN.read_text(encoding='utf-8')
marker = '## Agent terminal sound volume and reliable playback'
assert marker not in text, f'{DESIGN}: issue #137 design section already exists'
text += """

## Agent terminal sound volume and reliable playback

The general status panel exposes one **Sound** control rather than a boolean sound checkbox. Activating it opens a compact popup containing a vertical integer slider from 0 through 10 and a numeric value. Volume 0 is the single disabled state; nonzero values enable the same structured terminal-state cues. The integer volume is persisted under `tm-conversation-recorder-agent-sound-volume`. A legacy saved boolean `tm-conversation-recorder-agent-sounds` migrates deterministically to 10 when true or 0 when false when no integer value exists.

Terminal sound identity remains structured-stream-only. Successful completion is still the exact final successful Assistant state, and errors remain established structured terminal error events; rendered text is not inspected as a fallback. The stable terminal identity is de-duplicated only after oscillator scheduling succeeds. A missing or suspended AudioContext therefore cannot permanently consume a terminal key before a sound has actually started.

Trusted pointer/keyboard gestures and nonzero volume interaction create or resume the single Web Audio context. Playback diagnostics record terminal classification, duplicate or volume-zero suppression, AudioContext unlock state, playback attempt, successful oscillator scheduling, and playback failure. These diagnostics are observability only and do not introduce an alternate trigger or playback path.

Cue amplitude scales linearly with the selected slider level, with level 10 using a peak gain of 1.0. Success and error retain their distinct oscillator waveforms, pitch envelopes, and durations. The volume control does not alter streamed-tail reconciliation, stopwatch timing, exports, or ChatGPT request semantics.
"""
DESIGN.write_text(text, encoding='utf-8')

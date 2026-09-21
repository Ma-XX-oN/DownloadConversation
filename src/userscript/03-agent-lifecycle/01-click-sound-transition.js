
  /**
   * Handles finish conversation click diagnostic.
   *
   * @param {Object} observation - The observation value required by this function.
   * @param {string} reason - The reason the operation is being completed.
   * @returns {void} No value is returned.
   */
  function finishConversationClickDiagnostic(observation, reason = 'timer') {
    if (!observation || observation.finished) return;
    observation.finished = true;
    if (activeClickDiagnostic === observation) activeClickDiagnostic = null;
    const endedAt = performance.now();
    const resources = performance.getEntriesByType('resource')
      .filter(entry => entry instanceof PerformanceResourceTiming &&
        entry.startTime >= observation.started_at - 1 && entry.startTime <= endedAt + 1)
      .slice(-100)
      .map(entry => ({
        url: boundedDiagnosticText(entry.name, 2000),
        initiator_type: entry.initiatorType || null,
        response_status: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
        transfer_size: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
        decoded_body_size: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
        start_offset_ms: Math.round(entry.startTime - observation.started_at),
        duration_ms: Math.round(entry.duration)
      }));
    logDiagnostic('debug', 'conversation-click-resolution-result', {
      click_sequence: observation.sequence,
      finish_reason: reason,
      observation_ms: Math.round(endedAt - observation.started_at),
      is_trusted: observation.is_trusted,
      pointer_type: observation.pointer_type,
      button: observation.button,
      turn: observation.turn,
      clicked: observation.clicked,
      closest_anchor: observation.closest_anchor,
      closest_button: observation.closest_button,
      closest_image: observation.closest_image,
      network_requests: observation.network_requests,
      new_performance_resources: resources
    });
  }

  /**
   * Handles capture conversation click diagnostic.
   *
   * @param {Event|Object} event - The event or event-like object being handled.
   * @returns {void} No value is returned.
   */
  function captureConversationClickDiagnostic(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest('#thread')) return;
    const turn = clickDiagnosticTurnContext(target);
    if (!turn) return;
    if (activeClickDiagnostic) finishConversationClickDiagnostic(activeClickDiagnostic, 'superseded-by-next-click');
    const startedAt = performance.now();
    const observation = {
      sequence: ++clickDiagnosticSequence,
      started_at: startedAt,
      deadline: startedAt + 2500,
      is_trusted: event.isTrusted === true,
      pointer_type: typeof event.pointerType === 'string' && event.pointerType ? event.pointerType : null,
      button: Number.isInteger(event.button) ? event.button : null,
      turn,
      clicked: clickDiagnosticElementSnapshot(target),
      closest_anchor: clickDiagnosticElementSnapshot(target.closest('a[href]')),
      closest_button: clickDiagnosticElementSnapshot(target.closest('button')),
      closest_image: clickDiagnosticElementSnapshot(target.closest('img')),
      network_requests: [],
      finished: false
    };
    activeClickDiagnostic = observation;
    logDiagnostic('debug', 'conversation-click-resolution-start', {
      click_sequence: observation.sequence,
      is_trusted: observation.is_trusted,
      pointer_type: observation.pointer_type,
      button: observation.button,
      turn: observation.turn,
      clicked: observation.clicked,
      closest_anchor: observation.closest_anchor,
      closest_button: observation.closest_button,
      closest_image: observation.closest_image
    });
    setTimeout(() => finishConversationClickDiagnostic(observation, 'timer'), 2500);
  }

  /** DOM id of the stopwatch-owned sound-readiness indicator. */
  const AGENT_SOUND_INITIALIZATION_INDICATOR_ID = 'tm-agent-sound-uninitialized';
  /** Horizontal gap between the sound-readiness indicator and the stopwatch. */
  const AGENT_SOUND_INITIALIZATION_GAP_PX = 8;

  /**
   * Tests the same AudioContext state that production playback requires.
   *
   * @returns {boolean} True only when terminal audio can be scheduled immediately.
   */
  function agentSoundAudioReady() {
    return agentSoundAudioContext?.state === 'running';
  }

  /**
   * Keeps the sound-readiness indicator owned by the stopwatch and positions it immediately
   * to the stopwatch's left. If no stopwatch exists yet, no independent page-level indicator
   * is deployed.
   *
   * @param {HTMLElement|null} indicator - Existing readiness indicator, when already resolved.
   * @returns {void} No value is returned.
   */
  function agentSoundPositionInitializationIndicator(
    indicator = document.getElementById(AGENT_SOUND_INITIALIZATION_INDICATOR_ID)
  ) {
    const stopwatch = document.getElementById(AGENT_STOPWATCH_ID);
    if (!stopwatch) {
      indicator?.remove();
      return;
    }
    if (agentSoundAudioReady()) {
      indicator?.remove();
      return;
    }
    const visibleIndicator = indicator || ensureAgentSoundInitializationIndicator();
    if (!visibleIndicator) return;
    if (visibleIndicator.parentNode !== stopwatch) stopwatch.append(visibleIndicator);
    visibleIndicator.style.position = 'absolute';
    visibleIndicator.style.top = '5px';
    visibleIndicator.style.right = `calc(100% + ${AGENT_SOUND_INITIALIZATION_GAP_PX}px)`;
  }

  /**
   * Returns the single disabled-speaker sound-readiness indicator owned by the stopwatch.
   *
   * @returns {HTMLElement|null} Existing/new indicator, or null until the stopwatch exists.
   */
  function ensureAgentSoundInitializationIndicator() {
    const stopwatch = document.getElementById(AGENT_STOPWATCH_ID);
    if (!stopwatch) return null;
    let indicator = document.getElementById(AGENT_SOUND_INITIALIZATION_INDICATOR_ID);
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = AGENT_SOUND_INITIALIZATION_INDICATOR_ID;
      indicator.setAttribute('aria-hidden', 'true');
      indicator.style.zIndex = '2147483647';
      indicator.style.width = '24px';
      indicator.style.height = '24px';
      indicator.style.boxSizing = 'border-box';
      indicator.style.border = 'none';
      indicator.style.borderRadius = '50%';
      indicator.style.backgroundColor = 'rgba(32, 32, 32, 0.92)';
      indicator.style.backgroundImage = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='10.5' fill='none' stroke='%23d93025' stroke-width='2.1'/%3E%3Cpath fill='%23f5f5f5' d='M4 9h4l5-4v14l-5-4H4z'/%3E%3Cpath d='M4.6 19.4L19.4 4.6' stroke='%23d93025' stroke-width='2.1' stroke-linecap='round'/%3E%3C/svg%3E\")";
      indicator.style.backgroundPosition = 'center';
      indicator.style.backgroundRepeat = 'no-repeat';
      indicator.style.backgroundSize = '24px 24px';
      indicator.style.pointerEvents = 'none';
      indicator.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.25)';
    }
    if (indicator.parentNode !== stopwatch) stopwatch.append(indicator);
    agentSoundPositionInitializationIndicator(indicator);
    return indicator;
  }

  /**
   * Projects authoritative AudioContext readiness onto the stopwatch-owned status icon.
   *
   * @returns {boolean} True when audio is ready and the uninitialized status is absent.
   */
  function agentSoundSyncInitializationIndicator() {
    const ready = agentSoundAudioReady();
    const indicator = document.getElementById(AGENT_SOUND_INITIALIZATION_INDICATOR_ID);
    if (ready) {
      indicator?.remove();
      return true;
    }
    const visibleIndicator = indicator || ensureAgentSoundInitializationIndicator();
    agentSoundPositionInitializationIndicator(visibleIndicator);
    return false;
  }

  agentSoundSyncInitializationIndicator();
  document.addEventListener('DOMContentLoaded', agentSoundSyncInitializationIndicator, { once: true });

  /**
   * Unlocks the browser Web Audio context from a user gesture when sounds are enabled.
   *
   * @returns {Promise<boolean>} True when the audio context is ready to play.
   */
  async function unlockAgentSoundAudio() {
    const volume = agentSoundVolume;
    const beforeState = agentSoundAudioContext?.state ?? 'absent';
    if (volume <= 0) {
      agentSoundClearPendingTerminal();
      agentSoundSyncInitializationIndicator();
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
        agentSoundSyncInitializationIndicator();
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
      if (!agentSoundAudioContext) {
        agentSoundAudioContext = new AudioContextClass();
        agentSoundAudioContext.addEventListener('statechange', agentSoundSyncInitializationIndicator);
      }
      if (agentSoundAudioContext.state === 'suspended') {
        resumeAttempted = true;
        await agentSoundAudioContext.resume();
      }
      const afterState = agentSoundAudioContext.state;
      const ready = agentSoundAudioReady();
      agentSoundSyncInitializationIndicator();
      logDiagnostic('debug', 'agent-sound-audio-unlock', {
        volume,
        before_state: beforeState,
        after_state: afterState,
        resume_attempted: resumeAttempted,
        ready
      });
      if (ready) agentSoundRetryPendingTerminal();
      return ready;
    } catch (error) {
      agentSoundSyncInitializationIndicator();
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
  }

  /**
   * Handles a trusted browser gesture that can unlock persisted terminal sounds after reload.
   *
   * @returns {void} No value is returned.
   */
  function agentSoundHandleUserGesture() {
    if (agentSoundVolume > 0) void unlockAgentSoundAudio();
  }

  /**
   * Plays one short browser-generated terminal-state cue.
   *
   * @param {string} kind - `success` for the ding or `error` for the buzz.
   * @returns {void} No value is returned.
   */
  function playAgentSound(kind) {
    const volume = agentSoundVolume;
    const audio = agentSoundAudioContext;
    const audioContextState = audio?.state ?? 'absent';
    logDiagnostic('debug', 'agent-sound-playback-attempt', {
      kind,
      volume,
      audio_context_state: audioContextState
    });
    if (volume <= 0 || (kind !== 'success' && kind !== 'error')) return false;
    if (!audio || !agentSoundAudioReady()) {
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
  }

  /**
   * Returns one stable terminal identity from the shared normalized exchange identity.
   *
   * @param {Object} capture - Mutable streamed-turn capture.
   * @param {string|null} exchangeId - Shared structured exchange identity, when available.
   * @param {Object|null} finalMessage - Structured successful final Assistant message, when available.
   * @returns {string|null} Stable conversation/turn key, or null when no structured identity exists.
   */
  function agentTerminalKey(capture, exchangeId = null, finalMessage = null) {
    const request = [...(capture?.request_messages ?? [])]
      .reverse()
      .find(message => typeof message?.id === 'string' && message.id);
    const finalMetadata = finalMessage?.metadata ?? {};
    const requestMetadata = request?.metadata ?? {};
    const turnIdentity = exchangeId || finalMetadata.request_id || requestMetadata.request_id ||
      request?.id || capture?.parent_message_id || null;
    if (!turnIdentity) return null;
    return `${capture?.conversation_id ?? 'new'}:${turnIdentity}`;
  }

  /**
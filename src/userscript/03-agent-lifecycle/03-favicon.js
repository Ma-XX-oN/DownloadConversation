          });
          resolve({ applied: true, recolored_pixels: changed, width, height });
        } catch (error) {
          logDiagnostic('warnings', 'agent-favicon-render-failed', {
            state,
            candidate_ordinal: ordinal,
            candidate_count: total,
            message: errorMessage(error)
          });
          resolve({ applied: false, recolored_pixels: 0, width: null, height: null });
        }
      };
      image.onerror = () => {
        logDiagnostic('warnings', 'agent-favicon-image-load-failed', {
          state,
          candidate_ordinal: ordinal,
          candidate_count: total,
          original_href: candidate.original_href
        });
        resolve({ applied: false, recolored_pixels: 0, width: null, height: null });
      };
      image.src = candidate.original_href;
    });
  }

  /**
   * Renders one Agent favicon state across every stock favicon candidate the browser may select.
   *
   * @param {string} state - `processing`, `completed`, `error`, or `original`.
   * @returns {Promise<boolean>} True only when the requested state is applied to every current candidate.
   */
  function agentFaviconRenderState(state) {
    const generation = ++agentFaviconRenderGeneration;
    const candidates = agentFaviconCurrentCandidates();
    if (!candidates.length) {
      logDiagnostic('warnings', 'agent-favicon-original-missing', { state });
      return Promise.resolve(false);
    }
    if (state === 'original') {
      for (const candidate of candidates) candidate.link.href = candidate.original_href;
      logDiagnostic('debug', 'agent-favicon-state-rendered', {
        state,
        candidate_count: candidates.length,
        applied_candidate_count: candidates.length,
        recolored_pixels: 0
      });
      return Promise.resolve(true);
    }
    const targetRgb = state === 'processing'
      ? AGENT_FAVICON_PROCESSING_RGB
      : state === 'completed'
        ? AGENT_FAVICON_COMPLETED_RGB
        : state === 'error'
          ? AGENT_FAVICON_ERROR_RGB
          : null;
    if (!targetRgb) return Promise.resolve(false);
    return Promise.all(candidates.map((candidate, index) =>
      agentFaviconRenderCandidate(
        candidate,
        targetRgb,
        state,
        generation,
        index + 1,
        candidates.length
      )
    )).then(results => {
      if (generation !== agentFaviconRenderGeneration) return false;
      const applied = results.filter(result => result.applied).length;
      const recoloredPixels = results.reduce(
        (total, result) => total + (Number(result.recolored_pixels) || 0),
        0
      );
      logDiagnostic(applied === candidates.length ? 'debug' : 'warnings', 'agent-favicon-state-rendered', {
        state,
        candidate_count: candidates.length,
        applied_candidate_count: applied,
        recolored_pixels: recoloredPixels
      });
      return applied === candidates.length;
    });
  }

  /**
   * Records that Agent processing was observed in this page and renders the yellow favicon.
   *
   * @returns {void} No value is returned.
   */
  function agentFaviconObserveProcessing() {
    agentFaviconProcessingObserved = true;
    void agentFaviconRenderState('processing');
  }

  /**
   * Projects the already-fetched reload stream status into favicon processing state.
   *
   * @param {Object|null} streamStatus - Structured provider stream-status payload.
   * @returns {void} No value is returned.
   */
  function agentFaviconObserveStreamStatus(streamStatus) {
    if (agentStopwatchStreamIsActive(streamStatus)) agentFaviconObserveProcessing();
  }

  /**
   * Handles one shared normalized terminal event for favicon completion state.
   *
   * @param {Object} terminal - Shared normalized terminal event.
   * @returns {void} No value is returned.
   */
  function agentFaviconHandleTerminal(terminal) {
    if (terminal?.kind === 'error') {
      agentFaviconProcessingObserved = false;
      void agentFaviconRenderState('error');
      return;
    }
    if (terminal?.kind !== 'success' || !agentFaviconProcessingObserved) return;
    agentFaviconProcessingObserved = false;
    void agentFaviconRenderState('completed');
  }

  /** Single undelivered terminal cue retained until the next successful trusted audio unlock. */
  let agentSoundPendingTerminal = null;

  /**
   * Retains the newest terminal cue whose browser playback could not start.
   *
   * @param {string} kind - `success` for the ding or `error` for the buzz.
   * @param {string} terminalKey - Stable normalized terminal identity.
   * @param {string} soundKey - Terminal identity qualified by sound kind.
   * @returns {void} No value is returned.
   */
  function agentSoundRememberPendingTerminal(kind, terminalKey, soundKey) {
    agentSoundPendingTerminal = {
      kind,
      terminal_key: terminalKey,
      sound_key: soundKey
    };
    logDiagnostic('debug', 'agent-sound-pending-retained', {
      kind,
      terminal_key: terminalKey,
      volume: agentSoundVolume,
      audio_context_state: agentSoundAudioContext?.state ?? 'absent'
    });
  }

  /**
   * Discards the single retained terminal cue without marking it delivered.
   *
   * @returns {void} No value is returned.
   */
  function agentSoundClearPendingTerminal() {
    agentSoundPendingTerminal = null;
  }

  /**
   * Replays the single retained terminal cue after a trusted audio unlock.
   *
   * @returns {boolean} True only when retained cue playback starts successfully.
   */
  function agentSoundRetryPendingTerminal() {
    const pending = agentSoundPendingTerminal;
    if (!pending) return false;
    if (agentSoundVolume <= 0) {
      agentSoundClearPendingTerminal();
      return false;
    }
    if (!pending.sound_key || agentSoundTerminalKeys.has(pending.sound_key)) {
      agentSoundClearPendingTerminal();
      return false;
    }
    if (!playAgentSound(pending.kind)) return false;
    agentSoundClearPendingTerminal();
    agentSoundRememberTerminalKey(pending.sound_key);
    logDiagnostic('debug', 'agent-sound-pending-replayed', {
      kind: pending.kind,
      terminal_key: pending.terminal_key,
      volume: agentSoundVolume,
      audio_context_state: agentSoundAudioContext?.state ?? 'absent'
    });
    return true;
  }

  /**
   * Handles one already-normalized terminal event for browser audio only.
   *
   * @param {Object} terminal - Shared normalized terminal event.
   * @returns {void} No value is returned.
   */
  function agentSoundHandleTerminal(terminal) {
    const kind = terminal?.kind ?? null;
    const key = terminal?.terminal_key ?? null;
    const soundKey = key && kind ? `${key}:${kind}` : null;
    if (!kind) return;
    logDiagnostic('debug', 'agent-sound-terminal-classified', {
      kind,
      terminal_key: key,
      exchange_id: terminal?.exchange_id ?? null,
      volume: agentSoundVolume,
      audio_context_state: agentSoundAudioContext?.state ?? 'absent'
    });
    if (!soundKey) return;
    if (agentSoundTerminalKeys.has(soundKey) || agentSoundPendingTerminal?.sound_key === soundKey) {
      logDiagnostic('debug', 'agent-sound-duplicate-suppressed', {
        kind,
        terminal_key: key,
        volume: agentSoundVolume,
        pending: agentSoundPendingTerminal?.sound_key === soundKey
      });
      return;
    }
    if (agentSoundVolume <= 0) {
      agentSoundClearPendingTerminal();
      logDiagnostic('debug', 'agent-sound-volume-zero-suppressed', {
        kind,
        terminal_key: key,
        volume: agentSoundVolume
      });
      return;
    }
    if (playAgentSound(kind)) {
      agentSoundClearPendingTerminal();
      agentSoundRememberTerminalKey(soundKey);
      return;
    }
    agentSoundRememberPendingTerminal(kind, key, soundKey);
  }

  document.addEventListener('pointerdown', agentSoundHandleUserGesture, true);
  document.addEventListener('keydown', agentSoundHandleUserGesture, true);


  /**
   * Formats one non-negative stopwatch duration as whole minutes and seconds.
   *
   * @param {number} milliseconds - Monotonic elapsed milliseconds.
   * @returns {string} Human-readable `X m Y s` duration.
   */
  function agentStopwatchFormatDuration(milliseconds) {
    assert(Number.isFinite(milliseconds) && milliseconds >= 0,
      'Agent stopwatch duration must be finite and non-negative.');
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)} m ${seconds % 60} s`;
  }

  /**
   * Returns the provider working-exchange identity carried by one message.
   *
   * @param {Object|null} message - Structured provider message.
   * @returns {string|null} Stable exchange id, or null when the message has none.
   */
  function agentStopwatchExchangeId(message) {
    const metadata = message?.metadata ?? {};
    return metadata.turn_exchange_id || metadata.working_turn_id || null;
  }

  /**
   * Returns the fixed viewport control used to display agent-turn stopwatch state.
   *
   * @returns {HTMLElement} Existing or newly created stopwatch element.
   */
  function ensureAgentStopwatchControl() {
    let control = document.getElementById(AGENT_STOPWATCH_ID);
    if (control) return control;
    control = document.createElement('div');
    control.id = AGENT_STOPWATCH_ID;
    control.style.position = 'fixed';
    control.style.top = '56px';
    control.style.right = '16px';
    control.style.zIndex = '2147483646';
    control.style.padding = '8px 10px';
    control.style.border = '1px solid rgba(127, 127, 127, 0.35)';
    control.style.borderRadius = '8px';
    control.style.background = 'rgba(32, 32, 32, 0.92)';
    control.style.color = '#f5f5f5';
    control.style.font = '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    control.style.whiteSpace = 'pre';
    control.style.pointerEvents = 'none';
    control.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.25)';
    (document.body || document.documentElement).append(control);
    return control;
  }

  /**
   * Renders the current completed and live lap state into the fixed stopwatch control.
   *
   * @param {number} nowMs - Current monotonic timestamp.
   * @returns {void} No value is returned.
   */
  function agentStopwatchRender(nowMs = performance.now()) {
    if (!agentStopwatchState) return;
    assert(Number.isFinite(nowMs), 'Agent stopwatch render timestamp must be finite.');
    const representedLapCount = agentStopwatchState.laps_ms.length +
      (agentStopwatchState.active ? 1 : 0);
    const showLapLines = representedLapCount > 1;
    const lines = showLapLines
      ? agentStopwatchState.laps_ms.map((duration, index) =>
        `Lap ${index + 1}: ${agentStopwatchFormatDuration(duration)}`
      )
      : [];
    let totalMs;
    if (agentStopwatchState.active) {
      assert(Number.isFinite(agentStopwatchState.lap_started_at_ms),
        'Active agent stopwatch must have a lap start timestamp.');
      assert(Number.isFinite(agentStopwatchState.started_at_ms),
        'Active agent stopwatch must have an overall start timestamp.');
      const current = Math.max(0, nowMs - agentStopwatchState.lap_started_at_ms);
      if (showLapLines) {
        lines.push(`Lap ${agentStopwatchState.laps_ms.length + 1}: ${agentStopwatchFormatDuration(current)}`);
      }
      totalMs = Math.max(0, nowMs - agentStopwatchState.started_at_ms);
    } else {
      assert(Number.isFinite(agentStopwatchState.total_ms),
        'Completed agent stopwatch must have a total duration.');
      totalMs = agentStopwatchState.total_ms;
    }

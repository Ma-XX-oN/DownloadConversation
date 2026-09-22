import fs from 'node:fs';

const path = 'chatgpt-conversation-markdown-export.user.js';
let text = fs.readFileSync(path, 'utf8');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function replaceExactlyOnce(oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  requireCondition(count === 1, `${label}: expected exactly one match, found ${count}`);
  text = text.replace(oldText, newText);
}

function functionSpan(source, name) {
  const needle = `  function ${name}(`;
  const start = source.indexOf(needle);
  requireCondition(start >= 0, `Function ${name} was not found.`);
  requireCondition(source.indexOf(needle, start + needle.length) < 0,
    `Function ${name} appeared more than once.`);
  const braceStart = source.indexOf('{', start + needle.length);
  requireCondition(braceStart >= 0, `Function ${name} has no body.`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? '';

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  throw new Error(`Function ${name} body did not terminate.`);
}

function replaceFunction(name, replacement) {
  const span = functionSpan(text, name);
  text = text.slice(0, span.start) + replacement + text.slice(span.end);
}

requireCondition(text.includes('// @version      1.5.0-issue.135.3'),
  'Expected issue #135 version 1.5.0-issue.135.3 before production patch.');
requireCondition(!text.includes('let agentSoundPendingTerminal = null;'),
  'Pending terminal state already exists; refusing to reapply patch.');

replaceExactlyOnce(
  "  /** AudioContext unlocked by a user gesture when terminal sounds are enabled. */\n  let agentSoundAudioContext = null;\n  /** Bounded stable turn identities that have already emitted a terminal sound. */",
  "  /** AudioContext unlocked by a user gesture when terminal sounds are enabled. */\n  let agentSoundAudioContext = null;\n  /** Newest undelivered terminal cue retained until a trusted audio-unlock gesture. */\n  let agentSoundPendingTerminal = null;\n  /** Bounded stable turn identities that have already emitted a terminal sound. */",
  'pending state insertion'
);

const rememberSpan = functionSpan(text, 'agentSoundRememberTerminalKey');
const helpers = `

  /**
   * Retains the newest terminal cue that could not start because browser audio was unavailable.
   *
   * @param {Object} terminal - Shared normalized terminal event.
   * @param {string} soundKey - Stable terminal sound-event key.
   * @returns {void} No value is returned.
   */
  function agentSoundRememberPendingTerminal(terminal, soundKey) {
    if (!terminal?.kind || !soundKey) return;
    agentSoundPendingTerminal = {
      kind: terminal.kind,
      terminal_key: terminal?.terminal_key ?? null,
      exchange_id: terminal?.exchange_id ?? null,
      sound_key: soundKey
    };
    logDiagnostic('debug', 'agent-sound-pending-retained', {
      kind: agentSoundPendingTerminal.kind,
      terminal_key: agentSoundPendingTerminal.terminal_key,
      exchange_id: agentSoundPendingTerminal.exchange_id,
      volume: agentSoundVolume,
      audio_context_state: agentSoundAudioContext?.state ?? 'absent'
    });
  }

  /**
   * Clears the single retained terminal cue.
   *
   * @param {string} reason - Diagnostic reason for clearing the pending cue.
   * @returns {void} No value is returned.
   */
  function agentSoundClearPendingTerminal(reason) {
    const pending = agentSoundPendingTerminal;
    if (!pending) return;
    agentSoundPendingTerminal = null;
    logDiagnostic('debug', 'agent-sound-pending-cleared', {
      kind: pending.kind,
      terminal_key: pending.terminal_key,
      reason
    });
  }

  /**
   * Replays the retained terminal cue after a trusted gesture has made Web Audio usable.
   *
   * @returns {boolean} True only when the pending cue starts playback and is consumed.
   */
  function agentSoundRetryPendingTerminal() {
    const pending = agentSoundPendingTerminal;
    if (!pending) return false;
    if (agentSoundVolume <= 0) {
      agentSoundClearPendingTerminal('volume-zero');
      return false;
    }
    if (agentSoundTerminalKeys.has(pending.sound_key)) {
      agentSoundClearPendingTerminal('already-delivered');
      return false;
    }
    if (!playAgentSound(pending.kind)) {
      logDiagnostic('debug', 'agent-sound-pending-replay-unavailable', {
        kind: pending.kind,
        terminal_key: pending.terminal_key,
        volume: agentSoundVolume,
        audio_context_state: agentSoundAudioContext?.state ?? 'absent'
      });
      return false;
    }
    agentSoundRememberTerminalKey(pending.sound_key);
    agentSoundClearPendingTerminal('replayed');
    logDiagnostic('debug', 'agent-sound-pending-replayed', {
      kind: pending.kind,
      terminal_key: pending.terminal_key,
      volume: agentSoundVolume,
      audio_context_state: agentSoundAudioContext?.state ?? 'absent'
    });
    return true;
  }`;
text = text.slice(0, rememberSpan.end) + helpers + text.slice(rememberSpan.end);

const unlockSpan = functionSpan(text, 'unlockAgentSoundAudio');
let unlockSource = text.slice(unlockSpan.start, unlockSpan.end);
const zeroBranch = "    if (volume <= 0) {\n      logDiagnostic('debug', 'agent-sound-audio-unlock', {";
requireCondition(unlockSource.includes(zeroBranch),
  'unlockAgentSoundAudio volume-zero branch did not match expected source.');
unlockSource = unlockSource.replace(
  zeroBranch,
  "    if (volume <= 0) {\n      agentSoundClearPendingTerminal('volume-zero');\n      logDiagnostic('debug', 'agent-sound-audio-unlock', {"
);
const readyReturn = '      return ready;';
requireCondition(unlockSource.split(readyReturn).length - 1 === 1,
  'unlockAgentSoundAudio ready return did not match exactly once.');
unlockSource = unlockSource.replace(
  readyReturn,
  "      if (ready) agentSoundRetryPendingTerminal();\n      return ready;"
);
text = text.slice(0, unlockSpan.start) + unlockSource + text.slice(unlockSpan.end);

const terminalReplacement = `  function agentSoundHandleTerminal(terminal) {
    const kind = terminal?.kind ?? null;
    const key = terminal?.terminal_key ?? null;
    const soundKey = key && kind ? \`\${key}:\${kind}\` : null;
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
        volume: agentSoundVolume
      });
      return;
    }
    if (agentSoundVolume <= 0) {
      agentSoundClearPendingTerminal('volume-zero');
      logDiagnostic('debug', 'agent-sound-volume-zero-suppressed', {
        kind,
        terminal_key: key,
        volume: agentSoundVolume
      });
      return;
    }
    if (agentSoundPendingTerminal) agentSoundClearPendingTerminal('superseded');
    if (!playAgentSound(kind)) {
      agentSoundRememberPendingTerminal(terminal, soundKey);
      return;
    }
    agentSoundRememberTerminalKey(soundKey);
  }`;
replaceFunction('agentSoundHandleTerminal', terminalReplacement);

replaceExactlyOnce(
  "      agentSoundVolume = Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;\n      localStorage.setItem(AGENT_SOUND_VOLUME_STORAGE_KEY, String(agentSoundVolume));",
  "      agentSoundVolume = Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;\n      if (agentSoundVolume <= 0) agentSoundClearPendingTerminal('volume-zero');\n      localStorage.setItem(AGENT_SOUND_VOLUME_STORAGE_KEY, String(agentSoundVolume));",
  'volume-zero pending clear'
);

requireCondition(text !== fs.readFileSync(path, 'utf8'), 'Patch made no changes.');
requireCondition(text.includes('function agentSoundRetryPendingTerminal()'),
  'Pending replay helper missing after patch.');
requireCondition(text.includes('if (ready) agentSoundRetryPendingTerminal();'),
  'Audio unlock does not own pending replay after patch.');
requireCondition(text.includes("agentSoundClearPendingTerminal('superseded')"),
  'Newer terminal does not supersede older pending cue after patch.');

fs.writeFileSync(path, text, 'utf8');

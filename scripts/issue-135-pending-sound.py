from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
USER_SCRIPT = ROOT / 'chatgpt-conversation-markdown-export.user.js'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_top_level_function(text, signature, replacement):
    pattern = re.compile(
        rf'  {re.escape(signature)} \{{[\s\S]*?\n  \}}(?=\n\n  /\*\*)'
    )
    text, count = pattern.subn(replacement.rstrip(), text, count=1)
    if count != 1:
        raise RuntimeError(f'{signature}: expected exactly one top-level function, found {count}')
    return text


text = USER_SCRIPT.read_text(encoding='utf-8')
if '// @version      1.5.0-issue.135.3' not in text:
    raise RuntimeError('unexpected development version; refusing to patch')
if 'let agentSoundPendingTerminal = null;' in text:
    raise RuntimeError('pending-sound production patch is already present')

text = replace_once(
    text,
    "  /** AudioContext unlocked by a user gesture when terminal sounds are enabled. */\n"
    "  let agentSoundAudioContext = null;\n"
    "  /** Bounded stable turn identities that have already emitted a terminal sound. */",
    "  /** AudioContext unlocked by a user gesture when terminal sounds are enabled. */\n"
    "  let agentSoundAudioContext = null;\n"
    "  /** Single undelivered terminal cue retained until the next successful trusted audio unlock. */\n"
    "  let agentSoundPendingTerminal = null;\n"
    "  /** Bounded stable turn identities that have already emitted a terminal sound. */",
    'pending state declaration'
)

helpers = r'''

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
'''

remember_pattern = re.compile(
    r'(  function agentSoundRememberTerminalKey\(key\) \{[\s\S]*?\n  \})(?=\n\n  /\*\*)'
)
text, count = remember_pattern.subn(lambda m: m.group(1) + helpers, text, count=1)
if count != 1:
    raise RuntimeError(f'agentSoundRememberTerminalKey insertion point: expected 1, found {count}')

unlock = r'''  async function unlockAgentSoundAudio() {
    const volume = agentSoundVolume;
    const beforeState = agentSoundAudioContext?.state ?? 'absent';
    if (volume <= 0) {
      agentSoundClearPendingTerminal();
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
      if (ready) agentSoundRetryPendingTerminal();
      return ready;
    } catch (error) {
      logDiagnostic('warnings', 'agent-sound-audio-unlock', {
        volume,
        before_state: beforeState,
        after_state: agentSoundAudioContext?.state ?? 'absent',
        resume_attempted: resumeAttempted,
        ready: false,
        error: errorMessage(error)
      });
      return false;
    }
  }'''
text = replace_top_level_function(text, 'async function unlockAgentSoundAudio()', unlock)

terminal = r'''  function agentSoundHandleTerminal(terminal) {
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
  }'''
text = replace_top_level_function(text, 'function agentSoundHandleTerminal(terminal)', terminal)

text = replace_once(
    text,
    "      if (agentSoundVolume > 0) void unlockAgentSoundAudio();\n    });",
    "      if (agentSoundVolume > 0) void unlockAgentSoundAudio();\n"
    "      else agentSoundClearPendingTerminal();\n"
    "    });",
    'volume input pending-clear hook'
)

USER_SCRIPT.write_text(text, encoding='utf-8')
print('patched', USER_SCRIPT)

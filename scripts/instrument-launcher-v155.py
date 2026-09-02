from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text(encoding='utf-8')

old = '// @version      0.6.154'
new = '// @version      0.6.155'
assert text.count(old) == 1, f'expected one {old!r}'
text = text.replace(old, new, 1)

old = '''    let previous = launcherLifecycleState(launcher);
    let mutationCount = 0;
    const relevantMutations = [];
    console.log(`[DownloadConversation v${VERSION}] launcher appended`, previous);
'''
new = '''    let previous = launcherLifecycleState(launcher);
    let mutationCount = 0;
    let disconnectedLogged = false;
    let timer = null;
    const relevantMutations = [];
    const recentMutations = [];
    console.log(`[DownloadConversation v${VERSION}] launcher appended`, previous);
'''
assert text.count(old) == 1, 'launcher state declarations not found exactly once'
text = text.replace(old, new, 1)

old = '''    const logDisconnected = (source, current) => {
      const payload = {
        version: VERSION,
        source,
        mutation_count: mutationCount,
        original_body_is_current_body: originalBody === document.body,
        previous,
        current,
        relevant_mutations: relevantMutations
      };
'''
new = '''    const logDisconnected = (source, current) => {
      if (disconnectedLogged) return;
      disconnectedLogged = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      const payload = {
        version: VERSION,
        source,
        mutation_count: mutationCount,
        original_body_is_current_body: originalBody === document.body,
        previous,
        current,
        relevant_mutations: relevantMutations,
        recent_mutations: recentMutations
      };
'''
assert text.count(old) == 1, 'logDisconnected payload block not found exactly once'
text = text.replace(old, new, 1)

old = '''      for (const record of records) {
        const summary = launcherMutationSummary(record, launcher, originalBody);
        if (summary.removes_launcher || summary.removes_original_body ||
            summary.target_is_original_body) relevantMutations.push(summary);
      }
'''
new = '''      for (const record of records) {
        const summary = launcherMutationSummary(record, launcher, originalBody);
        recentMutations.push(summary);
        if (recentMutations.length > 20) recentMutations.shift();
        if (summary.removes_launcher || summary.removes_original_body) {
          relevantMutations.push(summary);
        }
      }
'''
assert text.count(old) == 1, 'mutation retention block not found exactly once'
text = text.replace(old, new, 1)

old = '    const timer = setInterval(() => {\n'
new = '    timer = setInterval(() => {\n'
assert text.count(old) == 1, 'launcher timer declaration not found exactly once'
text = text.replace(old, new, 1)

old = '''      if (!current.connected) {
        logDisconnected('poll', current);
        clearInterval(timer);
        observer.disconnect();
        previous = current;
        return;
      }
'''
new = '''      if (!current.connected) {
        logDisconnected('poll', current);
        observer.disconnect();
        previous = current;
        return;
      }
'''
assert text.count(old) == 1, 'poll disconnection block not found exactly once'
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')

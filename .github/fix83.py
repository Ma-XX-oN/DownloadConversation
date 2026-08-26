from pathlib import Path
import json
import subprocess

p = Path('chatgpt-conversation-markdown-export.user.js')
s = p.read_text()
assert '// @version      0.6.131' in s
s = s.replace('// @version      0.6.131', '// @version      0.6.132', 1)
start = s.index('  function apiRecordsJsonl(spine) {')
end = s.index('\n  function progressStatus(', start)
replacement = '''  function conversationMetadataJsonlRecord(conversationId) {
    assert(typeof conversationId === 'string' && conversationId.trim(), 'Conversation ID is required for JSONL export metadata.');
    return {
      record_type: 'chatgpt_conversation_metadata',
      schema_version: 1,
      conversation_id: conversationId.trim()
    };
  }

  function apiRecordsJsonl(spine, conversationId = currentConversationId()) {
    const metadata = conversationMetadataJsonlRecord(conversationId);
    const records = [metadata, ...spine.records.map(record => record.message)];
    return `${records.map(record => JSON.stringify(record)).join('\\n')}\\n`;
  }
'''
s = s[:start] + replacement + s[end:]
p.write_text(s)

subprocess.run(['node', '--check', str(p)], check=True)
s = p.read_text()
assert '// @version      0.6.132' in s
assert "record_type: 'chatgpt_conversation_metadata'" in s
assert 'schema_version: 1' in s
assert 'conversation_id: conversationId.trim()' in s
assert 'const records = [metadata, ...spine.records.map(record => record.message)];' in s
assert 'apiRecordsJsonl(spine, conversationId = currentConversationId())' in s
metadata = {
  'record_type': 'chatgpt_conversation_metadata',
  'schema_version': 1,
  'conversation_id': 'conv-123',
}
messages = [{'id': 'u1'}, {'id': 'a1'}]
lines = [json.dumps(metadata), *[json.dumps(message) for message in messages]]
parsed = [json.loads(line) for line in lines]
assert parsed[0]['record_type'] == 'chatgpt_conversation_metadata'
assert parsed[0]['conversation_id'] == 'conv-123'
assert parsed[1:] == messages

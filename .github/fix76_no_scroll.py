from pathlib import Path

path = Path('chatgpt-conversation-markdown-export.user.js')
text = path.read_text()
assert '// @version      0.6.130' in text
text = text.replace('// @version      0.6.130', '// @version      0.6.131', 1)

old = '''          let section = mountedTurnSection(record.id, 'user');
          if (!(section instanceof HTMLElement)) {
            const target = resolveJumpIdentifier(spine, record.id);
            target.spine = spine;
            section = await jumpToResolvedTarget(target);
          }
'''
new = '''          const section = mountedTurnSection(record.id, 'user');
          if (!(section instanceof HTMLElement)) {
            logDiagnostic('debug', 'conversation-image-dom-recovery-skipped', {
              message_id: record.id,
              reason: 'turn-not-mounted',
              expected_image_count: expected
            });
            throw new Error(`Turn ${record.id} is not mounted; DOM image recovery skipped to avoid scrolling.`);
          }
'''
assert old in text
text = text.replace(old, new, 1)

old_catch = '''        } catch (error) {
          logDiagnostic('warnings', 'conversation-image-turn-recovery-failure', {
            message_id: record.id,
            expected_image_count: expected,
            message: error instanceof Error ? error.message : String(error)
          });
        }
        recovered.set(record.id, images);
'''
new_catch = '''        } catch (error) {
          logDiagnostic('warnings', 'conversation-image-turn-recovery-failure', {
            message_id: record.id,
            expected_image_count: expected,
            message: error instanceof Error ? error.message : String(error)
          });
          for (let index = 0; index < expected; index += 1) {
            images[index] = await cgResolveImagePointerMarkdown(expectedParts[index], record.id, index + 1);
          }
        }
        recovered.set(record.id, images);
'''
assert old_catch in text
text = text.replace(old_catch, new_catch, 1)

path.write_text(text)

from pathlib import Path

SOURCE_PATH = Path('chatgpt-conversation-markdown-export.user.js')
CONTROLS_TEST_PATH = Path('tests/communication-log-file-controls.test.mjs')
RESET_TEST_PATH = Path('tests/communication-log-reset.test.mjs')

RESET_ICON_BASE64 = (
  'iVBORw0KGgoAAAANSUhEUgAAAC8AAAAvCAYAAABzJ5OsAAAF9ElEQVR4nO1Y'
  'TahdVxX+1t7n3HPuuzGx1rY4SAYiJoPGpP5gUVSkA1EnOggiOCm06EScSEHE'
  'iRMH4kARBBEcOIsFQYigo+hElJumtNWWpzRpS7V59Nn37tl/59y99+cg56T3'
  'Je8l970mvie8DzZczvnO2t9ae629177AIfYHshsySQVAAeAwRIT3Qtgy2JX4'
  'ZUFStrF91x1dSjxJJSLZWvutuq4fCiFc0lr/fW1t7eqJEyd8L1b19tJOInue'
  'BpB7zr1ftSGSxpgX2cM516WUXjXGfHcb/rEQwkljzFljzNkQwgdJvnsbnu5t'
  '7wnFMsJFhLPZ7AEA72vbNsYYQVIppY6LyDpJ1bbt50XkcyQ/6r1/P8n3lmWp'
  'ASDGmEII686550Xk2ZzzryeTyV9EJA1ODL/vKkhqAJjNZp9KKdEYk621tNZm'
  '731njPmx9/5PXdcNi8K2bemcozGG1loaY1II4cZ7Y4zvum5qjHl8dXW1Wpxn'
  'N7jjkpEsRCQ2TfPNI0eO/MRaG0WkePs1WxEBybmIjElqpZTknJOIaAAQEeSc'
  '2T+PIiJlWeoYI4qieD6l9O3xePyHfjdburDVsl5qrc/s4LxWStUAJkqpQkRm'
  'JC+LyBWlVBaRTPIlEbkG4I2yLAutte66bp5zbouiOD0ajX7vnPueiGQAsmwd'
  'LCN+yMXTACAiWwyLSJFz3gBwNef82sAfjUYfqOta1XWttNanABiS6ySbGONf'
  'RaTRWlfOuei9z+Px+Pve+1/txoHbEoZi3djYeE9RFC+XZXlsPp/zZgdINgDG'
  'AHJRFKOUUgbwFaXUfwBIznmC61vkJ3LOX9Naj0i+AOBUXdcPeu+ziMSVlZWR'
  'c+7nk8nk6++4iM+fP68BwFr7aIxxsVi3jBACnXNDkeb5fJ6bpjm9nc22bR8O'
  'IfwyhBC6rmPTNFe89/Te0xgTSHI2mz3VB+W2RXzbtDl37twQ4Ue01sDbKbQF'
  'KSWQBEkASEVRiIh8hKReXV2t+v1ck1RVV1Q1/XjKaWvzufzi2VZguTrOec1'
  'rfUohBDruv7B5ubmoyKSbufAHfd5ABCRh3POt+wAvK52cQwOFiRP9pPL4vKT'
  'VJcuXdKTyeQ33vvLInIRwFs553lRFPd3XSdVVamiKH5E8jMA8jsSn1LaUEoJ'
  'gNhHFwCU1lqVZSn9qmyxqZQ6Pui9KRAZQJ5Op+V4PL66sbHxWFVVl6qqqpRS'
  'WilF59xMa33GOfeFyWTy2z3lP0lFUpxzJ0II/+ICcs601gZr7VVr7R+dc79w'
  'zj0VQvgSyQ9tbm7efyf70+m0BIDZbPZESqlrmubPzrk3vfe+bdsrTdM8PejY'
  '7vtlDikREa6vrx8/evTokzHGGsBLWut/lmX5CoA3RKTdVVS22i8AZGPMT0ej'
  '0WMxRqu1PpVzfl1rTQBfrqrqb0NzuJcJ7rSlKpJFP/SwYkvaVgDQtu3ZEMI/'
  'nHMvOuectTb1rcR3FpzcgmULlgsXkRvzDmPI42VsbWM796v7rLV2tSiKz8YY'
  'KxFh13VvicjJnnqL/aXbAxHJIhIXRuqf3Y2eXPUOXCyKYk7yFVzv+QsAHydZ'
  'Dk7uSfy9hogwpfQMyQ7AqwBijPEIgIeccw8MtMVvDox4ACAZReQ+EfkwyVHO'
  'mWVZ3kfywe34S+X8/woiUvZ7/btI3mild+IfqMhrrducc04pOZJpuAPsxD9Q'
  '4nPOx0huAngOQKeU4nw+3xCRN7fjHxTxAgBKqUcAvCwiI6XUSGu9DuDfKysr'
  'az1vSwodlJxPJJVz7pMkT4nIKOcMrfUKgOdEpNvuhN33yPeiaK09q5RaizE+'
  'rZTyALqyLCcicrmn3qL1QER+Op2WIvINAGdItgBGIjILIbQppQs9bU8n+D3D'
  '0NdYaz/mvX/Nez/13m8aY9qu61zTNL9b5N2MfU2b4ci/cOHCMwCeEBGp6/qo'
  'UmozxriulPrZQN1PnUvh2rVrR9q2/WF/V5iSlJ2ifqCweFcNIXxxNpt9un9+'
  '8MUD1+8Ne/nb70BhuNDst45DHOIQhzjEIQ7xf4f/AvHrLnXbKeMKAAAAAElF'
  'TkSuQmCC'
)


def replace_once(text, old, new, label):
  count = text.count(old)
  if count != 1:
    raise SystemExit(f'{label}: expected exactly one match, found {count}')
  return text.replace(old, new, 1)


source = SOURCE_PATH.read_text(encoding='utf-8')
source = replace_once(
  source,
  '// @version      1.2.0-issue.134.2',
  '// @version      1.2.0-issue.134.3',
  'version')

check_icon = '''  function checkIconMarkup() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7"></path></svg>';
  }
'''
icon_helpers = check_icon + f'''
  /**
   * Returns the approved branching Duplicate action icon.
   *
   * @returns {{string}} Inline SVG markup for the Duplicate button.
   */
  function duplicateIconMarkup() {{
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="8" width="6" height="8" rx="1.5"></rect><rect x="16.5" y="2" width="6" height="7" rx="1.5"></rect><rect x="16.5" y="15" width="6" height="7" rx="1.5"></rect><path d="M7.5 12h3c2.8 0 2.8-6.5 6-6.5"></path><path d="M7.5 12h3c2.8 0 2.8 6.5 6 6.5"></path><path d="m14.5 4 2 1.5-2 1.5"></path><path d="m14.5 17 2 1.5-2 1.5"></path></svg>';
  }}

  /**
   * Returns the AgentPanelSpeaker config-reset icon using its exact PNG bytes.
   *
   * @returns {{string}} Inline image markup for the Reset button.
   */
  function resetIconMarkup() {{
    return '<img src="data:image/png;base64,{RESET_ICON_BASE64}" alt="" aria-hidden="true">';
  }}
'''
source = replace_once(source, check_icon, icon_helpers, 'icon helpers')

source = replace_once(
  source,
  '      #${PANEL_ID} .tm-log-name-viewport{flex:1 1 auto;min-width:0;overflow:hidden;border:1px solid #666;border-radius:9px;background:#292929;color:#fff;box-sizing:border-box}\n',
  '      #${PANEL_ID} .tm-log-name-viewport{flex:1 1 auto;min-width:0;overflow:hidden;color:#fff;box-sizing:border-box}\n',
  'plain filename viewport')
source = replace_once(
  source,
  '      #${PANEL_ID} .tm-log-name-text{display:block;width:max-content;min-width:100%;box-sizing:border-box;padding:9px 12px;white-space:nowrap;transform:translateX(0);transition:transform var(--tm-log-name-duration,1.5s) linear .35s}\n',
  '      #${PANEL_ID} .tm-log-name-text{display:block;width:max-content;min-width:100%;box-sizing:border-box;padding:7px 0;white-space:nowrap;transform:translateX(0);transition:transform var(--tm-log-name-duration,1.5s) linear .35s}\n',
  'plain filename padding')
source = replace_once(
  source,
  '      #${PANEL_ID} .tm-icon-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}\n',
  '      #${PANEL_ID} .tm-icon-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}\n'
  '      #${PANEL_ID} .tm-icon-button img{width:16px;height:16px;display:block;object-fit:contain}\n',
  'icon image sizing')

old_markup = '''      <div class="tm-row tm-communication-log-row"><div class="tm-log-name-viewport" data-role="communication-log-name-viewport" role="textbox" aria-readonly="true" aria-label="Current communication log filename" title="Current communication log filename"><span class="tm-log-name-text" data-role="communication-log-name"></span></div><button data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log">✎</button><button data-role="duplicate-communication-log" type="button">Duplicate</button></div>
      <div class="tm-row"><button data-role="reset-communication-log" type="button">Reset log</button></div>'''
new_markup = '''      <div class="tm-row tm-communication-log-row"><div class="tm-log-name-viewport" data-role="communication-log-name-viewport" role="textbox" aria-readonly="true" aria-label="Current communication log filename" title="Current communication log filename"><span class="tm-log-name-text" data-role="communication-log-name"></span></div><button data-role="rename-communication-log" type="button" aria-label="Rename communication log" title="Rename communication log">✎</button><button class="tm-icon-button" data-role="duplicate-communication-log" type="button" aria-label="Duplicate communication log" title="Duplicate communication log"></button></div>
      <div class="tm-row"><button class="tm-icon-button" data-role="reset-communication-log" type="button" aria-label="Reset communication log" title="Reset communication log"></button></div>'''
source = replace_once(source, old_markup, new_markup, 'communication action markup')

old_lookup = '''    const communicationLogNameViewport = panel.querySelector('[data-role="communication-log-name-viewport"]');
    const renameCommunicationLogButton = panel.querySelector('[data-role="rename-communication-log"]');
    const duplicateCommunicationLogButton = panel.querySelector('[data-role="duplicate-communication-log"]');
    communicationLogNameViewport?.addEventListener('pointerenter', refreshCommunicationLogNameOverflow);'''
new_lookup = '''    const communicationLogNameViewport = panel.querySelector('[data-role="communication-log-name-viewport"]');
    const renameCommunicationLogButton = panel.querySelector('[data-role="rename-communication-log"]');
    const duplicateCommunicationLogButton = panel.querySelector('[data-role="duplicate-communication-log"]');
    if (duplicateCommunicationLogButton) duplicateCommunicationLogButton.innerHTML = duplicateIconMarkup();
    communicationLogNameViewport?.addEventListener('pointerenter', refreshCommunicationLogNameOverflow);'''
source = replace_once(source, old_lookup, new_lookup, 'duplicate icon initialization')

old_duplicate = '''    duplicateCommunicationLogButton?.addEventListener('click', () => {
      if (duplicateCommunicationLogButton.disabled || !communicationLogFileName) return;
      duplicateCommunicationLogButton.disabled = true;
      renameCommunicationLogButton.disabled = true;
      duplicateCommunicationLogButton.textContent = 'Duplicating…';
      void communicationLogDuplicate()
        .then(duplicateName => {
          setStatus(`Communication log duplicated as ${duplicateName}.`);
        })
        .catch(error => {
          setStatus(`⚠ Communication log duplicate failed: ${error?.message ?? String(error)}`);
        })
        .finally(() => {
          duplicateCommunicationLogButton.textContent = 'Duplicate';
          refreshStatus();
        });
    });'''
new_duplicate = '''    duplicateCommunicationLogButton?.addEventListener('click', () => {
      if (duplicateCommunicationLogButton.disabled || !communicationLogFileName) return;
      duplicateCommunicationLogButton.disabled = true;
      renameCommunicationLogButton.disabled = true;
      duplicateCommunicationLogButton.setAttribute('aria-label', 'Duplicating communication log');
      duplicateCommunicationLogButton.title = 'Duplicating…';
      void communicationLogDuplicate()
        .then(duplicateName => {
          setStatus(`Communication log duplicated as ${duplicateName}.`);
        })
        .catch(error => {
          setStatus(`⚠ Communication log duplicate failed: ${error?.message ?? String(error)}`);
        })
        .finally(() => {
          duplicateCommunicationLogButton.setAttribute('aria-label', 'Duplicate communication log');
          duplicateCommunicationLogButton.title = 'Duplicate communication log';
          refreshStatus();
        });
    });'''
source = replace_once(source, old_duplicate, new_duplicate, 'duplicate busy state')

old_reset_start = '''    const resetCommunicationLogButton = panel.querySelector('[data-role="reset-communication-log"]');
    resetCommunicationLogButton?.addEventListener('click', () => {'''
new_reset_start = '''    const resetCommunicationLogButton = panel.querySelector('[data-role="reset-communication-log"]');
    if (resetCommunicationLogButton) resetCommunicationLogButton.innerHTML = resetIconMarkup();
    resetCommunicationLogButton?.addEventListener('click', () => {'''
source = replace_once(source, old_reset_start, new_reset_start, 'reset icon initialization')
source = replace_once(
  source,
  "      resetCommunicationLogButton.textContent = 'Resetting…';",
  "      resetCommunicationLogButton.setAttribute('aria-label', 'Resetting communication log');\n      resetCommunicationLogButton.title = 'Resetting…';",
  'reset busy state')
source = replace_once(
  source,
  "          resetCommunicationLogButton.textContent = 'Reset log';",
  "          resetCommunicationLogButton.setAttribute('aria-label', 'Reset communication log');\n          resetCommunicationLogButton.title = 'Reset communication log';",
  'reset restore state')

SOURCE_PATH.write_text(source, encoding='utf-8')

controls = CONTROLS_TEST_PATH.read_text(encoding='utf-8')
controls = replace_once(
  controls,
  r'/@version\s+1\.2\.0-issue\.134\.2/',
  r'/@version\s+1\.2\.0-issue\.134\.3/',
  'controls version assertion')
controls = replace_once(
  controls,
  r'''  assert.match(userscript, /data-role="duplicate-communication-log"[^>]*>Duplicate<\/button>/);''',
  r'''  assert.match(userscript, /class="tm-icon-button" data-role="duplicate-communication-log"[^>]*aria-label="Duplicate communication log"/);''',
  'controls duplicate assertion')
CONTROLS_TEST_PATH.write_text(controls, encoding='utf-8')

reset_test = RESET_TEST_PATH.read_text(encoding='utf-8')
reset_test = replace_once(
  reset_test,
  r'''    /<button data-role="reset-communication-log" type="button">Reset log<\/button>/);''',
  r'''    /<button class="tm-icon-button" data-role="reset-communication-log"[^>]*aria-label="Reset communication log"/);''',
  'reset markup assertion')
RESET_TEST_PATH.write_text(reset_test, encoding='utf-8')

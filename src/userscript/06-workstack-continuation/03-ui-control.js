  // BEGIN Issue #163 WorkStack continuation UI/transaction
  /** Root observer that refreshes WorkStack UI across ChatGPT SPA changes. */
  let workStackRootObserver = null;
  /** Resize observer that keeps WorkStack below the independent stopwatch. */
  let workStackStopwatchResizeObserver = null;
  /** Stopwatch element currently observed for WorkStack positioning. */
  let workStackObservedStopwatch = null;

  /**
   * Returns the WorkStack lane-board URL used by the lane picker.
   *
   * @returns {string} GitHub board URL opened with browser credentials.
   */
  function workStackRepoUrl() {
    return 'https://github.com/Ma-XX-oN/WorkStack/blob/main/parallel/BOARD.md';
  }

  /**
   * Builds the browser URL for one WorkStack lane description directory.
   *
   * @param {string} lane - Bound WorkStack lane identifier.
   * @returns {string} GitHub lane directory URL for the browser session.
   */
  function workStackLaneDescriptionUrl(lane) {
    const root = [
      'https://github.com/Ma-XX-oN/WorkStack/tree/main/',
      'parallel/lanes/'
    ].join('');
    return `${root}${encodeURIComponent(lane)}`;
  }

  /**
   * Reports whether a URL is a real pre-first-message ChatGPT landing page.
   *
   * @param {string} href - Current ChatGPT URL.
   * @returns {boolean} True only for generic or Project new-chat landings.
   */
  function workStackIsBrandNewChatLocation(href) {
    try {
      const path = new URL(href).pathname;
      if (path === '/') return true;
      return /^\/g\/g-p-[^/]+\/project\/?$/.test(path);
    } catch {
      return false;
    }
  }

  /**
   * Resolves the visible WorkStack control mode from route and lane state.
   *
   * @param {string|null} conversationId - Current conversation identifier.
   * @param {string} status - Current lane state.
   * @param {string} href - Current browser URL.
   * @returns {string} `picker`, `fetching`, `bound`, `unbound`, or `hidden`.
   */
  function workStackControlMode(conversationId, status, href) {
    if (!conversationId) {
      return workStackIsBrandNewChatLocation(href) ? 'picker' : 'hidden';
    }
    if (status === 'bound' || status === 'unbound') return status;
    return 'fetching';
  }

  /**
   * Opens WorkStack so a user can review available lane definitions.
   *
   * @returns {Window|null} Browser context returned by `window.open()`.
   */
  function workStackOpenLanePicker() {
    return window.open(workStackRepoUrl(), '_blank', 'noopener');
  }

  /**
   * Opens the bound lane's WorkStack description without starting CONTINUE.
   *
   * @param {string} lane - Bound WorkStack lane identifier.
   * @returns {Window|null} Browser context returned by `window.open()`.
   */
  function workStackOpenLaneDescription(lane) {
    return window.open(
      workStackLaneDescriptionUrl(lane),
      '_blank',
      'noopener'
    );
  }

  /**
   * Installs scoped WorkStack hover/focus styles exactly once.
   *
   * @returns {void} No value is returned.
   */
  function ensureWorkStackStyles() {
    const styleId = `${WORKSTACK_CONTROL_ID}-style`;
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
#${WORKSTACK_CONTROL_ID} {
  gap: 0;
}
#${WORKSTACK_CONTROL_ID} [data-role="workstack-lane"] {
  appearance: none;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
}
#${WORKSTACK_CONTROL_ID} .workstack-lane-link:not(:disabled) {
  cursor: pointer;
}
#${WORKSTACK_CONTROL_ID} [data-role="workstack-continue"] {
  box-sizing: border-box;
  max-width: 0;
  margin-left: 0;
  padding-left: 0;
  padding-right: 0;
  border-left-width: 0;
  border-right-width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  white-space: nowrap;
  transition: max-width 160ms ease, opacity 120ms ease,
    margin-left 160ms ease, padding 160ms ease,
    border-width 160ms ease;
}
#${WORKSTACK_CONTROL_ID}[data-mode="bound"]:hover
  [data-role="workstack-continue"],
#${WORKSTACK_CONTROL_ID}[data-mode="bound"]:focus-within
  [data-role="workstack-continue"] {
  max-width: 8rem;
  margin-left: 8px;
  padding-left: 7px;
  padding-right: 7px;
  border-left-width: 1px;
  border-right-width: 1px;
  opacity: 1;
  pointer-events: auto;
}
`;
    document.head?.append(style);
  }

  /**
   * Observes stopwatch geometry so WorkStack stays immediately below it.
   *
   * @param {HTMLElement} control - Mounted WorkStack control to reposition.
   * @returns {void} No value is returned.
   */
  function workStackObserveStopwatch(control) {
    if (typeof ResizeObserver !== 'function') return;
    const stopwatch = document.getElementById(AGENT_STOPWATCH_ID);
    if (stopwatch === workStackObservedStopwatch) return;
    workStackStopwatchResizeObserver?.disconnect();
    workStackObservedStopwatch = stopwatch instanceof HTMLElement
      ? stopwatch
      : null;
    if (!workStackObservedStopwatch) return;
    workStackStopwatchResizeObserver = new ResizeObserver(() => {
      workStackPositionControl(control);
    });
    workStackStopwatchResizeObserver.observe(workStackObservedStopwatch);
  }

  /**
   * Positions WorkStack below the stopwatch without lifecycle coupling.
   *
   * @param {HTMLElement} control - WorkStack control element to position.
   * @returns {void} No value is returned.
   */
  function workStackPositionControl(control) {
    const stopwatch = document.getElementById(AGENT_STOPWATCH_ID);
    const rect = stopwatch?.getBoundingClientRect?.() ?? null;
    control.style.top = `${Math.round(rect?.bottom ?? 108) + 8}px`;
    control.style.right = '16px';
  }

  /**
   * Creates the compact WorkStack control and returns the mounted element.
   *
   * @returns {HTMLElement|null} Mounted control, or null before BODY exists.
   */
  function ensureWorkStackControl() {
    if (!document.body) return null;
    ensureWorkStackStyles();
    const existing = document.getElementById(WORKSTACK_CONTROL_ID);
    if (existing instanceof HTMLElement) {
      workStackObserveStopwatch(existing);
      workStackPositionControl(existing);
      return existing;
    }

    const control = document.createElement('div');
    control.id = WORKSTACK_CONTROL_ID;
    control.style.position = 'fixed';
    control.style.zIndex = '2147483646';
    control.style.display = 'flex';
    control.style.alignItems = 'center';
    control.style.padding = '6px 8px';
    control.style.border = '1px solid rgba(255,255,255,.28)';
    control.style.borderRadius = '9px';
    control.style.background = 'rgba(24,24,24,.96)';
    control.style.color = '#fff';
    control.style.font = '12px/1.25 system-ui, sans-serif';
    control.style.boxShadow = '0 2px 8px rgba(0,0,0,.35)';
    control.style.pointerEvents = 'auto';
    control.dataset.state = workStackState.status;
    control.setAttribute('aria-label', 'WorkStack continuation');

    const mode = workStackControlMode(
      workStackState.conversation_id,
      workStackState.status,
      location.href
    );
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'workstack-lane-link';
    label.dataset.role = 'workstack-lane';
    label.textContent = mode === 'picker'
      ? 'WS: PICK LANE'
      : (workStackState.status === 'unbound'
          ? 'WS: UNBOUND'
          : (workStackState.status === 'bound'
              ? `WS: ${workStackState.lane}`
              : 'WS: FETCHING...'));
    label.addEventListener('click', () => {
      const currentMode = workStackControlMode(
        workStackState.conversation_id,
        workStackState.status,
        location.href
      );
      if (currentMode === 'bound' && workStackState.lane) {
        workStackOpenLaneDescription(workStackState.lane);
        return;
      }
      if (currentMode === 'picker' || currentMode === 'unbound') {
        workStackOpenLanePicker();
      }
    });
    control.append(label);

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.role = 'workstack-continue';
    button.textContent = 'CONTINUE';
    button.title = 'Prepare WorkStack handoff: copy tail, export Markdown, ' +
      'and open the continuation.';
    button.disabled = workStackState.status !== 'bound' ||
      workStackState.handoff_in_progress;
    button.style.padding = '4px 7px';
    button.style.borderRadius = '6px';
    button.style.border = '1px solid rgba(255,255,255,.35)';
    button.style.background = 'transparent';
    button.style.color = 'inherit';
    button.style.cursor = 'pointer';
    button.addEventListener('click', () => {
      void handleWorkStackContinue();
    });
    control.append(button);

    const detail = document.createElement('span');
    detail.dataset.role = 'workstack-detail';
    detail.style.display = 'none';
    control.append(detail);

    document.body.append(control);
    workStackObserveStopwatch(control);
    workStackPositionControl(control);
    return control;
  }

  /**
   * Renders WorkStack lane/handoff state without changing stopwatch state.
   *
   * @returns {void} No value is returned.
   */
  function workStackRender() {
    const control = ensureWorkStackControl();
    if (!control) return;
    const mode = workStackControlMode(
      workStackState.conversation_id,
      workStackState.status,
      location.href
    );
    control.style.display = mode === 'hidden' ? 'none' : 'flex';
    control.dataset.state = workStackState.status;
    control.dataset.mode = mode;

    const label = control.querySelector('[data-role="workstack-lane"]');
    const button = control.querySelector('[data-role="workstack-continue"]');
    const detail = control.querySelector('[data-role="workstack-detail"]');
    const nextLabel = mode === 'picker'
      ? 'WS: PICK LANE'
      : (workStackState.status === 'bound'
          ? `WS: ${workStackState.lane}`
          : (workStackState.status === 'unbound'
              ? 'WS: UNBOUND'
              : 'WS: FETCHING...'));

    if (label) {
      if (label.textContent !== nextLabel) label.textContent = nextLabel;
      label.disabled = mode === 'fetching' || mode === 'hidden';
      if (mode === 'bound') {
        label.title = 'Open this WorkStack lane description.';
      } else if (mode === 'picker' || mode === 'unbound') {
        label.title = 'Open WorkStack to review available lanes.';
      } else {
        label.title = 'Recovering WorkStack lane from the first message.';
      }
    }

    if (button) {
      button.disabled = mode !== 'bound' ||
        workStackState.handoff_in_progress;
    }
    if (detail) {
      const nextDetail = workStackState.handoff_in_progress
        ? 'working…'
        : workStackState.detail;
      if (detail.textContent !== nextDetail) {
        detail.textContent = nextDetail;
      }
      detail.style.display = nextDetail ? 'inline' : 'none';
    }
    workStackObserveStopwatch(control);
    workStackPositionControl(control);
  }

  /**
   * Installs the SPA-safe WorkStack UI and recovery observer exactly once.
   *
   * @returns {void} No value is returned.
   */
  function installWorkStackContinuation() {
    if (workStackRootObserver) return;
    workStackObserveConversation(currentConversationId());
    workStackRender();
    void recoverWorkStackLane();
    workStackRootObserver = new MutationObserver(() => {
      const conversationId = currentConversationId();
      workStackObserveConversation(conversationId);
      workStackRender();
      if (
        conversationId &&
        workStackState.status === 'fetching'
      ) {
        void recoverWorkStackLane();
      }
    });
    workStackRootObserver.observe(
      document.documentElement,
      { childList: true, subtree: true }
    );
  }
  // END Issue #163 WorkStack continuation UI/control

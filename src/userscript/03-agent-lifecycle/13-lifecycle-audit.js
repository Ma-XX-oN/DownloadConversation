  /** Lifecycle transitions and consumer outcomes are retained at every diagnostic level. */
  let agentLifecycleState = 'unknown';
  let agentLifecycleTransitionSequence = 0;
  let agentLifecycleTransitionId = null;

  function agentLifecycleTransition(nextState, details = {}) {
    if (agentLifecycleState === nextState) return agentLifecycleTransitionId;
    const previousState = agentLifecycleState;
    agentLifecycleState = nextState;
    agentLifecycleTransitionId = ++agentLifecycleTransitionSequence;
    logDiagnostic('lifecycle', 'agent-lifecycle-state-changed', {
      transition_id: agentLifecycleTransitionId,
      previous_state: previousState,
      state: nextState,
      ...details
    });
    return agentLifecycleTransitionId;
  }

  /** Records a consumer action against the transition that initiated it. */
  function agentLifecycleAction(component, action, details = {}, transitionId = agentLifecycleTransitionId) {
    logDiagnostic('lifecycle', 'agent-lifecycle-action', {
      transition_id: transitionId,
      component,
      action,
      ...details
    });
  }

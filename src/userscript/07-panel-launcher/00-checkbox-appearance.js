
  /**
   * Installs host-isolation styling for native recorder checkboxes.
   *
   * ChatGPT may style native form controls globally. Recorder-owned checkboxes
   * retain native state and accessibility while explicitly restoring their basic
   * appearance and visibility inside the recorder panel.
   *
   * @returns {void} No value is returned.
   */
  function injectRecorderCheckboxStyles() {
    const styleId = `${PANEL_ID}-checkbox-style`;
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${PANEL_ID} input[type="checkbox"]{
        -webkit-appearance:checkbox!important;
        appearance:auto!important;
        display:inline-block!important;
        position:static!important;
        visibility:visible!important;
        opacity:1!important;
        box-sizing:border-box!important;
        flex:0 0 auto!important;
        width:13px!important;
        height:13px!important;
        margin:0!important
      }
    `;
    (document.head || document.documentElement)?.append(style);
  }

  injectRecorderCheckboxStyles();

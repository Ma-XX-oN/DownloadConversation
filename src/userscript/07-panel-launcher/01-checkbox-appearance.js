
  /**
   * Installs a small host-isolation stylesheet for native recorder checkboxes.
   *
   * ChatGPT's page styles may restyle native form controls globally. The recorder
   * owns these controls, so their basic native appearance and visibility must not
   * depend on host CSS. State and accessibility remain native input behaviour.
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

          }
          if (capturePromise && generationResponse) {
            void capturePromise.then(capture => {
              if (!capture) {
                const cancelPromise = generationResponse.body?.cancel?.();
                if (cancelPromise && typeof cancelPromise.catch === 'function') {
                  void cancelPromise.catch(() => {});
                }
                return;
              }
              void captureGenerationStreamResponse(generationResponse, capture, !stockBodyObserved);
            });
          }
          return response;
        }, error => {
          logDiagnostic('debug', 'stock-network-fetch-failed', {
            network_sequence: stockTrace.sequence,
            method: stockTrace.method,
            url: stockTrace.url,
            duration_ms: Math.round(performance.now() - stockTrace.started_at),
            error: boundedDiagnosticText(errorMessage(error), 1000)
          });
          throw error;
        });
      };
    }

    // Retain the page-realm XHR constructor whose prototype is patched for capture.
    const XHR = pageWindow.XMLHttpRequest;
    if (XHR?.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      const originalSetRequestHeader = XHR.prototype.setRequestHeader;
      XHR.prototype.open = function(method, url, ...rest) {
        this.__tmApiRequest = { method: String(method), url: String(url), headers: {} };
        return originalOpen.call(this, method, url, ...rest);
      };
      XHR.prototype.setRequestHeader = function(name, value) {
        if (this.__tmApiRequest) {
          const key = String(name).toLowerCase();
          const prior = this.__tmApiRequest.headers[key];
          this.__tmApiRequest.headers[key] = prior ? `${prior}, ${value}` : String(value);
        }
        return originalSetRequestHeader.call(this, name, value);
      };
      XHR.prototype.send = function(body) {
        const info = this.__tmApiRequest || { method: 'GET', url: '', headers: {} };
        const stockTrace = stockNetworkTraceXhrStart(this, info);
        void communicationLogXhrRequest(info, body, stockTrace)
          .catch(communicationError => communicationLogReportFailure('xhr-request', communicationError));
        // XHR progress events are inbound data observation without body access.
        this.addEventListener('progress', () => {
          if (typeof nativeReceiptCapture === 'function') nativeReceiptCapture({
            transport: 'xhr', direction: 'incoming', phase: 'body_chunk',
            captured_at_epoch_ms: Date.now()
          });
        });
        this.addEventListener('loadend', () => {
          const incomingAt = Date.now();
          stockTrace.incoming_received_epoch_ms = incomingAt;
          // loadend also fires for abort/network failures with HTTP status zero.
          if (Number.isInteger(this.status) && this.status >= 100 &&
              typeof nativeReceiptCapture === 'function') nativeReceiptCapture({
            transport: 'xhr', direction: 'response', status: this.status,
            captured_at_epoch_ms: incomingAt
          });
          stockNetworkTraceXhrResponse(this, stockTrace);
          void communicationLogXhrResponse(this, stockTrace)
            .catch(communicationError => communicationLogReportFailure('xhr-response', communicationError));
        }, { once: true });
        rememberApiRequestContext(info.url, info.headers);
        recordClickDiagnosticNetworkRequest(info.url, 'xmlhttprequest');
        return originalSend.call(this, body);
      };
    }

    if (typeof pageWindow.WebSocket === 'function') {
      const NativeWebSocket = pageWindow.WebSocket;
      pageWindow.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
          const socket = Reflect.construct(target, args, target);
          const socketUrl = String(args[0] ?? '');
          const nativeSend = socket.send;
          socket.send = function(data) {
            void communicationLogWebSocketSend(socketUrl, data)
              .catch(communicationError => communicationLogReportFailure('websocket-send', communicationError));
            return nativeSend.call(this, data);
          };
          socket.addEventListener('open', () => {
            void communicationLogRecord('communication_websocket_open', { url: stockNetworkSafeUrl(socketUrl) });
          });
          socket.addEventListener('message', event => {
            if (typeof nativeReceiptCapture === 'function') nativeReceiptCapture({
              transport: 'websocket', direction: 'incoming',
              captured_at_epoch_ms: Date.now()
            });
            captureGenerationWebSocketFrame(event.data);
            void communicationLogWebSocketMessage(socketUrl, event.data)
              .catch(communicationError => communicationLogReportFailure('websocket-message', communicationError));
          });
          socket.addEventListener('close', event => {
            void communicationLogRecord('communication_websocket_close', {
              url: stockNetworkSafeUrl(socketUrl),
              code: event.code,
              was_clean: event.wasClean === true
            });
          });
          socket.addEventListener('error', () => {
            void communicationLogRecord('communication_websocket_error', { url: stockNetworkSafeUrl(socketUrl) });
          });
          return socket;
        }
      });
    }

    if (typeof pageWindow.open === 'function') {
      const originalOpen = pageWindow.open;
      pageWindow.open = function(url, ...rest) {
        recordClickDiagnosticNetworkRequest(url, 'window.open');
        return originalOpen.call(this, url, ...rest);
      };
    }

    captureInstalled = true;
  }

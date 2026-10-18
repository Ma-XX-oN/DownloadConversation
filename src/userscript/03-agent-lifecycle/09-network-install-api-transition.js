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
              void captureGenerationStreamResponse(generationResponse, capture);
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
        const requestStamp = cscCaptureNow('xhr', 'request');
        const info = this.__tmApiRequest || { method: 'GET', url: '', headers: {} };
        const stockTrace = stockNetworkTraceXhrStart(this, info, requestStamp);
        cscPublishValue(requestStamp, {
          method: info.method, url: info.url,
          headers: cscRawHeaderEntries(info.headers),
          body_type: typeof body,
          body_available: body !== null && body !== undefined
        }, body ?? null);
        if (!cscCommWorker) {
          void communicationLogXhrRequest(info, body, stockTrace)
            .catch(communicationError => communicationLogReportFailure('xhr-request', communicationError));
        }
        this.addEventListener('loadend', () => {
          const responseStamp = cscCaptureNow('xhr', 'response',
            requestStamp.connection_id, requestStamp);
          stockNetworkTraceXhrResponse(this, stockTrace);
          const body = cscXhrBodySnapshot(this);
          cscPublishValue(responseStamp, {
            method: info.method, request_url: info.url,
            response_url: this.responseURL ?? info.url,
            status: Number.isFinite(this.status) ? this.status : null,
            response_type: this.responseType || 'text',
            headers: String(this.getAllResponseHeaders?.() ?? ''),
            body_type: body.body_type,
            body_available: body.body_available
          }, body.value);
          if (!cscCommWorker) {
            void communicationLogXhrResponse(this, stockTrace)
              .catch(communicationError => communicationLogReportFailure('xhr-response', communicationError));
          }
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
          const connectionStamp = cscCaptureNow('websocket', 'event');
          const socket = Reflect.construct(target, args, target);
          const socketUrl = String(args[0] ?? '');
          const nativeSend = socket.send;
          socket.send = function(data) {
            const stamp = cscCaptureNow('websocket', 'outgoing',
              connectionStamp.connection_id, connectionStamp);
            cscPublishValue(stamp, {
              url: socketUrl, body_type: typeof data,
              body_available: data !== null && data !== undefined
            }, data);
            if (!cscCommWorker) {
              void communicationLogWebSocketSend(socketUrl, data)
                .catch(communicationError => communicationLogReportFailure('websocket-send', communicationError));
            }
            return nativeSend.call(this, data);
          };
          socket.addEventListener('open', () => {
            const stamp = cscCaptureNow('websocket', 'event',
              connectionStamp.connection_id, connectionStamp);
            cscPublishValue(stamp, { url: socketUrl, event: 'open' });
            if (!cscCommWorker) {
              void communicationLogRecord('communication_websocket_open', { url: stockNetworkSafeUrl(socketUrl) });
            }
          });
          socket.addEventListener('message', event => {
            const stamp = cscCaptureNow('websocket', 'incoming',
              connectionStamp.connection_id, connectionStamp);
            cscPublishValue(stamp, {
              url: socketUrl, body_type: typeof event.data,
              body_available: event.data !== null && event.data !== undefined
            }, event.data);
            captureGenerationWebSocketFrame(event.data);
            if (!cscCommWorker) {
              void communicationLogWebSocketMessage(socketUrl, event.data)
                .catch(communicationError => communicationLogReportFailure('websocket-message', communicationError));
            }
          });
          socket.addEventListener('close', event => {
            const stamp = cscCaptureNow('websocket', 'event',
              connectionStamp.connection_id, connectionStamp);
            cscPublishValue(stamp, {
              url: socketUrl, event: 'close', code: event.code,
              was_clean: event.wasClean === true
            });
            if (!cscCommWorker) {
              void communicationLogRecord('communication_websocket_close', {
                url: stockNetworkSafeUrl(socketUrl),
                code: event.code,
                was_clean: event.wasClean === true
              });
            }
          });
          socket.addEventListener('error', () => {
            const stamp = cscCaptureNow('websocket', 'event',
              connectionStamp.connection_id, connectionStamp);
            cscPublishValue(stamp, { url: socketUrl, event: 'error' });
            if (!cscCommWorker) {
              void communicationLogRecord('communication_websocket_error', { url: stockNetworkSafeUrl(socketUrl) });
            }
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

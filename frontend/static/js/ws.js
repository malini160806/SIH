/**
 * Shared WebSocket connector used by both the control-room dashboard
 * and the driver view. Reconnects automatically if the server restarts.
 */
function connectFognetSocket(onState, onOpen, onClose) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws/state`;
  let socket;

  function open() {
    socket = new WebSocket(url);
    socket.onopen = () => onOpen && onOpen();
    socket.onclose = () => {
      onClose && onClose();
      setTimeout(open, 1500);
    };
    socket.onerror = () => socket.close();
    socket.onmessage = (evt) => {
      try {
        const state = JSON.parse(evt.data);
        onState(state);
      } catch (e) {
        console.error("bad state frame", e);
      }
    };
  }
  open();
}

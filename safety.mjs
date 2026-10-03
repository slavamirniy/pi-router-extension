// Optional API integration must never reject a pi lifecycle event or command.
export function safeExtensionAPI(pi) {
  const guard = handler => async (...args) => {
    try { return await handler(...args); }
    catch { return undefined; }
  };
  return {
    on: (event, handler) => pi.on(event, guard(handler)),
    registerCommand: (name, command) => pi.registerCommand(name, { ...command, handler: guard(command.handler) }),
    registerProvider: (...args) => pi.registerProvider(...args),
    setModel: (...args) => pi.setModel(...args),
  };
}

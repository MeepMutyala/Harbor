const output = document.getElementById('output');
const button = document.getElementById('call');

button.addEventListener('click', async () => {
  output.textContent = 'Calling time.now...';
  try {
    const result = await navigator.agents.runTool({
      serverId: 'time-wasm',
      toolName: 'time.now',
      args: {},
    });
    output.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    output.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
});

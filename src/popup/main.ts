const statusEl = document.getElementById('status')!;
const saveBtn = document.getElementById('save') as HTMLButtonElement;

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('youtube.com/watch')) {
    statusEl.textContent = 'Not a YouTube video page';
    saveBtn.disabled = true;
    return;
  }
  statusEl.textContent = tab.title ?? '(untitled)';
}

saveBtn.addEventListener('click', () => {
  statusEl.textContent = 'TODO: save (phase 3)';
});

init();

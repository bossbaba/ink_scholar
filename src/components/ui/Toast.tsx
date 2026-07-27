let container: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function ensureContainer(): HTMLDivElement {
  if (container) return container;
  const el = document.createElement("div");
  el.className = "ui-toast-layer";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);
  container = el;
  return el;
}

/** 轻量命令式 Toast，无需 Provider，直接调用 toast("消息")。 */
export function toast(message: string): void {
  const el = ensureContainer();
  el.textContent = message;
  el.classList.add("is-show");
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove("is-show"), 2200);
}


window.addEventListener("error", e => {
  console.error("Uncaught error:", e.error || e.message);
});
window.addEventListener("unhandledrejection", e => {
  console.error("Unhandled promise rejection:", e.reason);
});

refreshProfileSelect();
render();

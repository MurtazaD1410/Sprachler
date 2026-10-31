/** Plays a Wikimedia recording if there is one, else the browser's German voice. */
export function speak(text: string, audioUrl?: string) {
  const fallback = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  if (!audioUrl) return fallback();
  const audio = new Audio(audioUrl);
  audio.addEventListener("error", fallback, { once: true });
  audio.play().catch(fallback);
}

export function ScarMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`scar-mark ${small ? "scar-mark-small" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.16c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.54 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.7.12 2.98.72.79 1.16 1.79 1.16 3.02 0 4.3-2.64 5.25-5.15 5.53.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z" />
    </svg>
  );
}

export function GmailMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.5 6.2 12 12.7l8.5-6.5" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M4 6.5v11h16v-11" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

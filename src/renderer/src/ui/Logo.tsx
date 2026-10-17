export function Logo({ size = 22 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="23" rx="6" fill="#15181E" stroke="#2A2F3C" />
      <path
        d="M8.5 5.8v8.4L16 10z"
        fill="#2BD67B"
        stroke="#2BD67B"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 19.2c3-1.8 7-1.9 11-0.3M14.6 16l2.6 2.8-3.7 1"
        fill="none"
        stroke="#8B6CFF"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

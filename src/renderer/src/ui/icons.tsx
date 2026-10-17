// Иконки — встроенный SVG, без внешних шрифтов и CDN.
interface IconProps {
  size?: number
}

function Svg({
  size = 16,
  children
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const PlayIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M7 4.8v14.4a.6.6 0 0 0 .9.5l11.6-7.2a.6.6 0 0 0 0-1L7.9 4.3a.6.6 0 0 0-.9.5z"
      fill="currentColor"
    />
  </Svg>
)

export const PauseIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
  </Svg>
)

export const VolumeIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.5l4.5 3.8V5.7L7.5 9.5z" fill="currentColor" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
)

export const VolumeMutedIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.5l4.5 3.8V5.7L7.5 9.5z" fill="currentColor" />
    <path d="m16 9.5 5 5m0-5-5 5" />
  </Svg>
)

export const FolderOpenIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 18V6.5A1.5 1.5 0 0 1 5 5h3.6l2 2.2H17A1.5 1.5 0 0 1 18.5 8.700V10" />
    <path d="M3.5 18 5.8 11a1 1 0 0 1 .95-.7H21l-2.3 7.100a1.5 1.5 0 0 1-1.4 1H5" />
  </Svg>
)

export const CloseIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)

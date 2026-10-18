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

export const FrameBackIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 5v14" />
    <path
      d="M18.4 5.9v12.2a.6.6 0 0 1-.9.5L9 12.5a.6.6 0 0 1 0-1l8.500-6.100a.6.6 0 0 1 .9.5z"
      fill="currentColor"
    />
  </Svg>
)

export const FrameForwardIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M18 5v14" />
    <path
      d="M5.600 5.900v12.200a.6.6 0 0 0 .9.5L15 12.500a.6.6 0 0 0 0-1L6.500 5.400a.6.6 0 0 0-.9.5z"
      fill="currentColor"
    />
  </Svg>
)

export const SelectIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M6 3.800 18.200 11.200l-5.200 1.400 2.800 5.400-2.200 1.100-2.800-5.400-3.600 3.800z"
      fill="currentColor"
    />
  </Svg>
)

export const ArrowToolIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5 19 16.500 7.500" strokeWidth="2.2" />
    <path d="M10.500 6.500H17.500V13.500z" fill="currentColor" />
  </Svg>
)

export const LineToolIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5 19 19 5" strokeWidth="2.2" />
    <circle cx="5" cy="19" r="1.600" fill="currentColor" />
    <circle cx="19" cy="5" r="1.600" fill="currentColor" />
  </Svg>
)

export const CircleToolIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="8" ry="6.500" strokeWidth="2" />
  </Svg>
)

export const TextToolIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 7V5.500h12V7M12 5.500v13M9.500 18.500h5" strokeWidth="2" />
  </Svg>
)

export const UndoIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 14 4.500 9.500 9 5" />
    <path d="M4.500 9.500H15a4.500 4.500 0 0 1 0 9h-3" />
  </Svg>
)

export const RedoIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m15 14 4.500-4.500L15 5" />
    <path d="M19.500 9.500H9a4.500 4.500 0 0 0 0 9h3" />
  </Svg>
)

export const TrashIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.8 12.500h9.400L17.500 7M10 11v5M14 11v5" />
  </Svg>
)

export const DashedLineIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 12h4M10 12h4M17 12h4" strokeWidth="2.200" />
  </Svg>
)

export const SolidLineIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 12h18" strokeWidth="2.200" />
  </Svg>
)

export const GearIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M18.70 10.34L21.12 10.78L21.12 13.22L18.70 13.66L17.91 15.56L19.31 17.58L17.58 19.31L15.56 17.91L13.66 18.70L13.22 21.12L10.78 21.12L10.34 18.70L8.44 17.91L6.42 19.31L4.69 17.58L6.09 15.56L5.30 13.66L2.88 13.22L2.88 10.78L5.30 10.34L6.09 8.44L4.69 6.42L6.42 4.69L8.44 6.09L10.34 5.30L10.78 2.88L13.22 2.88L13.66 5.30L15.56 6.09L17.58 4.69L19.31 6.42L17.91 8.44Z"
      strokeWidth="1.5"
    />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

export const PlusIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const ArrowUpIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m6 14 6-6 6 6" />
  </Svg>
)

export const ArrowDownIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m6 10 6 6 6-6" />
  </Svg>
)

export const ChevronDownIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
)

export const ChevronRightIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
)

export const ExportIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 4v10.5M7.8 10.6 12 14.8l4.2-4.2M5 19.2h14" />
  </Svg>
)

export const CheckCircleIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.4 12.3 2.4 2.4 4.8-5" />
  </Svg>
)

export const AlertIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 4.2 3.6 18.6h16.8L12 4.2z" />
    <path d="M12 10v4M12 16.6v.1" />
  </Svg>
)

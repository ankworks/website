import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const FolderIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M1.75 3.5h4l1.5 1.75h7c.55 0 1 .45 1 1v6.25c0 .55-.45 1-1 1h-12.5c-.55 0-1-.45-1-1v-8c0-.55.45-1 1-1Z" />
  </Svg>
);

export const FileIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3.5 1.75h5.25L12.5 5.5v8.75c0 .3-.25.5-.5.5h-8.5c-.3 0-.5-.2-.5-.5v-12.5c0-.3.2-.5.5-.5Z" />
    <path d="M8.5 1.75V5.5h4" />
  </Svg>
);

export const SymlinkIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.5 5.5h-2a2.5 2.5 0 0 0 0 5h2M9.5 5.5h2a2.5 2.5 0 0 1 0 5h-2M5.5 8h5" />
  </Svg>
);

export const SubmoduleIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2" y="2.5" width="12" height="11" rx="1" />
    <path d="M2 6h12" />
  </Svg>
);

export const RepoIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 2.5h8.5c.55 0 1 .45 1 1v9c0 .55-.45 1-1 1H3a1 1 0 0 1-1-1v-8.5" />
    <path d="M2 11.5a1 1 0 0 1 1-1h8.5M5.5 5h4" />
  </Svg>
);

export const BranchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5" r="1.5" />
    <path d="M4.5 5v6M11.5 6.5c0 2.5-3 2.5-6 4" />
  </Svg>
);

export const CommitIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M1.5 8h3.75M10.75 8h3.75" />
  </Svg>
);

export const StarIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 1.75l1.9 3.95 4.3.5-3.2 2.95.85 4.25L8 11.3l-3.85 2.1.85-4.25-3.2-2.95 4.3-.5L8 1.75Z" />
  </Svg>
);

export const ForkIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="11.5" cy="3.5" r="1.5" />
    <circle cx="8" cy="12.5" r="1.5" />
    <path d="M4.5 5v1.5c0 1 .75 1.5 1.75 1.5h3.5c1 0 1.75-.5 1.75-1.5V5M8 8v3" />
  </Svg>
);

export const CopyIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 8.5l3.25 3L13 4.5" />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 2.5v8M4.75 7.5 8 10.75l3.25-3.25M2.5 13.5h11" />
  </Svg>
);

export const LinkIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.5-2.5a2.5 2.5 0 0 0-3.54-3.54l-.9.9" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2.5 2.5a2.5 2.5 0 0 0 3.54 3.54l.9-.9" />
  </Svg>
);

export const ExternalIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1H6" />
  </Svg>
);

export const CodeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 4.5 1.75 8 5 11.5M11 4.5 14.25 8 11 11.5M9.25 3 6.75 13" />
  </Svg>
);

export const HistoryIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 6.25M2.5 2.5v3.75h3.75M8 5.25V8l2 1.5" />
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </Svg>
);

export const AlertIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 2 14.5 13.5h-13L8 2Z" />
    <path d="M8 6.5v3M8 11.5v.01" />
  </Svg>
);

export const IssueIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 5v3M8 11v.01" />
  </Svg>
);

export const PullRequestIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="4.25" cy="3.5" r="1.75" />
    <circle cx="4.25" cy="12.5" r="1.75" />
    <circle cx="11.75" cy="12.5" r="1.75" />
    <path d="M4.25 5.25v5.5M11.75 10.75V7a3.5 3.5 0 0 0-3.5-3.5H6.25M8.25 1.75l-2 1.75 2 1.75" />
  </Svg>
);

export const TagIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 2.5h5.25l6.5 6.5-5.25 5.25L2 7.75V2.5Z" />
    <circle cx="5.25" cy="5.25" r=".8" fill="currentColor" stroke="none" />
  </Svg>
);

export const ActivityIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M1.5 8h3l1.6-4.25L9 12.5l2-5 1.2 1.5h2.3" />
  </Svg>
);

export const SunIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
  </Svg>
);

export const MoonIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M13.75 9.75A5.75 5.75 0 0 1 6.25 2.25 6.25 6.25 0 1 0 13.75 9.75Z" />
  </Svg>
);

export const MenuIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 4h12M2 8h12M2 12h12" />
  </Svg>
);

export const CommentIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 3.5h12v8H7l-3.5 2v-2H2v-8Z" />
  </Svg>
);

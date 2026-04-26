// ============================================================
// Console Mockup — icons.jsx
// Inline lucide-style stroke icons. Single source of truth so
// every page consumes the same sizes / weights.
// ============================================================

const Icon = ({ name, size = 18, ...rest }) => {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {path}
    </svg>
  );
};

const ICON_PATHS = {
  // Nav
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  devices:   <><rect x="3" y="4" width="14" height="10" rx="1.5"/><path d="M7 18h10"/><path d="M10 14v4"/><rect x="17" y="9" width="4" height="11" rx="1"/></>,
  addressbook: <><path d="M5 4h11a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5z"/><circle cx="12" cy="11" r="2.5"/><path d="M8 17c.6-2 2-3 4-3s3.4 1 4 3"/><path d="M3 7v2"/><path d="M3 11v2"/><path d="M3 15v2"/></>,
  tokens:    <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></>,
  logs:      <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 12h8"/><path d="M8 16h8"/><path d="M8 8h2"/></>,
  users:     <><circle cx="9" cy="7" r="3"/><path d="M3 21v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1"/><circle cx="17" cy="6" r="2.5"/><path d="M21 21v-1a3 3 0 0 0-2.4-2.94"/></>,
  settings:  <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,

  // Settings sub-icons
  globe:     <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></>,
  shield:    <><path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z"/></>,
  network:   <><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M7 19l4-4M17 19l-4-4"/></>,
  database:  <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></>,
  cloud:     <><path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6 6 0 1 0 5 14.5"/><path d="M5 14.5h12.5"/></>,
  refresh:   <><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>,

  // Actions
  search:    <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
  plus:      <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  more:      <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  edit:      <><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></>,
  trash:     <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
  copy:      <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  download:  <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></>,
  upload:    <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></>,
  filter:    <><path d="M22 3H2l8 9.46V19l4 2v-8.54z"/></>,
  x:         <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  check:     <><path d="M20 6 9 17l-5-5"/></>,
  chevronLeft:<><path d="m15 18-6-6 6-6"/></>,
  chevronRight:<><path d="m9 18 6-6-6-6"/></>,
  chevronDown:<><path d="m6 9 6 6 6-6"/></>,
  "chevron-left":<><path d="m15 18-6-6 6-6"/></>,
  "chevron-right":<><path d="m9 18 6-6-6-6"/></>,
  "chevron-down":<><path d="m6 9 6 6 6-6"/></>,
  "arrow-right":<><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
  eye:       <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,

  // Topbar
  bell:      <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></>,
  sun:       <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>,
  moon:      <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>,
  menu:      <><path d="M3 6h18M3 12h18M3 18h18"/></>,
  panelLeft: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></>,
  command:   <><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></>,

  // Stat icons
  cpu:       <><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/></>,
  memory:    <><path d="M3 8h18l-2 8H5z"/><path d="M7 8V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v3"/><path d="M9 12v1M12 12v1M15 12v1"/></>,
  activity:  <><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>,
  link:      <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
  zap:       <><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></>,
  clock:     <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  alert:     <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>,
  info:      <><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></>,
  inbox:     <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>,
  logout:    <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></>,
  user:      <><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></>,
  key:       <><circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 8.85-8.85"/><path d="m18 5 3 3"/><path d="m15 8 3 3"/></>,
  qr:        <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M14 21h3M21 14v7M17 17v4"/></>,
  mail:      <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></>,
  telegram:  <><path d="M22 3 2 11l6 2 2 6 4-5 6 5 2-16z"/><path d="m10 13 7-6"/></>,
  whatsapp:  <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></>,
};

window.Icon = Icon;

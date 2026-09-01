/** Real flag SVGs instead of 🇺🇸/🇪🇸 emoji — flag emoji render as plain "US"/"ES" text on some
 * Windows/browser combinations that lack a color-emoji font, which is exactly what was happening
 * in the Navbar. An inline SVG always renders as an actual flag, everywhere. */
export const FlagIcon = ({ country, className }: { country: "us" | "es"; className?: string }) => {
  if (country === "us") {
    return (
      <svg viewBox="0 0 20 14" className={className} aria-hidden="true">
        <rect width="20" height="14" fill="#B22234" />
        <g fill="#FFFFFF">
          <rect y="1.08" width="20" height="1.08" />
          <rect y="3.23" width="20" height="1.08" />
          <rect y="5.38" width="20" height="1.08" />
          <rect y="7.54" width="20" height="1.08" />
          <rect y="9.69" width="20" height="1.08" />
          <rect y="11.85" width="20" height="1.08" />
        </g>
        <rect width="8" height="7.54" fill="#3C3B6E" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 14" className={className} aria-hidden="true">
      <rect width="20" height="14" fill="#AA151B" />
      <rect y="3.5" width="20" height="7" fill="#F1BF00" />
    </svg>
  );
};

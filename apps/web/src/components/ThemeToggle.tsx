import { useTheme } from "../context/ThemeContext";
import { Button } from "./Button";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button
      className="theme-toggle shrink-0"
      role="switch"
      aria-checked={theme === "dark"}
      title={label}
      aria-label={label}
      onClick={toggleTheme}
    >
      <span className="theme-toggle-thumb" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" focusable="false">
        {theme === "light" ? (
          <>
            <circle cx="12" cy="12" r="5" />
            <path d="M11 1h2v4h-2zm0 18h2v4h-2zM1 11h4v2H1zm18 0h4v2h-4zM3.51 4.93l1.42-1.42 2.83 2.83-1.42 1.42zm12.73 12.73 1.42-1.42 2.83 2.83-1.42 1.42zM3.51 19.07l2.83-2.83 1.42 1.42-2.83 2.83zM16.24 6.34l2.83-2.83 1.42 1.42-2.83 2.83z" />
          </>
        ) : (
          <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
        )}
      </svg>
      </span>
    </Button>
  );
}

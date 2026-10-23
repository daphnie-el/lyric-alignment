import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
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
        {theme === "light" ? (
          <SunIcon weight="fill" size={20} />
        ) : (
          <MoonIcon weight="fill" size={20} />
        )}
      </span>
    </Button>
  );
}

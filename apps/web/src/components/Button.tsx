import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
  color?: "neutral" | "primary" | "outline" | "danger" | "success";
  backgroundColor?: CSSProperties["backgroundColor"];
  textColor?: CSSProperties["color"];
  borderColor?: CSSProperties["borderColor"];
  hoverBackgroundColor?: CSSProperties["backgroundColor"];
}

type ButtonStyle = CSSProperties & {
  [key: `--button-${string}`]: string | undefined;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    color = "neutral",
    backgroundColor,
    textColor,
    borderColor,
    hoverBackgroundColor,
    className,
    style,
    type = "button",
    loading = false,
    loadingText,
    disabled,
    children,
    ...props
  },
  ref,
) {
  const buttonStyle: ButtonStyle = {
    "--button-background": backgroundColor,
    "--button-text": textColor,
    "--button-border": borderColor,
    "--button-hover-background": hoverBackgroundColor ?? backgroundColor,
    ...style,
  };

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || props["aria-busy"]}
      data-color={color}
      className={className ? `button ${className}` : "button"}
      style={buttonStyle}
    >
      {loadingText !== undefined || loading ? (
        <span className="button-content">
          <span className="button-spinner" data-loading={loading} aria-hidden="true" />
          <span className="button-labels">
            <span className="button-label-measure" aria-hidden="true">{children}</span>
            <span className="button-label-measure" aria-hidden="true">{loadingText}</span>
            <span>{loading ? loadingText ?? children : children}</span>
          </span>
        </span>
      ) : children}
    </button>
  );
});

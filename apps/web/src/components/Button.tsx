import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  color?: "neutral" | "primary" | "danger" | "success";
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
      data-color={color}
      className={className ? `button ${className}` : "button"}
      style={buttonStyle}
    />
  );
});
